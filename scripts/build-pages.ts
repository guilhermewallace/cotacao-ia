/**
 * Gera a versão estática da página pública para o GitHub Pages (dist/pages).
 *
 * É o mesmo modelo (src/modules/landing/page.html) montado pelo mesmo renderLandingPage da rota "/",
 * com três diferenças impostas pela hospedagem estática:
 *
 *  - caminhos relativos ("landing/site.css" em vez de "/landing/site.css"), porque a página de um
 *    repositório fica em https://<usuário>.github.io/<repositório>/;
 *  - sem o link "Entrar": no Pages não há servidor nem tela de login;
 *  - a política de conteúdo vai numa <meta>, já que o Pages não permite cabeçalhos próprios
 *    (frame-ancestors não vale em <meta> e fica de fora).
 *
 * O contato usa LANDING_WHATSAPP_NUMBER / LANDING_WHATSAPP_MESSAGE se estiverem definidos no
 * ambiente; sem número, os botões levam às demonstrações da própria página.
 *
 * Uso: npm run pages:build
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderLandingPage } from "../src/modules/landing/render";
import { whatsappChatUrl } from "../src/modules/landing/whatsapp";

const root = process.cwd();
const out = path.join(root, "dist", "pages");

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

const template = readFileSync(path.join(root, "src", "modules", "landing", "page.html"), "utf8");
let html = renderLandingPage(template, {
  whatsappUrl: whatsappChatUrl(process.env.LANDING_WHATSAPP_NUMBER, process.env.LANDING_WHATSAPP_MESSAGE),
  loginUrl: null,
});

html = html
  .replace(/(href|src)="\/landing\//g, '$1="landing/')
  .replace(/href="\/icon\.svg"/g, 'href="icon.svg"')
  .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`);

const absolute = /(?:href|src)="\/(?!\/)[^"]*"/.exec(html);
if (absolute) throw new Error(`Caminho absoluto restante na página estática: ${absolute[0]}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "index.html"), html);
cpSync(path.join(root, "public", "landing"), path.join(out, "landing"), { recursive: true });
cpSync(path.join(root, "src", "app", "icon.svg"), path.join(out, "icon.svg"));
writeFileSync(path.join(out, ".nojekyll"), "");

console.log(`Página estática gerada em ${path.relative(root, out)}/`);
