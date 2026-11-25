import path from "node:path";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/modules/audit/audit";
import { rebuildSearchText } from "@/modules/catalog/products";
import { buildProductAttributes, buildProductSearchFields } from "@/modules/catalog/search-text";
import { inspectFile, sanitizeFileName } from "@/modules/documents/inspect";
import { cellToString, MAX_SHEET_ROWS, readSpreadsheet } from "@/modules/documents/spreadsheet";
import { assertCan } from "@/modules/identity/permissions";
import { normalizeCode, normalizeText, stripAccents } from "@/modules/normalization/text";
import { normalizeUnit, parseMoney } from "@/modules/normalization/units";
import { importStorageKey, storage } from "@/modules/storage";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { maxUploadBytes } from "@/platform/env";
import { ConflictError, NotFoundError, ValidationError } from "@/platform/errors";
import { idSchema, parseId } from "@/platform/ids";

/**
 * Importação de catálogo (produtos) e de listas de preços a partir de CSV, XLSX ou XLS.
 *
 * Fluxo em duas etapas: (1) o arquivo é enviado, guardado no storage privado e analisado
 * — o usuário confere o mapeamento de colunas e os problemas encontrados; (2) a importação
 * é aplicada. Nada é gravado no catálogo antes da confirmação.
 */

export type ImportTarget = "products" | "price_list";

export const PRODUCT_FIELDS = [
  { key: "sku", label: "SKU / código interno", required: true },
  { key: "description", label: "Descrição", required: true },
  { key: "manufacturer", label: "Fabricante", required: false },
  { key: "manufacturerCode", label: "Código do fabricante", required: false },
  { key: "category", label: "Categoria", required: false },
  { key: "unit", label: "Unidade de medida", required: false },
  { key: "price", label: "Preço", required: false },
  { key: "synonyms", label: "Sinônimos (separados por ;)", required: false },
  { key: "active", label: "Ativo (sim/não)", required: false },
] as const;

export const PRICE_LIST_FIELDS = [
  { key: "sku", label: "SKU / código interno", required: true },
  { key: "price", label: "Preço", required: true },
] as const;

export type ImportField = (typeof PRODUCT_FIELDS)[number]["key"];

const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  sku: ["sku", "codigo", "cod", "codigo interno", "codigo do produto", "cod produto", "cod interno", "referencia interna", "id produto", "codigo sku"],
  description: ["descricao", "descricao do produto", "produto", "nome", "nome do produto", "descricao completa", "descricao do item"],
  manufacturer: ["fabricante", "marca", "marca/fabricante"],
  manufacturerCode: [
    "codigo fabricante", "codigo do fabricante", "cod fabricante", "cod. fabricante", "part number", "partnumber", "pn", "referencia",
    "referencia fabricante", "referencia do fabricante", "codigo original", "ref fabricante",
  ],
  category: ["categoria", "grupo", "familia", "linha", "departamento", "secao", "subgrupo"],
  unit: ["unidade", "un", "und", "um", "unid", "u.m.", "unidade de medida", "medida"],
  price: ["preco", "valor", "preco unitario", "preco venda", "preco de venda", "pv", "valor unitario", "preco de lista", "preco lista", "preco base"],
  synonyms: ["sinonimos", "sinonimo", "apelidos", "outros nomes", "descricao alternativa", "palavras-chave", "palavras chave"],
  active: ["ativo", "status", "situacao", "ativo?"],
};

export const importMappingSchema = z.object({
  columns: z.record(z.string(), z.number().int().min(0).max(200).nullable()),
  /** Colunas extras lidas como atributos técnicos ("Tensão: 220V"). */
  attributeColumns: z.array(z.number().int().min(0).max(200)).max(40).default([]),
});
export type ImportMapping = z.infer<typeof importMappingSchema>;

export interface ImportRowIssue {
  row: number;
  severity: "error" | "warning";
  message: string;
}

export interface ImportAnalysis {
  stats: { totalRows: number; valid: number; toCreate: number; toUpdate: number; errors: number; warnings: number };
  issues: ImportRowIssue[];
  issuesTruncated: boolean;
}

