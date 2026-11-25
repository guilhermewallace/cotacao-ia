# Imagem única para a aplicação web (next start) e para o worker (node dist/worker.mjs).
#
#   docker build -t cotacao-ia .
#   docker run --env-file .env -p 3000:3000 cotacao-ia                       # web
#   docker run --env-file .env cotacao-ia node dist/worker.mjs               # worker
#
# As variáveis de ambiente são lidas em tempo de execução; nada sensível entra na imagem.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# ── Dependências ───────────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# O postinstall executa `prisma generate` (cliente em src/generated/prisma).
RUN npm ci

# ── Build ──────────────────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# O build não precisa de banco nem de segredos reais: todas as páginas são dinâmicas.
RUN npm run build && npm run worker:build

# ── Execução ───────────────────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
# Usuário sem privilégios, com diretório home (o npm e a CLI do Prisma gravam cache e logs nele).
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app --create-home app
COPY --from=build --chown=app:app /app ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "run", "start"]
