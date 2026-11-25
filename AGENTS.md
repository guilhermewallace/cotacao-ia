# Cotação IA — notas para agentes de código

- Leia `docs/arquitetura.md` antes de alterar módulos: as regras de multi-tenancy
  (`tenantDb`, chaves estrangeiras compostas) e de preços (nunca gerados por IA) são invariantes.
- Regras de negócio ficam em `src/modules/*` e não importam nada de `next/*`.
- Toda consulta SQL bruta deve filtrar `organization_id` explicitamente.
- Rode `npm run lint && npm run typecheck && npm test` antes de concluir uma mudança.
- A página pública (`/`) reutiliza os módulos puros de normalização e matching no navegador. Se mudar
  essas regras, rode `npm run landing:build`; os módulos que ela importa não podem depender de pacotes
  nem de APIs do Node (veja `docs/pagina-publica.md`).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
