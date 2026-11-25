/**
 * Monta o HTML da página pública a partir do modelo (`page.html`).
 *
 * O modelo usa dois recursos, mínimos de propósito:
 *
 *   <!--@nome--> … <!--@/nome-->   bloco que fica ou sai inteiro
 *   {{NOME}}                       valor, sempre escapado para HTML
 *
 * Blocos existentes:
 *   wa     botões que abrem conversa no WhatsApp (há número configurado)
 *   demo   botões que levam às demonstrações da própria página (não há número)
 *   login  link "Entrar" para quem já é cliente
 *
 * Marcador desconhecido, esquecido ou sem par é erro: a página nunca vai ao ar com "{{…}}" à mostra.
 */

export interface LandingOptions {
  /** URL https de conversa no WhatsApp. `null`: os botões levam às demonstrações da própria página. */
  whatsappUrl: string | null;
  /** Caminho local da tela de login (ex.: "/login"). `null`: a página não mostra o link "Entrar". */
  loginUrl: string | null;
}

export class LandingTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LandingTemplateError";
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Mantém ou remove todas as ocorrências do bloco `name`, junto com a linha dos marcadores. */
function applyBlock(html: string, name: string, keep: boolean): string {
  const pattern = new RegExp(`[ \\t]*<!--@${name}-->\\n?([\\s\\S]*?)[ \\t]*<!--@/${name}-->\\n?`, "g");
  let found = false;
  const result = html.replace(pattern, (_match, inner: string) => {
    found = true;
    return keep ? inner : "";
  });
  if (!found) throw new LandingTemplateError(`Bloco "${name}" ausente no modelo da página pública.`);
  return result;
}

export function renderLandingPage(template: string, options: LandingOptions): string {
  const { whatsappUrl, loginUrl } = options;
  // Os valores vêm da configuração do servidor; ainda assim, só entram formatos esperados.
  if (whatsappUrl !== null && !whatsappUrl.startsWith("https://")) {
    throw new LandingTemplateError("O link de contato da página pública deve começar por https://.");
  }
  if (loginUrl !== null && !/^\/(?!\/)/.test(loginUrl)) {
    throw new LandingTemplateError("O link de login da página pública deve ser um caminho local.");
  }

  let html = template;
  html = applyBlock(html, "wa", whatsappUrl !== null);
  html = applyBlock(html, "demo", whatsappUrl === null);
  html = applyBlock(html, "login", loginUrl !== null);

  const values: Record<string, string | null> = { WHATSAPP_URL: whatsappUrl, LOGIN_URL: loginUrl };
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) => {
    const value = values[key];
    if (typeof value !== "string") throw new LandingTemplateError(`Valor ${match} sem conteúdo no modelo da página pública.`);
    return escapeHtml(value);
  });

  const leftover = /<!--@\/?[a-z-]+-->/.exec(html);
  if (leftover) throw new LandingTemplateError(`Marcador ${leftover[0]} sem par ou desconhecido no modelo da página pública.`);
  return html;
}
