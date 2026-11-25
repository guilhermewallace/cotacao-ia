import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/modules/audit/audit";
import { buildProductAttributes, buildProductSearchFields } from "@/modules/catalog/search-text";
import { assertCan } from "@/modules/identity/permissions";
import { sanitizeAttributes, type TechnicalAttributes } from "@/modules/normalization/attributes";
import { normalizeCode, normalizeText, significantTokens } from "@/modules/normalization/text";
import { normalizeUnit } from "@/modules/normalization/units";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb, type TenantDbOrTx } from "@/modules/tenancy/tenant-db";
import { getPrisma } from "@/platform/db";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError } from "@/platform/errors";
import { parseId } from "@/platform/ids";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const productInputSchema = z.object({
  sku: z.string().trim().min(1, "Informe o SKU").max(60),
  description: z.string().trim().min(3, "Informe a descrição").max(300),
  manufacturer: optionalText(100),
  manufacturerCode: optionalText(80),
  category: optionalText(100),
  unit: z.string().trim().min(1, "Informe a unidade").max(12),
  price: z.number().nonnegative("O preço não pode ser negativo").max(99_999_999).nullish(),
  /** Quando omitido, os atributos são derivados da descrição. */
  attributes: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export type ProductInput = z.input<typeof productInputSchema>;

export interface ProductView {
  id: string;
  sku: string;
  description: string;
  manufacturer: string | null;
  manufacturerCode: string | null;
  category: string | null;
  unit: string;
  price: string | null;
  isActive: boolean;
  attributes: TechnicalAttributes;
  updatedAt: Date;
}

type ProductRow = {
  id: string;
  sku: string;
  description: string;
  manufacturer: string | null;
  manufacturerCode: string | null;
  category: string | null;
  unit: string;
  price: Prisma.Decimal | null;
  isActive: boolean;
  attributes: unknown;
  updatedAt: Date;
};

export function toProductView(row: ProductRow): ProductView {
  return {
    id: row.id,
    sku: row.sku,
    description: row.description,
    manufacturer: row.manufacturer,
    manufacturerCode: row.manufacturerCode,
    category: row.category,
    unit: row.unit,
    price: row.price ? row.price.toString() : null,
    isActive: row.isActive,
    attributes: sanitizeAttributes(row.attributes),
    updatedAt: row.updatedAt,
  };
}

function resolveUnit(raw: string): string {
  const unit = normalizeUnit(raw);
  if (!unit) throw new ValidationError(`Unidade de medida desconhecida: "${raw}". Use, por exemplo, UN, M, RL, CX, KG.`);
  return unit;
}

// ───────────────────────────── Consulta ─────────────────────────────

export interface ProductListFilters {
  query?: string;
  category?: string;
  manufacturer?: string;
  status?: "active" | "inactive" | "all";
  page?: number;
  pageSize?: number;
}

export interface ProductListResult {
  items: ProductView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** tsquery com correspondência por prefixo em todos os termos (busca enquanto digita). */
function prefixTsQuery(normalized: string): string | null {
  const tokens = significantTokens(normalized)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length > 0)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `${token}:*`).join(" & ");
}

/**
 * IDs de produtos que casam com a busca, ordenados por relevância:
 * código exato > prefixo de código > texto (FTS) > similaridade (trigram) > sinônimos.
 */
async function searchProductIds(
  organizationId: string,
  query: string,
  filters: { category?: string; manufacturer?: string; status: "active" | "inactive" | "all" },
  limit: number,
  offset: number,
): Promise<{ ids: string[]; total: number }> {
  const normalized = normalizeText(query);
  const code = normalizeCode(query);
  const tsQuery = prefixTsQuery(normalized);
  const likeCode = code.length >= 2 ? `${code}%` : null;

  const conditions: Prisma.Sql[] = [Prisma.sql`p.organization_id = ${organizationId}::uuid`];
  if (filters.category) conditions.push(Prisma.sql`p.category = ${filters.category}`);
  if (filters.manufacturer) conditions.push(Prisma.sql`p.manufacturer = ${filters.manufacturer}`);
  if (filters.status === "active") conditions.push(Prisma.sql`p.is_active = true`);
  if (filters.status === "inactive") conditions.push(Prisma.sql`p.is_active = false`);

  const matchers: Prisma.Sql[] = [];
  if (likeCode) {
    matchers.push(Prisma.sql`p.sku_normalized LIKE ${likeCode}`);
    matchers.push(Prisma.sql`p.manufacturer_code_normalized LIKE ${likeCode}`);
  }
  if (tsQuery) matchers.push(Prisma.sql`to_tsvector('portuguese', p.search_text) @@ to_tsquery('portuguese', ${tsQuery})`);
  if (normalized.length >= 3) {
    matchers.push(Prisma.sql`p.description_normalized % ${normalized}`);
    matchers.push(Prisma.sql`EXISTS (
      SELECT 1 FROM product_aliases a
      WHERE a.organization_id = p.organization_id AND a.product_id = p.id AND a.value_normalized % ${normalized}
    )`);
  }
  if (matchers.length === 0) return { ids: [], total: 0 };
  conditions.push(Prisma.sql`(${Prisma.join(matchers, " OR ")})`);

  const rows = await getPrisma().$queryRaw<Array<{ id: string; total: bigint }>>(Prisma.sql`
    SELECT p.id, count(*) OVER () AS total
    FROM products p
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY
      (CASE
        WHEN p.sku_normalized = ${code} THEN 4
        WHEN p.manufacturer_code_normalized = ${code} THEN 3
        WHEN ${likeCode}::text IS NOT NULL AND p.sku_normalized LIKE ${likeCode} THEN 2
        ELSE 0
      END) DESC,
      (CASE WHEN ${tsQuery}::text IS NOT NULL
        THEN ts_rank_cd(to_tsvector('portuguese', p.search_text), to_tsquery('portuguese', coalesce(${tsQuery}, 'x')))
        ELSE 0 END
        + similarity(p.description_normalized, ${normalized})) DESC,
      p.description ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return { ids: rows.map((row) => row.id), total: rows[0] ? Number(rows[0].total) : 0 };
}

export async function listProducts(ctx: TenantContext, filters: ProductListFilters = {}): Promise<ProductListResult> {
  assertCan(ctx, "catalog:read");
  const db = tenantDb(ctx.organizationId);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const status = filters.status ?? "active";
  const query = filters.query?.trim();

  if (query) {
    const { ids, total } = await searchProductIds(
      ctx.organizationId,
      query,
      { category: filters.category, manufacturer: filters.manufacturer, status },
      pageSize,
      (page - 1) * pageSize,
    );
    const rows = ids.length ? await db.product.findMany({ where: { id: { in: ids } } }) : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toProductView(row)] : [];
    });
    return { items, total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
  }

  const where: Prisma.ProductWhereInput = {
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.manufacturer ? { manufacturer: filters.manufacturer } : {}),
    ...(status === "all" ? {} : { isActive: status === "active" }),
  };
  const [rows, total] = await Promise.all([
    db.product.findMany({ where, orderBy: [{ description: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    db.product.count({ where }),
  ]);
  return { items: rows.map(toProductView), total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

/** Busca rápida para o seletor de produtos da revisão e da cotação. */
export async function searchProducts(ctx: TenantContext, query: string, limit = 12): Promise<ProductView[]> {
  assertCan(ctx, "catalog:read");
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const { ids } = await searchProductIds(ctx.organizationId, trimmed, { status: "active" }, Math.min(limit, 30), 0);
  if (ids.length === 0) return [];
  const rows = await tenantDb(ctx.organizationId).product.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toProductView(row)] : [];
  });
}

export interface ProductDetail extends ProductView {
  aliases: Array<{ id: string; type: "SYNONYM" | "MANUFACTURER_CODE"; value: string; manufacturer: string | null }>;
  priceListPrices: Array<{ priceListId: string; priceListName: string; unitPrice: string; isDefault: boolean }>;
}

export async function getProduct(ctx: TenantContext, productId: string): Promise<ProductDetail> {
  assertCan(ctx, "catalog:read");
  const id = parseId(productId, "Produto");
  const row = await tenantDb(ctx.organizationId).product.findUnique({
    where: { id },
    include: {
      aliases: { orderBy: [{ type: "asc" }, { value: "asc" }] },
      priceListItems: { include: { priceList: { select: { name: true, isDefault: true } } } },
    },
  });
  if (!row) throw new NotFoundError("Produto");
  return {
    ...toProductView(row),
    aliases: row.aliases.map((alias) => ({ id: alias.id, type: alias.type, value: alias.value, manufacturer: alias.manufacturer })),
    priceListPrices: row.priceListItems.map((item) => ({
      priceListId: item.priceListId,
      priceListName: item.priceList.name,
      unitPrice: item.unitPrice.toString(),
      isDefault: item.priceList.isDefault,
    })),
  };
}

export async function listProductFacets(ctx: TenantContext): Promise<{ categories: string[]; manufacturers: string[] }> {
  assertCan(ctx, "catalog:read");
  const db = tenantDb(ctx.organizationId);
  const [categories, manufacturers] = await Promise.all([
    db.product.findMany({ where: { category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    db.product.findMany({
      where: { manufacturer: { not: null } },
      distinct: ["manufacturer"],
      select: { manufacturer: true },
      orderBy: { manufacturer: "asc" },
    }),
  ]);
  return {
    categories: categories.flatMap((row) => (row.category ? [row.category] : [])),
    manufacturers: manufacturers.flatMap((row) => (row.manufacturer ? [row.manufacturer] : [])),
  };
}

// ───────────────────────────── Escrita ─────────────────────────────

/** Recalcula o texto de busca de produtos (após mudança em sinônimos ou dados básicos). */
export async function rebuildSearchText(db: TenantDbOrTx, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, description: true, manufacturer: true, manufacturerCode: true, category: true, aliases: { select: { value: true } } },
  });
  for (const product of products) {
    const fields = buildProductSearchFields({ ...product, aliases: product.aliases.map((alias) => alias.value) });
    await db.product.update({ where: { id: product.id }, data: { searchText: fields.searchText } });
  }
}

export async function createProduct(ctx: TenantContext, input: ProductInput): Promise<ProductView> {
  assertCan(ctx, "catalog:write");
  const data = productInputSchema.parse(input);
  const unit = resolveUnit(data.unit);
  const fields = buildProductSearchFields(data);
  if (!fields.skuNormalized) throw new ValidationError("O SKU deve conter letras ou números.");
  const attributes = buildProductAttributes(data.description, data.attributes);

  try {
    return await tenantDb(ctx.organizationId).$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          organizationId: ctx.organizationId,
          sku: data.sku,
          description: data.description,
          manufacturer: data.manufacturer,
          manufacturerCode: data.manufacturerCode,
          category: data.category,
          unit,
          price: data.price ?? null,
          isActive: data.isActive ?? true,
          attributes: attributes as object,
          ...fields,
        },
      });
      await recordAudit(ctx, { action: "product.create", entityType: "Product", entityId: created.id, metadata: { sku: created.sku } }, tx);
      return toProductView(created);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Já existe um produto com o SKU "${data.sku}".`);
    throw error;
  }
}

