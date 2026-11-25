import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Supabase: o cliente real faria chamadas de rede. Aqui ele só renova um cookie e devolve o usuário do teste.
const supabase = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: Array<{ name: string; value: string; options: object }>) => void } }) => ({
    auth: {
      getUser: async () => {
        options.cookies.setAll([{ name: "sb-teste-auth-token", value: "renovado", options: { path: "/" } }]);
        return { data: { user: supabase.user } };
      },
    },
  }),
}));

import { config, proxy } from "@/proxy";

const DEMO_COOKIE = "cotacao_demo_session=qualquer-valor";

function request(pathname: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${pathname}`, cookie ? { headers: { cookie } } : undefined);
}

const passesThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";
const redirectTarget = (response: Response) => {
  const location = response.headers.get("location");
  return location ? `${new URL(location).pathname}${new URL(location).search}` : null;
};

afterEach(() => {
  vi.unstubAllEnvs();
  supabase.user = null;
});

describe("proxy: página pública, login e rotas protegidas", () => {
  it('deixa a página pública ("/") e o login abertos para quem não tem sessão', async () => {
    expect(passesThrough(await proxy(request("/")))).toBe(true);
    expect(passesThrough(await proxy(request("/login")))).toBe(true);
  });

  it("manda para o login, guardando o destino, quem abre o painel sem sessão", async () => {
    expect(redirectTarget(await proxy(request("/dashboard")))).toBe("/login?next=%2Fdashboard");
    expect(redirectTarget(await proxy(request("/cotacoes?status=aberta")))).toBe(`/login?next=${encodeURIComponent("/cotacoes?status=aberta")}`);
  });

  it("leva direto ao painel quem abre a página pública já com sessão", async () => {
    const response = await proxy(request("/?utm_source=teste", DEMO_COOKIE));
    expect(response.status).toBe(307);
    expect(redirectTarget(response)).toBe("/dashboard");
  });

  it("não interfere nas demais rotas de quem tem sessão", async () => {
    expect(passesThrough(await proxy(request("/catalogo", DEMO_COOKIE)))).toBe(true);
    expect(passesThrough(await proxy(request("/login", DEMO_COOKIE)))).toBe(true);
  });

  it("não se aplica à API nem aos arquivos estáticos, inclusive os da página pública", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const covered of ["/", "/login", "/dashboard", "/catalogo/importar"]) expect(matcher.test(covered), covered).toBe(true);
    for (const skipped of ["/api/health", "/_next/static/chunk.js", "/landing/site.css", "/landing/engine.js", "/landing/fonts/geist.woff2", "/icon.svg"]) {
      expect(matcher.test(skipped), skipped).toBe(false);
    }
  });
});

describe("proxy com Supabase Auth", () => {
  const SUPABASE_COOKIE = "sb-teste-auth-token=antigo";

  function useSupabase(): void {
    vi.stubEnv("AUTH_PROVIDER", "supabase");
    vi.stubEnv("SUPABASE_URL", "https://teste.supabase.example");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "chave-publica-de-teste");
  }

  it("com sessão válida na página pública, vai ao painel levando os cookies renovados", async () => {
    useSupabase();
    supabase.user = { id: "usuario-1" };
    const response = await proxy(request("/", SUPABASE_COOKIE));
    expect(redirectTarget(response)).toBe("/dashboard");
    expect(response.cookies.get("sb-teste-auth-token")?.value).toBe("renovado");
  });

  it("com cookie que já não vale, mostra a página pública e protege o painel", async () => {
    useSupabase();
    expect(passesThrough(await proxy(request("/", SUPABASE_COOKIE)))).toBe(true);
    expect(redirectTarget(await proxy(request("/dashboard", SUPABASE_COOKIE)))).toBe("/login?next=%2Fdashboard");
  });

  it("com sessão válida, as demais rotas seguem com os cookies renovados", async () => {
    useSupabase();
    supabase.user = { id: "usuario-1" };
    const response = await proxy(request("/catalogo", SUPABASE_COOKIE));
    expect(passesThrough(response)).toBe(true);
    expect(response.cookies.get("sb-teste-auth-token")?.value).toBe("renovado");
  });
});
