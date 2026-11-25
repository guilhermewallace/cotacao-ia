import nextEnv from "@next/env";
import pg from "pg";
import { applyMigrations } from "../../scripts/lib/migrations";

/**
 * Preparação dos testes de integração (executada uma vez, antes de todos os arquivos):
 * recria o schema do banco de TESTE e aplica as migrations versionadas.
 *
 * As migrations são aplicadas como SQL puro (os mesmos arquivos que `prisma migrate deploy`
 * executa, pelo aplicador de scripts/lib/migrations.ts), de modo que os testes validam
 * exatamente o schema que vai para produção.
 */

const DEFAULT_URL = "postgresql://cotacao:cotacao@localhost:5432/cotacao_test";

export default async function setup(): Promise<void> {
  nextEnv.loadEnvConfig(process.cwd(), true, { info: () => undefined, error: console.error });
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_URL;
  process.env.TEST_DATABASE_URL = url; // herdado pelos workers do Vitest

  const database = new URL(url).pathname.replace(/^\//, "");
  if (!database.endsWith("_test")) {
    throw new Error(`Por segurança, o banco de testes precisa terminar em "_test" (TEST_DATABASE_URL aponta para "${database}").`);
  }

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Não foi possível conectar ao banco de testes (${database}). Suba o PostgreSQL com "docker compose up -d" ` +
        `ou defina TEST_DATABASE_URL. Detalhe: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }
  await applyMigrations(url);
}
