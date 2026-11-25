import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Política mínima, compatível com o Next.js sem nonces: impede que a aplicação seja embutida
  // em outros sites (clickjacking), bloqueia plugins e restringe <base> e destinos de formulários.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" },
];

/**
 * Página pública ("/", servida por src/app/route.ts): política mais restrita que a do painel.
 * Tudo vem deste próprio site, não há script embutido e a página não faz chamadas de rede.
 * `style-src 'unsafe-inline'` existe só para os atributos `style` que public/landing/site.js
 * escreve (larguras de barras e posições do seletor) — nunca para scripts.
 */
const landingContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pacotes que dependem de arquivos próprios em disco ou de módulos nativos do Node:
  // ficam fora do bundle do servidor.
  serverExternalPackages: ["pdfkit", "unpdf", "bullmq", "ioredis", "pino", "xlsx", "@prisma/adapter-pg", "pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Regra posterior: para "/", substitui a política geral pela da página pública.
      { source: "/", headers: [{ key: "Content-Security-Policy", value: landingContentSecurityPolicy }] },
    ];
  },
};

export default nextConfig;
