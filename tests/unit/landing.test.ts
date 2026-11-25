import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildDemoCatalog } from "@/demo/catalog";
import { loadLandingTemplate } from "@/modules/landing/page";
import { LandingTemplateError, renderLandingPage } from "@/modules/landing/render";
import { normalizeWhatsappNumber, whatsappChatUrl } from "@/modules/landing/whatsapp";
import { ATTRIBUTE_LIST } from "@/modules/normalization/attributes";
import { parseEnv } from "@/platform/env";
import nextConfig from "../../next.config";
import { bundleLandingEngine, LANDING_ENGINE_OUTPUT } from "../../scripts/build-landing";

const root = process.cwd();
const WHATSAPP = "https://wa.me/5511999999999?text=Ol%C3%A1";

describe("link de conversa no WhatsApp da página pública", () => {
  it("põe o DDI do Brasil quando o número vem só com DDD", () => {
    expect(normalizeWhatsappNumber("11 99999-9999")).toBe("5511999999999");
    expect(normalizeWhatsappNumber("(11) 3333-4444")).toBe("551133334444");
    expect(normalizeWhatsappNumber("011999999999")).toBe("5511999999999");
  });

  it("mantém números que já têm DDI, com ou sem formatação", () => {
    expect(normalizeWhatsappNumber("5511999999999")).toBe("5511999999999");
    expect(normalizeWhatsappNumber("+55 (11) 99999-9999")).toBe("5511999999999");
    expect(normalizeWhatsappNumber("+1 415 555 2671")).toBe("14155552671");
  });

  it("recusa o que não é um telefone plausível", () => {
    for (const invalid of [null, undefined, "", "   ", "123", "abc", "9999-9999", "+0", "1".repeat(16)]) {
      expect(normalizeWhatsappNumber(invalid)).toBeNull();
    }
  });

  it("monta o link oficial wa.me, com a mensagem codificada", () => {
    expect(whatsappChatUrl("11 99999-9999")).toBe("https://wa.me/5511999999999");
    expect(whatsappChatUrl("11 99999-9999", "  ")).toBe("https://wa.me/5511999999999");
    expect(whatsappChatUrl("11 99999-9999", "Olá! Quero saber mais & ver preços?")).toBe(
      "https://wa.me/5511999999999?text=Ol%C3%A1!%20Quero%20saber%20mais%20%26%20ver%20pre%C3%A7os%3F",
    );
    expect(whatsappChatUrl("número inválido", "Olá")).toBeNull();
  });

  it("valida o número já na configuração de ambiente", () => {
    // Parte do ambiente de teste, sem herdar o contato configurado no .env de quem roda os testes.
    const { LANDING_WHATSAPP_NUMBER: _number, LANDING_WHATSAPP_MESSAGE: _message, ...base } = process.env as Record<string, string | undefined>;
    expect(parseEnv(base).LANDING_WHATSAPP_NUMBER).toBeUndefined();
    expect(parseEnv(base).LANDING_WHATSAPP_MESSAGE).toMatch(/Cotação IA/);
    expect(parseEnv({ ...base, LANDING_WHATSAPP_NUMBER: " 5511999999999 " }).LANDING_WHATSAPP_NUMBER).toBe("5511999999999");
    expect(() => parseEnv({ ...base, LANDING_WHATSAPP_NUMBER: "9999-9999" })).toThrow(/LANDING_WHATSAPP_NUMBER/);
    // Tudo o que a configuração aceita vira um link válido.
    for (const accepted of ["11 99999-9999", "5511999999999", "+55 11 99999-9999", "+1 415 555 2671"]) {
      const config = parseEnv({ ...base, LANDING_WHATSAPP_NUMBER: accepted });
      expect(whatsappChatUrl(config.LANDING_WHATSAPP_NUMBER, config.LANDING_WHATSAPP_MESSAGE)).toMatch(/^https:\/\/wa\.me\/\d{10,15}\?text=/);
    }
  });
});