export interface ImportPreview {
  importId: string;
  target: ImportTarget;
  fileName: string;
  sheetName: string;
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  mapping: ImportMapping;
  analysis: ImportAnalysis;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  aliasesCreated: number;
  priceListId?: string;
}

interface ParsedTable {
  sheetName: string;
  headers: string[];
  /** Linhas de dados, com o número da linha no arquivo (base 1). */
  rows: Array<{ number: number; cells: string[] }>;
}

const MAX_ISSUES = 200;

function normalizeHeader(value: string): string {
  return stripAccents(value).toLowerCase().replace(/\s+/g, " ").replace(/[:*]+$/g, "").trim();
}

/** Lê o arquivo e localiza a linha de cabeçalho (primeira linha com ao menos duas células preenchidas). */
export async function parseImportTable(data: Buffer, fileName: string): Promise<ParsedTable> {
  const inspected = await inspectFile(data, fileName, { maxBytes: maxUploadBytes() });
  if (!inspected.ok || inspected.kind !== "SPREADSHEET") {
    throw new ValidationError("Envie um arquivo CSV, XLSX ou XLS.");
  }
  const sheets = readSpreadsheet(data, inspected.extension, fileName);
  const sheet = sheets.find((candidate) => candidate.rows.some((row) => row.filter((cell) => cell !== null).length >= 2));
  if (!sheet) throw new ValidationError("O arquivo não contém dados.");

  const headerIndex = sheet.rows.findIndex((row) => row.filter((cell) => cell !== null).length >= 2);
  const headers = (sheet.rows[headerIndex] ?? []).map((cell) => cellToString(cell).trim());
  const rows: ParsedTable["rows"] = [];
  for (let index = headerIndex + 1; index < sheet.rows.length; index += 1) {
    const cells = (sheet.rows[index] ?? []).map((cell) => cellToString(cell).trim());
    if (cells.some((cell) => cell.length > 0)) rows.push({ number: index + 1, cells });
  }
  if (rows.length === 0) throw new ValidationError("O arquivo tem cabeçalho, mas nenhuma linha de dados.");
  if (rows.length >= MAX_SHEET_ROWS - 1) throw new ValidationError(`O arquivo excede o limite de ${MAX_SHEET_ROWS.toLocaleString("pt-BR")} linhas por importação.`);
  return { sheetName: sheet.name, headers, rows };
}

/** Sugere o mapeamento de colunas a partir dos nomes do cabeçalho. */
export function suggestMapping(headers: string[], target: ImportTarget): ImportMapping {
  const fields = (target === "products" ? PRODUCT_FIELDS : PRICE_LIST_FIELDS).map((field) => field.key);
  const columns: Record<string, number | null> = {};
  const used = new Set<number>();
  for (const field of fields) {
    const index = headers.findIndex((header, position) => !used.has(position) && HEADER_SYNONYMS[field].includes(normalizeHeader(header)));
    columns[field] = index >= 0 ? index : null;
    if (index >= 0) used.add(index);
  }
  return { columns, attributeColumns: [] };
}

interface ProductImportRow {
  rowNumber: number;
  sku: string;
  skuNormalized: string;
  description: string;
  manufacturer: string | null;
  manufacturerCode: string | null;
  category: string | null;
  unit: string | null;
  price: number | null;
  isActive: boolean | null;
  synonyms: string[];
  attributeText: string;
}

const TRUE_VALUES = new Set(["sim", "s", "ativo", "1", "true", "yes", "y", "x"]);
const FALSE_VALUES = new Set(["nao", "n", "inativo", "0", "false", "no"]);

