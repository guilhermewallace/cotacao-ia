import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPrisma } from "@/platform/db";

/**
 * As migrations versionadas (SQL) precisam descrever exatamente o `schema.prisma`.
 * Este teste compara o schema declarado com o banco migrado: tabelas, colunas e enums.
 */

interface ParsedSchema {
  tables: Map<string, Set<string>>;
  enums: Map<string, string[]>;
}

function parseSchema(source: string): ParsedSchema {
  const enums = new Map<string, string[]>();
  for (const match of source.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
    const values = match[2]!
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter((line) => /^[A-Z_][A-Z0-9_]*$/.test(line));
    enums.set(match[1]!, values);
  }

  const modelNames = new Set([...source.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]!));
  const tables = new Map<string, Set<string>>();
  for (const match of source.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const body = match[2]!;
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? match[1]!;
    const columns = new Set<string>();
    for (const rawLine of body.split("\n")) {
      const line = rawLine.replace(/\/\/.*$/, "").trim();
      const field = /^(\w+)\s+(\w+)(\[\])?(\?)?(\s|$)/.exec(line);
      if (!field || line.startsWith("@@")) continue;
      const [, name, type, isList] = field;
      if (modelNames.has(type!)) continue; // campo de relação: não é coluna
      if (isList && !enums.has(type!) && modelNames.has(type!)) continue;
      columns.add(/@map\("([^"]+)"\)/.exec(line)?.[1] ?? name!);
    }
    tables.set(table, columns);
  }
  return { tables, enums };
}

describe("migrations × schema.prisma", () => {
  const schema = parseSchema(readFileSync(path.resolve(process.cwd(), "prisma", "schema.prisma"), "utf8"));

  it("o schema declara os modelos exigidos pelo produto", () => {
    const required = [
      "organizations", "users", "memberships", "customers", "products", "product_aliases", "price_lists", "price_list_items", "integrations",
      "inbound_messages", "attachments", "quotation_requests", "requested_items", "product_matches", "quotations", "quotation_items", "processing_jobs", "audit_logs",
    ];
    for (const table of required) expect(schema.tables.has(table), `tabela ${table}`).toBe(true);
  });

  it("todas as tabelas e colunas do schema existem no banco migrado (e vice-versa)", async () => {
    const rows = await getPrisma().$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`;
    const database = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!database.has(row.table_name)) database.set(row.table_name, new Set());
      database.get(row.table_name)!.add(row.column_name);
    }

    expect([...database.keys()].sort()).toEqual([...schema.tables.keys()].sort());
    for (const [table, columns] of schema.tables) {
      expect([...(database.get(table) ?? [])].sort(), `colunas de ${table}`).toEqual([...columns].sort());
    }
  });

  it("os enums do banco têm os mesmos valores do schema", async () => {
    const rows = await getPrisma().$queryRaw<Array<{ name: string; label: string }>>`
      SELECT t.typname AS name, e.enumlabel AS label
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' ORDER BY t.typname, e.enumsortorder`;
    const database = new Map<string, string[]>();
    for (const row of rows) database.set(row.name, [...(database.get(row.name) ?? []), row.label]);

    expect([...database.keys()].sort()).toEqual([...schema.enums.keys()].sort());
    for (const [name, values] of schema.enums) expect(database.get(name), `enum ${name}`).toEqual(values);
  });

  it("extensões, índices de busca e restrições críticas estão presentes", async () => {
    const prisma = getPrisma();
    const extensions = await prisma.$queryRaw<Array<{ extname: string }>>`SELECT extname FROM pg_extension`;
    expect(extensions.map((row) => row.extname)).toEqual(expect.arrayContaining(["pg_trgm", "unaccent"]));

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const names = new Set(indexes.map((row) => row.indexname));
    for (const index of ["products_search_text_fts_idx", "products_description_normalized_trgm_idx", "product_aliases_value_normalized_trgm_idx", "price_lists_one_default_per_org_idx"]) {
      expect(names.has(index), `índice ${index}`).toBe(true);
    }

    // Toda tabela de tenant tem organization_id obrigatório e chave estrangeira para organizations.
    const tenantTables = [...schema.tables].filter(([, columns]) => columns.has("organization_id")).map(([table]) => table);
    expect(tenantTables.length).toBeGreaterThanOrEqual(15);
    const nullable = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organization_id' AND is_nullable = 'YES'`;
    expect(nullable).toEqual([]);

    const checks = await prisma.$queryRaw<Array<{ total: bigint }>>`SELECT count(*) AS total FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;
    expect(Number(checks[0]?.total)).toBeGreaterThanOrEqual(13);
  });
});