describe("montagem do modelo da página pública", () => {
  const template = [
    "<nav>",
    "<!--@login-->",
    '  <a href="{{LOGIN_URL}}">Entrar</a>',
    "<!--@/login-->",
    "<!--@wa-->",
    '  <a href="{{WHATSAPP_URL}}">Falar no WhatsApp</a>',
    "<!--@/wa-->",
    "<!--@demo-->",
    '  <a href="#leitura">Testar agora</a>',
    "<!--@/demo-->",
    "</nav>",
  ].join("\n");

  it("mostra os botões de WhatsApp quando há contato, e os de demonstração quando não há", () => {
    const withContact = renderLandingPage(template, { whatsappUrl: WHATSAPP, loginUrl: "/login" });
    expect(withContact).toBe(['<nav>', '  <a href="/login">Entrar</a>', `  <a href="${WHATSAPP}">Falar no WhatsApp</a>`, "</nav>"].join("\n"));

    const withoutContact = renderLandingPage(template, { whatsappUrl: null, loginUrl: null });
    expect(withoutContact).toBe(["<nav>", '  <a href="#leitura">Testar agora</a>', "</nav>"].join("\n"));
  });

  it("escapa os valores antes de colocá-los no HTML", () => {
    const html = renderLandingPage(template, { whatsappUrl: 'https://wa.me/1?text="><script>alert(1)</script>&x=\'y\'', loginUrl: "/login" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("https://wa.me/1?text=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;x=&#39;y&#39;");
  });

  it("só aceita link de contato https e link de login local", () => {
    expect(() => renderLandingPage(template, { whatsappUrl: "javascript:alert(1)", loginUrl: "/login" })).toThrow(LandingTemplateError);
    expect(() => renderLandingPage(template, { whatsappUrl: "http://wa.me/5511999999999", loginUrl: "/login" })).toThrow(LandingTemplateError);
    expect(() => renderLandingPage(template, { whatsappUrl: null, loginUrl: "//outro-site.example/login" })).toThrow(LandingTemplateError);
    expect(() => renderLandingPage(template, { whatsappUrl: null, loginUrl: "https://outro-site.example" })).toThrow(LandingTemplateError);
  });

  it("falha em vez de publicar um modelo com marcador faltando, sobrando ou desconhecido", () => {
    const options = { whatsappUrl: WHATSAPP, loginUrl: "/login" };
    expect(() => renderLandingPage("<p>sem blocos</p>", options)).toThrow(/Bloco "wa" ausente/);
    expect(() => renderLandingPage(`${template}\n<!--@wa-->`, options)).toThrow(/sem par ou desconhecido/);
    expect(() => renderLandingPage(`${template}\n<!--@promo-->x<!--@/promo-->`, options)).toThrow(/sem par ou desconhecido/);
    expect(() => renderLandingPage(`${template}\n{{OUTRO_VALOR}}`, options)).toThrow(/OUTRO_VALOR/);
  });
});

describe("página pública real (src/modules/landing/page.html)", () => {
  const render = async (options: { whatsappUrl: string | null; loginUrl: string | null }) => renderLandingPage(await loadLandingTemplate({ fresh: true }), options);

  it("com contato: os três botões de ação abrem o WhatsApp, em nova aba e sem repassar a origem", async () => {
    const html = await render({ whatsappUrl: WHATSAPP, loginUrl: "/login" });
    const links = html.match(/<a [^>]*href="https:\/\/wa\.me\/[^"]*"[^>]*>/g) ?? [];
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toContain(`href="${WHATSAPP}"`);
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
    }
    expect(html.match(/Falar no (?:<\/span>)?WhatsApp/g)).toHaveLength(3);
    expect(html).not.toContain("Testar agora");
    expect(html).toContain('<a class="nav-login" href="/login">Entrar</a>');
    expect(html).not.toMatch(/<!--@|\{\{/);
  });

  it("sem contato: os botões levam às demonstrações da própria página e nada aponta para fora", async () => {
    const html = await render({ whatsappUrl: null, loginUrl: null });
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("nav-login");
    expect(html).toContain('href="#leitura">Testar agora</a>');
    expect(html.match(/href="https?:\/\//g)).toBeNull();
    expect(html).not.toMatch(/<!--@|\{\{/);
  });

  it("não tem script nem estilo embutidos, como exige a política de conteúdo", async () => {
    const html = await render({ whatsappUrl: WHATSAPP, loginUrl: "/login" });
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);

    // A regra de "/" em next.config.ts vem depois da geral e a substitui.
    const rules = (await nextConfig.headers?.()) ?? [];
    const csp = rules.filter((rule) => rule.source === "/").flatMap((rule) => rule.headers).find((header) => header.key === "Content-Security-Policy");
    const policy = Object.fromEntries((csp?.value ?? "").split("; ").map((directive) => [directive.split(" ")[0], directive]));
    expect(rules.at(-1)?.source).toBe("/");
    expect(policy["script-src"]).toBe("script-src 'self'");
    expect(policy["default-src"]).toBe("default-src 'none'");
    expect(policy["connect-src"]).toBe("connect-src 'none'");
    expect(policy["frame-ancestors"]).toBe("frame-ancestors 'self'");
  });

  it("só referencia arquivos que existem e âncoras que têm destino", async () => {
    const html = await render({ whatsappUrl: WHATSAPP, loginUrl: "/login" });
    const assets = [...html.matchAll(/(?:href|src)="(\/landing\/[^"]+)"/g)].map((match) => match[1] ?? "");
    expect(assets).toEqual(expect.arrayContaining(["/landing/site.css", "/landing/engine.js", "/landing/site.js"]));
    for (const asset of assets) expect(existsSync(path.join(root, "public", asset)), asset).toBe(true);

    const css = readFileSync(path.join(root, "public/landing/site.css"), "utf8");
    const fonts = [...css.matchAll(/url\("(fonts\/[^"]+)"\)/g)].map((match) => match[1] ?? "");
    expect(fonts).toHaveLength(4);
    for (const font of fonts) expect(existsSync(path.join(root, "public/landing", font)), font).toBe(true);

    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) expect(ids.has(anchor), `#${anchor}`).toBe(true);
  });
});

describe("motor das demonstrações (public/landing/engine.js)", () => {
  const committed = readFileSync(path.join(root, LANDING_ENGINE_OUTPUT), "utf8");

  it("está em dia com os módulos do produto — se falhar, rode `npm run landing:build`", async () => {
    expect(await bundleLandingEngine(root)).toBe(committed);
  });

  it("roda no navegador com as mesmas regras e o mesmo catálogo de demonstração", () => {
    const context: { CotacaoEngine?: Record<string, never> } = {};
    vm.runInNewContext(`${committed}\nthis.CotacaoEngine = CotacaoEngine;`, context);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- objeto global do pacote gerado, sem tipos em tempo de teste
    const engine = context.CotacaoEngine as any;

    expect(engine.info.products).toBe(buildDemoCatalog().length);
    expect(engine.info.attributes).toBe(ATTRIBUTE_LIST.length);

    const [item] = engine.readText("12 disj tripolar 32a curva c");
    expect(item.quantity).toBe(12);
    const result = engine.match(item);
    expect(result.outcome).toBe("SUGGESTED");
    expect(result.candidates[0].sku).toBe("DJ-3P-032-C");
    // Descrição parecida, corrente diferente: descartado, nunca sugerido.
    expect(result.rejected.map((candidate: { sku: string }) => candidate.sku)).toEqual(expect.arrayContaining(["DJ-3P-040-C"]));

    const unknown = engine.match(engine.readRow("válvula solenoide 1/2 24Vcc", 2, "un"));
    expect(unknown.outcome).toBe("NO_MATCH");
    expect(unknown.candidates).toHaveLength(0);
  });
});