function analyzeProductRows(
  table: ParsedTable,
  mapping: ImportMapping,
): { rows: ProductImportRow[]; issues: ImportRowIssue[] } {
  const column = (field: ImportField) => mapping.columns[field] ?? null;
  if (column("sku") === null || column("description") === null) {
    throw new ValidationError("Mapeie ao menos as colunas de SKU e de descrição.");
  }
  const cell = (cells: string[], field: ImportField): string => {
    const index = column(field);
    return index === null ? "" : (cells[index] ?? "").trim();
  };

  const rows: ProductImportRow[] = [];
  const issues: ImportRowIssue[] = [];
  const seen = new Map<string, number>();

  for (const { number, cells } of table.rows) {
    const sku = cell(cells, "sku");
    const description = cell(cells, "description");
    const skuNormalized = normalizeCode(sku);
    if (!skuNormalized) {
      issues.push({ row: number, severity: "error", message: "SKU ausente." });
      continue;
    }
    if (sku.length > 60) {
      issues.push({ row: number, severity: "error", message: "SKU com mais de 60 caracteres." });
      continue;
    }
    if (description.length < 3) {
      issues.push({ row: number, severity: "error", message: "Descrição ausente." });
      continue;
    }
    const firstSeen = seen.get(skuNormalized);
    if (firstSeen !== undefined) {
      issues.push({ row: number, severity: "error", message: `SKU repetido no arquivo (primeira ocorrência na linha ${firstSeen}). Linha ignorada.` });
      continue;
    }
    seen.set(skuNormalized, number);

    const rawPrice = cell(cells, "price");
    const price = rawPrice ? parseMoney(rawPrice) : null;
    if (rawPrice && price === null) {
      issues.push({ row: number, severity: "error", message: `Preço inválido: "${rawPrice}".` });
      continue;
    }

    const rawUnit = cell(cells, "unit");
    const unit = rawUnit ? normalizeUnit(rawUnit) : null;
    if (rawUnit && !unit) {
      issues.push({ row: number, severity: "warning", message: `Unidade "${rawUnit}" não reconhecida — será usado UN.` });
    }

    const rawActive = stripAccents(cell(cells, "active")).toLowerCase();
    let isActive: boolean | null = null;
    if (rawActive) {
      if (TRUE_VALUES.has(rawActive)) isActive = true;
      else if (FALSE_VALUES.has(rawActive)) isActive = false;
      else issues.push({ row: number, severity: "warning", message: `Valor de "ativo" não reconhecido: "${rawActive}".` });
    }

    const attributeText = mapping.attributeColumns
      .map((index) => {
        const value = (cells[index] ?? "").trim();
        return value ? `${table.headers[index] ?? ""} ${value}` : "";
      })
      .filter(Boolean)
      .join(" ; ");

    rows.push({
      rowNumber: number,
      sku,
      skuNormalized,
      description: description.slice(0, 300),
      manufacturer: cell(cells, "manufacturer").slice(0, 100) || null,
      manufacturerCode: cell(cells, "manufacturerCode").slice(0, 80) || null,
      category: cell(cells, "category").slice(0, 100) || null,
      unit: unit ?? (rawUnit ? "UN" : null),
      price,
      isActive,
      synonyms: cell(cells, "synonyms")
        .split(/[;|]/)
        .map((value) => value.trim())
        .filter((value) => value.length >= 2)
        .slice(0, 10),
      attributeText,
    });
  }
  return { rows, issues };
}

function summarize(totalRows: number, validRows: number, toCreate: number, toUpdate: number, issues: ImportRowIssue[]): ImportAnalysis {
  return {
    stats: {
      totalRows,
      valid: validRows,
      toCreate,
      toUpdate,
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
    },
    issues: issues.sort((a, b) => a.row - b.row).slice(0, MAX_ISSUES),
    issuesTruncated: issues.length > MAX_ISSUES,
  };
}

