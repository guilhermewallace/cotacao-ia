/**
 * Aplica as migrations versionadas usando apenas o driver `pg` (sem o motor do Prisma).
 * Alternativa a `npm run db:migrate` para redes que bloqueiam o download dos binários
 * do Prisma. O resultado é registrado em `_prisma_migrations`, então os dois comandos
 * são intercambiáveis.
 *
 * Uso: npm run db:migrate:sql
 */
import "./lib/load-env";
import { applyMigrations } from "./lib/migrations";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida. Copie .env.example para .env.");
  const result = await applyMigrations(url, { log: (message) => console.log(message) });
  console.log(result.applied.length > 0 ? `${result.applied.length} migration(s) aplicada(s).` : "Banco já está atualizado.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
