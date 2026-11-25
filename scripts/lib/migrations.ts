import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Aplicador de migrations em SQL puro (driver `pg`), compatível com o Prisma Migrate.
 *
 * Executa os mesmos arquivos `prisma/migrations/<nome>/migration.sql`, na mesma ordem, e
 * registra cada um na tabela `_prisma_migrations` com o mesmo checksum que o Prisma usa
 * (SHA-256 do arquivo). Assim, `prisma migrate deploy` e este aplicador podem ser usados
 * de forma intercambiável.
 *
 * Existe para (a) os testes de integração e (b) ambientes em que o binário do motor de
 * schema do Prisma não pode ser baixado (redes que bloqueiam binaries.prisma.sh).
 */

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"            VARCHAR(64) NOT NULL,
    "finished_at"         TIMESTAMPTZ,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMPTZ,
    "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`;

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export function readMigrations(directory = path.resolve(process.cwd(), "prisma", "migrations")): MigrationFile[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(directory, name, "migration.sql"), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

export async function applyMigrations(connectionString: string, options: { log?: (message: string) => void } = {}): Promise<{ applied: string[]; skipped: string[] }> {
  const log = options.log ?? (() => undefined);
  const client = new pg.Client({ connectionString });
  await client.connect();
  const result = { applied: [] as string[], skipped: [] as string[] };

  try {
    // Impede duas aplicações simultâneas (mesma chave de advisory lock usada pelo Prisma Migrate).
    await client.query("SELECT pg_advisory_lock(72707369)");
    await client.query(LEDGER_DDL);
    const ledger = await client.query<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"',
    );
    const done = new Map(ledger.rows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => [row.migration_name, row.checksum]));
    const failed = ledger.rows.find((row) => !row.finished_at && !row.rolled_back_at);
    if (failed) {
      throw new Error(`A migration "${failed.migration_name}" ficou incompleta em uma execução anterior. Corrija o banco e remova o registro em _prisma_migrations antes de continuar.`);
    }

    for (const migration of readMigrations()) {
      const appliedChecksum = done.get(migration.name);
      if (appliedChecksum) {
        if (appliedChecksum !== migration.checksum) {
          throw new Error(`A migration "${migration.name}" já aplicada foi alterada depois (checksum diferente). Migrations aplicadas não devem ser editadas.`);
        }
        result.skipped.push(migration.name);
        continue;
      }

      const id = randomUUID();
      await client.query('INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ($1, $2, $3)', [id, migration.checksum, migration.name]);
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.query('DELETE FROM "_prisma_migrations" WHERE id = $1', [id]);
        throw new Error(`Falha ao aplicar a migration "${migration.name}": ${error instanceof Error ? error.message : String(error)}`);
      }
      await client.query('UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1', [id]);
      result.applied.push(migration.name);
      log(`migration aplicada: ${migration.name}`);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(72707369)").catch(() => undefined);
    await client.end();
  }
  return result;
}