async function analyzeProducts(ctx: TenantContext, table: ParsedTable, mapping: ImportMapping) {
  const { rows, issues } = analyzeProductRows(table, mapping);
  const db = tenantDb(ctx.organizationId);

  const existing = await db.product.findMany({
    where: { skuNormalized: { in: rows.map((row) => row.skuNormalized) } },
    select: { skuNormalized: true },
  });
  const existingSkus = new Set(existing.map((product) => product.skuNormalized));

  // Possíveis duplicidades: código de fabricante já cadastrado em outro SKU.
  const codes = new Map<string, ProductImportRow>();
  for (const row of rows) {
    const code = normalizeCode(row.manufacturerCode);
    if (code && !existingSkus.has(row.skuNormalized)) codes.set(code, row);
  }
  if (codes.size > 0) {
    const sameCode = await db.product.findMany({
      where: { manufacturerCodeNormalized: { in: [...codes.keys()] } },
      select: { sku: true, manufacturerCodeNormalized: true },
    });
    for (const product of sameCode) {
      const row = product.manufacturerCodeNormalized ? codes.get(product.manufacturerCodeNormalized) : undefined;
      if (row) {
        issues.push({
          row: row.rowNumber,
          severity: "warning",
          message: `Possível duplicidade: o código de fabricante "${row.manufacturerCode}" já está cadastrado no SKU ${product.sku}.`,
        });
      }
    }
  }

  const toUpdate = rows.filter((row) => existingSkus.has(row.skuNormalized)).length;
  return { rows, existingSkus, analysis: summarize(table.rows.length, rows.length, rows.length - toUpdate, toUpdate, issues) };
}

interface PriceRow {
  rowNumber: number;
  productId: string;
  price: number;
}

async function analyzePriceList(ctx: TenantContext, table: ParsedTable, mapping: ImportMapping) {
  const skuColumn = mapping.columns.sku ?? null;
  const priceColumn = mapping.columns.price ?? null;
  if (skuColumn === null || priceColumn === null) throw new ValidationError("Mapeie as colunas de SKU e de preço.");

  const issues: ImportRowIssue[] = [];
  const parsed: Array<{ rowNumber: number; skuNormalized: string; sku: string; price: number }> = [];
  const seen = new Map<string, number>();
  for (const { number, cells } of table.rows) {
    const sku = (cells[skuColumn] ?? "").trim();
    const skuNormalized = normalizeCode(sku);
    const rawPrice = (cells[priceColumn] ?? "").trim();
    if (!skuNormalized) {
      issues.push({ row: number, severity: "error", message: "SKU ausente." });
      continue;
    }
    const price = parseMoney(rawPrice);
    if (price === null) {
      issues.push({ row: number, severity: "error", message: rawPrice ? `Preço inválido: "${rawPrice}".` : "Preço ausente." });
      continue;
    }
    const firstSeen = seen.get(skuNormalized);
    if (firstSeen !== undefined) {
      issues.push({ row: number, severity: "error", message: `SKU repetido no arquivo (primeira ocorrência na linha ${firstSeen}). Linha ignorada.` });
      continue;
    }
    seen.set(skuNormalized, number);
    parsed.push({ rowNumber: number, skuNormalized, sku, price });
  }

  const products = await tenantDb(ctx.organizationId).product.findMany({
    where: { skuNormalized: { in: parsed.map((row) => row.skuNormalized) } },
    select: { id: true, skuNormalized: true },
  });
  const bySku = new Map(products.map((product) => [product.skuNormalized, product.id]));
  const rows: PriceRow[] = [];
  for (const row of parsed) {
    const productId = bySku.get(row.skuNormalized);
    if (!productId) {
      issues.push({ row: row.rowNumber, severity: "error", message: `SKU "${row.sku}" não existe no catálogo.` });
      continue;
    }
    rows.push({ rowNumber: row.rowNumber, productId, price: row.price });
  }
  return { rows, analysis: summarize(table.rows.length, rows.length, rows.length, 0, issues) };
}

// ───────────────────────────── Etapa 1: envio e análise ─────────────────────────────

interface ImportJobPayload {
  storageKey: string;
  fileName: string;
  target: ImportTarget;
}

async function loadImportJob(ctx: TenantContext, importId: string) {
  const id = parseId(importId, "Importação");
  const job = await tenantDb(ctx.organizationId).processingJob.findUnique({ where: { id } });
  if (!job || (job.type !== "CATALOG_IMPORT" && job.type !== "PRICE_LIST_IMPORT")) throw new NotFoundError("Importação");
  if (job.status !== "QUEUED") throw new ConflictError("Esta importação já foi concluída. Envie o arquivo novamente.");
  const payload = job.payload as unknown as ImportJobPayload;
  const data = await storage().get(payload.storageKey);
  return { job, payload, table: await parseImportTable(data, payload.fileName) };
}

