import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (antigo "middleware") — camada OTIMISTA, executada antes das páginas.
 *
 * O que faz:
 *  1. redireciona para /login quem claramente não tem cookie de sessão, exceto nas rotas públicas
 *     ("/" é a página pública do produto; "/login", a tela de entrada);
 *  2. leva direto ao /dashboard quem abre a página pública já com sessão;
 *  3. com Supabase Auth, renova o token e grava os cookies atualizados.
 *
 * O que NÃO faz: autorizar. A verificação real de sessão, organização e permissões
 * acontece no servidor a cada página, Server Action e Route Handler
 * (ver src/server/session.ts e os serviços em src/modules).
 *
 * As rotas /api ficam fora do matcher: cada uma autentica por conta própria
 * (sessão, assinatura de webhook ou URL assinada). Os arquivos estáticos da página
 * pública (/landing/…) também: são públicos por definição.
 */

const DEMO_SESSION_COOKIE = "cotacao_demo_session";
const HOME_PATH = "/";
const PUBLIC_PATHS = new Set([HOME_PATH, "/login"]);

function hasSessionCookie(request: NextRequest): boolean {
  if (process.env.AUTH_PROVIDER === "supabase") {
    return request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"));
  }
  return request.cookies.has(DEMO_SESSION_COOKIE);
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = "/login";
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

function redirectToDashboard(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const isHome = request.nextUrl.pathname === HOME_PATH;
  const isPublic = PUBLIC_PATHS.has(request.nextUrl.pathname);

  if (!hasSessionCookie(request)) {
    return isPublic ? NextResponse.next() : redirectToLogin(request);
  }

  if (process.env.AUTH_PROVIDER !== "supabase" || !process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    // Com cookie de sessão, a página pública dá lugar ao painel. Se o cookie já não valer,
    // o próprio /dashboard confere a sessão no servidor e manda para /login.
    return isHome ? redirectToDashboard(request) : NextResponse.next();
  }

  // Supabase: renova a sessão. Os cookies novos precisam ir tanto para a requisição
  // (para os Server Components desta mesma navegação) quanto para a resposta.
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  if (!data.user) return isPublic ? response : redirectToLogin(request);
  if (!isHome) return response;

  // Sessão válida na página pública: vai ao painel, levando junto os cookies renovados.
  const redirect = redirectToDashboard(request);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|landing/|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