export async function updateProduct(ctx: TenantContext, productId: string, input: ProductInput): Promise<ProductView> {
  assertCan(ctx, "catalog:write");
  const id = parseId(productId, "Produto");
  const data = productInputSchema.parse(input);
  const unit = resolveUnit(data.unit);

  try {
    return await tenantDb(ctx.organizationId).$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id }, include: { aliases: { select: { value: true } } } });
      if (!existing) throw new NotFoundError("Produto");

      const fields = buildProductSearchFields({ ...data, aliases: existing.aliases.map((alias) => alias.value) });
      if (!fields.skuNormalized) throw new ValidationError("O SKU deve conter letras ou números.");
      const attributes = data.attributes ? sanitizeAttributes(data.attributes) : buildProductAttributes(data.description);

      const updated = await tx.product.update({
        where: { id },
        data: {
          sku: data.sku,
          description: data.description,
          manufacturer: data.manufacturer,
          manufacturerCode: data.manufacturerCode,
          category: data.category,
          unit,
          price: data.price ?? null,
          isActive: data.isActive ?? existing.isActive,
          attributes: attributes as object,
          ...fields,
        },
      });
      const priceChanged = (existing.price?.toString() ?? null) !== (updated.price?.toString() ?? null);
      await recordAudit(
        ctx,
        {
          action: "product.update",
          entityType: "Product",
          entityId: id,
          metadata: {
            sku: updated.sku,
            ...(priceChanged ? { priceBefore: existing.price?.toString() ?? null, priceAfter: updated.price?.toString() ?? null } : {}),
          },
        },
        tx,
      );
      return toProductView(updated);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Já existe um produto com o SKU "${data.sku}".`);
    throw error;
  }
}

export async function setProductActive(ctx: TenantContext, productId: string, isActive: boolean): Promise<void> {
  assertCan(ctx, "catalog:write");
  const id = parseId(productId, "Produto");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const result = await tx.product.updateMany({ where: { id }, data: { isActive } });
    if (result.count === 0) throw new NotFoundError("Produto");
    await recordAudit(ctx, { action: isActive ? "product.activate" : "product.deactivate", entityType: "Product", entityId: id }, tx);
  });
}

// ─────────────────────── Sinônimos e códigos de fabricante ───────────────────────

export const aliasInputSchema = z.object({
  type: z.enum(["SYNONYM", "MANUFACTURER_CODE"]),
  value: z.string().trim().min(2, "Informe ao menos 2 caracteres").max(160),
  manufacturer: optionalText(100),
});

export async function addProductAlias(ctx: TenantContext, productId: string, input: z.input<typeof aliasInputSchema>): Promise<void> {
  assertCan(ctx, "catalog:write");
  const id = parseId(productId, "Produto");
  const data = aliasInputSchema.parse(input);
  const valueNormalized = data.type === "MANUFACTURER_CODE" ? normalizeCode(data.value) : normalizeText(data.value);
  if (!valueNormalized) throw new ValidationError("Valor inválido.");

  try {
    await tenantDb(ctx.organizationId).$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id }, select: { id: true } });
      if (!product) throw new NotFoundError("Produto");
      await tx.productAlias.create({
        data: {
          organizationId: ctx.organizationId,
          productId: id,
          type: data.type,
          value: data.value,
          valueNormalized,
          manufacturer: data.type === "MANUFACTURER_CODE" ? data.manufacturer : null,
        },
      });
      await rebuildSearchText(tx, [id]);
      await recordAudit(ctx, { action: "product.alias_add", entityType: "Product", entityId: id, metadata: { type: data.type, value: data.value } }, tx);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Este sinônimo ou código já está cadastrado para o produto.");
    throw error;
  }
}

export async function removeProductAlias(ctx: TenantContext, productId: string, aliasId: string): Promise<void> {
  assertCan(ctx, "catalog:write");
  const id = parseId(productId, "Produto");
  const alias = parseId(aliasId, "Sinônimo");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const result = await tx.productAlias.deleteMany({ where: { id: alias, productId: id } });
    if (result.count === 0) throw new NotFoundError("Sinônimo");
    await rebuildSearchText(tx, [id]);
    await recordAudit(ctx, { action: "product.alias_remove", entityType: "Product", entityId: id }, tx);
  });
}

// ───────────────────────────── Duplicidades ─────────────────────────────

export interface DuplicateGroup {
  reason: "MANUFACTURER_CODE" | "SIMILAR_DESCRIPTION";
  detail: string;
  products: Array<{ id: string; sku: string; description: string; manufacturer: string | null; isActive: boolean }>;
}

/**
 * Possíveis duplicidades no catálogo:
 * - mesmo código de fabricante em SKUs diferentes;
 * - descrições praticamente idênticas (similaridade ≥ 0,92) do mesmo fabricante.
 * SKUs idênticos são impedidos pela restrição de unicidade.
 */
export async function findDuplicateGroups(ctx: TenantContext, limit = 50): Promise<DuplicateGroup[]> {
  assertCan(ctx, "catalog:read");
  const prisma = getPrisma();
  type Pair = {
    reason: string;
    detail: string;
    a_id: string;
    a_sku: string;
    a_description: string;
    a_manufacturer: string | null;
    a_active: boolean;
    b_id: string;
    b_sku: string;
    b_description: string;
    b_manufacturer: string | null;
    b_active: boolean;
  };
  const pairs = await prisma.$queryRaw<Pair[]>(Prisma.sql`
    SELECT 'MANUFACTURER_CODE' AS reason, coalesce(a.manufacturer_code, '') AS detail,
           a.id AS a_id, a.sku AS a_sku, a.description AS a_description, a.manufacturer AS a_manufacturer, a.is_active AS a_active,
           b.id AS b_id, b.sku AS b_sku, b.description AS b_description, b.manufacturer AS b_manufacturer, b.is_active AS b_active
    FROM products a
    JOIN products b
      ON b.organization_id = a.organization_id
     AND b.manufacturer_code_normalized = a.manufacturer_code_normalized
     AND b.id > a.id
    WHERE a.organization_id = ${ctx.organizationId}::uuid
      AND a.manufacturer_code_normalized IS NOT NULL
      AND coalesce(lower(a.manufacturer), '') = coalesce(lower(b.manufacturer), '')
    UNION ALL
    SELECT 'SIMILAR_DESCRIPTION' AS reason,
           round(similarity(a.description_normalized, b.description_normalized)::numeric * 100)::text || '%' AS detail,
           a.id, a.sku, a.description, a.manufacturer, a.is_active,
           b.id, b.sku, b.description, b.manufacturer, b.is_active
    FROM products a
    JOIN products b
      ON b.organization_id = a.organization_id
     AND b.id > a.id
     AND b.description_normalized % a.description_normalized
     AND similarity(a.description_normalized, b.description_normalized) >= 0.92
     AND coalesce(lower(a.manufacturer), '') = coalesce(lower(b.manufacturer), '')
    WHERE a.organization_id = ${ctx.organizationId}::uuid
      AND (a.manufacturer_code_normalized IS NULL OR b.manufacturer_code_normalized IS NULL
           OR a.manufacturer_code_normalized <> b.manufacturer_code_normalized)
    LIMIT ${limit}
  `);

  return pairs.map((pair) => ({
    reason: pair.reason as DuplicateGroup["reason"],
    detail: pair.detail,
    products: [
      { id: pair.a_id, sku: pair.a_sku, description: pair.a_description, manufacturer: pair.a_manufacturer, isActive: pair.a_active },
      { id: pair.b_id, sku: pair.b_sku, description: pair.b_description, manufacturer: pair.b_manufacturer, isActive: pair.b_active },
    ],
  }));
}