export async function previewImport(ctx: TenantContext, input: { target: ImportTarget; fileName: string; data: Buffer }): Promise<ImportPreview> {
  assertCan(ctx, "catalog:import");
  const fileName = sanitizeFileName(input.fileName);
  const table = await parseImportTable(input.data, fileName);
  const mapping = suggestMapping(table.headers, input.target);

  const storageKey = importStorageKey({ organizationId: ctx.organizationId, extension: path.extname(fileName).slice(1) });
  await storage().put(storageKey, input.data, { contentType: "application/octet-stream" });

  const job = await tenantDb(ctx.organizationId).processingJob.create({
    data: {
      organizationId: ctx.organizationId,
      type: input.target === "products" ? "CATALOG_IMPORT" : "PRICE_LIST_IMPORT",
      idempotencyKey: `import:${storageKey}`,
      payload: { storageKey, fileName, target: input.target } satisfies ImportJobPayload,
      maxAttempts: 1,
    },
  });

  let analysis: ImportAnalysis;
  try {
    analysis =
      input.target === "products" ? (await analyzeProducts(ctx, table, mapping)).analysis : (await analyzePriceList(ctx, table, mapping)).analysis;
  } catch (error) {
    // Mapeamento automático incompleto: o usuário ajusta as colunas na tela.
    if (!(error instanceof ValidationError)) throw error;
    analysis = summarize(table.rows.length, 0, 0, 0, []);
  }

  return {
    importId: job.id,
    target: input.target,
    fileName,
    sheetName: table.sheetName,
    headers: table.headers,
    sampleRows: table.rows.slice(0, 8).map((row) => row.cells),
    totalRows: table.rows.length,
    mapping,
    analysis,
  };
}

/** Reanalisa o arquivo com o mapeamento escolhido pelo usuário (sem gravar nada). */
export async function analyzeImport(ctx: TenantContext, importId: string, mappingInput: unknown): Promise<ImportAnalysis> {
  assertCan(ctx, "catalog:import");
  const mapping = importMappingSchema.parse(mappingInput);
  const { payload, table } = await loadImportJob(ctx, importId);
  return payload.target === "products" ? (await analyzeProducts(ctx, table, mapping)).analysis : (await analyzePriceList(ctx, table, mapping)).analysis;
}

// ───────────────────────────── Etapa 2: aplicação ─────────────────────────────

export const applyImportOptionsSchema = z.object({
  /** Produtos: atualizar os SKUs que já existem? */
  updateExisting: z.boolean().default(true),
  /** Lista de preços: lista existente... */
  priceListId: idSchema.optional(),
  /** ...ou nome de uma nova lista. */
  newPriceListName: z.string().trim().min(2).max(100).optional(),
});

const CHUNK_SIZE = 200;

export async function applyImport(ctx: TenantContext, importId: string, mappingInput: unknown, optionsInput: unknown = {}): Promise<ImportResult> {
  assertCan(ctx, "catalog:import");
  const mapping = importMappingSchema.parse(mappingInput);
  const options = applyImportOptionsSchema.parse(optionsInput);
  const { job, payload, table } = await loadImportJob(ctx, importId);
  const db = tenantDb(ctx.organizationId);
  const org = ctx.organizationId;

  let result: ImportResult;

  if (payload.target === "products") {
    const { rows, existingSkus, analysis } = await analyzeProducts(ctx, table, mapping);
    result = { created: 0, updated: 0, skipped: 0, errors: analysis.stats.errors, aliasesCreated: 0 };

    await db.$transaction(
      async (tx) => {
        const affected = new Map<string, string>();
        const updatedIds: string[] = [];
        const newRows = rows.filter((row) => !existingSkus.has(row.skuNormalized));
        const existingRows = rows.filter((row) => existingSkus.has(row.skuNormalized));
        const toWrite = options.updateExisting ? rows : newRows;
        if (!options.updateExisting) result.skipped = existingRows.length;

        // Novos produtos.
        for (let start = 0; start < newRows.length; start += CHUNK_SIZE) {
          const chunk = newRows.slice(start, start + CHUNK_SIZE);
          const values = chunk.map((row) => {
            const fields = buildProductSearchFields({ ...row, aliases: row.synonyms });
            const attributes = buildProductAttributes(row.description, undefined, row.attributeText);
            return Prisma.sql`(
              ${org}::uuid, ${row.sku}, ${fields.skuNormalized}, ${row.description}, ${fields.descriptionNormalized},
              ${row.manufacturer}, ${row.manufacturerCode}, ${fields.manufacturerCodeNormalized}, ${row.category},
              ${row.unit ?? "UN"}, ${JSON.stringify(attributes)}::jsonb, ${row.price}::numeric, ${row.isActive ?? true}, ${fields.searchText}
            )`;
          });
          const inserted = await tx.$queryRaw<Array<{ id: string; sku_normalized: string }>>(Prisma.sql`
            INSERT INTO products (
              organization_id, sku, sku_normalized, description, description_normalized,
              manufacturer, manufacturer_code, manufacturer_code_normalized, category,
              unit, attributes, price, is_active, search_text
            )
            VALUES ${Prisma.join(values)}
            ON CONFLICT (organization_id, sku_normalized) DO NOTHING
            RETURNING id, sku_normalized
          `);
          for (const row of inserted) affected.set(row.sku_normalized, row.id);
          result.created += inserted.length;
          result.skipped += chunk.length - inserted.length;
        }

        // Produtos existentes: campos opcionais em branco no arquivo preservam o valor já cadastrado.
        if (options.updateExisting) {
          for (let start = 0; start < existingRows.length; start += CHUNK_SIZE) {
            const chunk = existingRows.slice(start, start + CHUNK_SIZE);
            const values = chunk.map((row) => {
              const fields = buildProductSearchFields(row);
              const attributes = buildProductAttributes(row.description, undefined, row.attributeText);
              return Prisma.sql`(
                ${row.sku}::text, ${fields.skuNormalized}::text, ${row.description}::text, ${fields.descriptionNormalized}::text,
                ${row.manufacturer}::text, ${row.manufacturerCode}::text, ${fields.manufacturerCodeNormalized}::text, ${row.category}::text,
                ${row.unit}::text, ${JSON.stringify(attributes)}::jsonb, ${row.price}::numeric, ${row.isActive}::boolean
              )`;
            });
            const updated = await tx.$queryRaw<Array<{ id: string; sku_normalized: string }>>(Prisma.sql`
              UPDATE products AS p SET
                sku = v.sku,
                description = v.description,
                description_normalized = v.description_normalized,
                manufacturer = coalesce(v.manufacturer, p.manufacturer),
                manufacturer_code = coalesce(v.manufacturer_code, p.manufacturer_code),
                manufacturer_code_normalized = coalesce(v.manufacturer_code_normalized, p.manufacturer_code_normalized),
                category = coalesce(v.category, p.category),
                unit = coalesce(v.unit, p.unit),
                attributes = p.attributes || v.attributes,
                price = coalesce(v.price, p.price),
                is_active = coalesce(v.is_active, p.is_active),
                updated_at = now()
              FROM (VALUES ${Prisma.join(values)}) AS v (
                sku, sku_normalized, description, description_normalized,
                manufacturer, manufacturer_code, manufacturer_code_normalized, category,
                unit, attributes, price, is_active
              )
              WHERE p.organization_id = ${org}::uuid AND p.sku_normalized = v.sku_normalized
              RETURNING p.id, p.sku_normalized
            `);
            for (const row of updated) {
              affected.set(row.sku_normalized, row.id);
              updatedIds.push(row.id);
            }
            result.updated += updated.length;
          }
        }

        // Sinônimos informados na planilha.
        const aliasRows = toWrite.flatMap((row) => {
          const productId = affected.get(row.skuNormalized);
          if (!productId) return [];
          return row.synonyms.map((value) => ({
            organizationId: org,
            productId,
            type: "SYNONYM" as const,
            value,
            valueNormalized: normalizeText(value),
          }));
        });
        if (aliasRows.length > 0) {
          const created = await tx.productAlias.createMany({ data: aliasRows.filter((alias) => alias.valueNormalized), skipDuplicates: true });
          result.aliasesCreated = created.count;
        }

        // O texto de busca dos produtos atualizados é recalculado com os dados finais (incluindo sinônimos).
        for (let start = 0; start < updatedIds.length; start += CHUNK_SIZE) {
          await rebuildSearchText(tx, updatedIds.slice(start, start + CHUNK_SIZE));
        }

        await tx.processingJob.update({
          where: { id: job.id },
          data: { status: "SUCCEEDED", attempts: 1, startedAt: new Date(), finishedAt: new Date(), result: { ...result } },
        });
        await recordAudit(ctx, { action: "catalog.import", entityType: "ProcessingJob", entityId: job.id, metadata: { fileName: payload.fileName, ...result } }, tx);
      },
      { timeout: 180_000, maxWait: 15_000 },
    );
  } else {
    const { rows, analysis } = await analyzePriceList(ctx, table, mapping);
    if (!options.priceListId && !options.newPriceListName) throw new ValidationError("Escolha uma lista de preços ou informe o nome de uma nova.");
    result = { created: 0, updated: 0, skipped: 0, errors: analysis.stats.errors, aliasesCreated: 0 };

    await db.$transaction(
      async (tx) => {
        let priceListId = options.priceListId;
        if (priceListId) {
          const list = await tx.priceList.findUnique({ where: { id: priceListId }, select: { id: true } });
          if (!list) throw new NotFoundError("Lista de preços");
        } else {
          const name = options.newPriceListName ?? "";
          const duplicate = await tx.priceList.findFirst({ where: { name }, select: { id: true } });
          if (duplicate) throw new ConflictError(`Já existe uma lista de preços chamada "${name}".`);
          priceListId = (await tx.priceList.create({ data: { organizationId: org, name } })).id;
        }

        for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
          const chunk = rows.slice(start, start + CHUNK_SIZE);
          const written = await tx.$queryRaw<Array<{ inserted: boolean }>>(Prisma.sql`
            INSERT INTO price_list_items AS i (organization_id, price_list_id, product_id, unit_price)
            VALUES ${Prisma.join(chunk.map((row) => Prisma.sql`(${org}::uuid, ${priceListId}::uuid, ${row.productId}::uuid, ${row.price}::numeric)`))}
            ON CONFLICT (price_list_id, product_id) DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = now()
            RETURNING (xmax = 0) AS inserted
          `);
          for (const row of written) {
            if (row.inserted) result.created += 1;
            else result.updated += 1;
          }
        }
        result.priceListId = priceListId;

        await tx.processingJob.update({
          where: { id: job.id },
          data: { status: "SUCCEEDED", attempts: 1, startedAt: new Date(), finishedAt: new Date(), result: { ...result } },
        });
        await recordAudit(ctx, { action: "price_list.import", entityType: "PriceList", entityId: priceListId, metadata: { fileName: payload.fileName, ...result } }, tx);
      },
      { timeout: 180_000, maxWait: 15_000 },
    );
  }

  // O arquivo importado não é mais necessário.
  await storage().delete(payload.storageKey).catch(() => undefined);
  return result;
}

/** Remove arquivos de importações iniciadas e nunca concluídas (rotina de manutenção). */
export async function cleanupAbandonedImports(olderThanHours = 24): Promise<number> {
  const { getPrisma } = await import("@/platform/db");
  const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000);
  const jobs = await getPrisma().processingJob.findMany({
    where: { type: { in: ["CATALOG_IMPORT", "PRICE_LIST_IMPORT"] }, status: "QUEUED", createdAt: { lt: cutoff } },
    select: { id: true, organizationId: true, payload: true },
    take: 200,
  });
  for (const job of jobs) {
    const payload = job.payload as unknown as Partial<ImportJobPayload>;
    if (payload.storageKey) await storage().delete(payload.storageKey).catch(() => undefined);
    await tenantDb(job.organizationId).processingJob.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: "Importação não concluída pelo usuário.", finishedAt: new Date() },
    });
  }
  return jobs.length;
}
