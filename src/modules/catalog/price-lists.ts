import { z } from "zod";
import { recordAudit } from "@/modules/audit/audit";
import { assertCan } from "@/modules/identity/permissions";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError } from "@/platform/errors";
import { parseId } from "@/platform/ids";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
  .nullish()
  .transform((value) => (value ? new Date(`${value}T00:00:00.000Z`) : null));

export const priceListInputSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da lista").max(100),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  validFrom: dateString,
  validUntil: dateString,
});

export interface PriceListView {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  itemCount: number;
  customerCount: number;
  updatedAt: Date;
}

export async function listPriceLists(ctx: TenantContext): Promise<PriceListView[]> {
  assertCan(ctx, "catalog:read");
  const rows = await tenantDb(ctx.organizationId).priceList.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: { _count: { select: { items: true, customers: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    currency: row.currency,
    isDefault: row.isDefault,
    isActive: row.isActive,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    itemCount: row._count.items,
    customerCount: row._count.customers,
    updatedAt: row.updatedAt,
  }));
}

export async function createPriceList(ctx: TenantContext, input: z.input<typeof priceListInputSchema>): Promise<{ id: string }> {
  assertCan(ctx, "catalog:write");
  const data = priceListInputSchema.parse(input);
  if (data.validFrom && data.validUntil && data.validUntil < data.validFrom) {
    throw new ValidationError("A data final de vigência deve ser posterior à inicial.");
  }
  try {
    return await tenantDb(ctx.organizationId).$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.priceList.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      const created = await tx.priceList.create({
        data: {
          organizationId: ctx.organizationId,
          name: data.name,
          isDefault: data.isDefault ?? false,
          isActive: data.isActive ?? true,
          validFrom: data.validFrom,
          validUntil: data.validUntil,
        },
      });
      await recordAudit(ctx, { action: "price_list.create", entityType: "PriceList", entityId: created.id, metadata: { name: created.name } }, tx);
      return { id: created.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Já existe uma lista de preços chamada "${data.name}".`);
    throw error;
  }
}

/** Define a lista padrão da organização (no máximo uma — garantido também por índice parcial). */
export async function setDefaultPriceList(ctx: TenantContext, priceListId: string): Promise<void> {
  assertCan(ctx, "catalog:write");
  const id = parseId(priceListId, "Lista de preços");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const list = await tx.priceList.findUnique({ where: { id }, select: { id: true, isActive: true } });
    if (!list) throw new NotFoundError("Lista de preços");
    if (!list.isActive) throw new ValidationError("Uma lista inativa não pode ser a lista padrão.");
    await tx.priceList.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
    await tx.priceList.update({ where: { id }, data: { isDefault: true } });
    await recordAudit(ctx, { action: "price_list.set_default", entityType: "PriceList", entityId: id }, tx);
  });
}

export async function setPriceListActive(ctx: TenantContext, priceListId: string, isActive: boolean): Promise<void> {
  assertCan(ctx, "catalog:write");
  const id = parseId(priceListId, "Lista de preços");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const result = await tx.priceList.updateMany({ where: { id }, data: isActive ? { isActive } : { isActive, isDefault: false } });
    if (result.count === 0) throw new NotFoundError("Lista de preços");
    await recordAudit(ctx, { action: isActive ? "price_list.activate" : "price_list.deactivate", entityType: "PriceList", entityId: id }, tx);
  });
}

export interface PriceListItemView {
  productId: string;
  sku: string;
  description: string;
  unit: string;
  catalogPrice: string | null;
  unitPrice: string;
}

export async function getPriceList(
  ctx: TenantContext,
  priceListId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<{ list: PriceListView; items: PriceListItemView[]; total: number; page: number; pageCount: number }> {
  assertCan(ctx, "catalog:read");
  const id = parseId(priceListId, "Lista de preços");
  const pageSize = Math.min(options.pageSize ?? 50, 200);
  const page = Math.max(options.page ?? 1, 1);
  const db = tenantDb(ctx.organizationId);

  const row = await db.priceList.findUnique({ where: { id }, include: { _count: { select: { items: true, customers: true } } } });
  if (!row) throw new NotFoundError("Lista de preços");
  const items = await db.priceListItem.findMany({
    where: { priceListId: id },
    include: { product: { select: { sku: true, description: true, unit: true, price: true } } },
    orderBy: { product: { description: "asc" } },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return {
    list: {
      id: row.id,
      name: row.name,
      currency: row.currency,
      isDefault: row.isDefault,
      isActive: row.isActive,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      itemCount: row._count.items,
      customerCount: row._count.customers,
      updatedAt: row.updatedAt,
    },
    items: items.map((item) => ({
      productId: item.productId,
      sku: item.product.sku,
      description: item.product.description,
      unit: item.product.unit,
      catalogPrice: item.product.price?.toString() ?? null,
      unitPrice: item.unitPrice.toString(),
    })),
    total: row._count.items,
    page,
    pageCount: Math.max(Math.ceil(row._count.items / pageSize), 1),
  };
}

/** Define (ou remove, com `null`) o preço de um produto em uma lista. */
export async function setPriceListItem(ctx: TenantContext, priceListId: string, productId: string, unitPrice: number | null): Promise<void> {
  assertCan(ctx, "catalog:write");
  const listId = parseId(priceListId, "Lista de preços");
  const product = parseId(productId, "Produto");
  if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
    throw new ValidationError("Preço inválido.");
  }
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const list = await tx.priceList.findUnique({ where: { id: listId }, select: { id: true } });
    const productRow = await tx.product.findUnique({ where: { id: product }, select: { id: true } });
    if (!list) throw new NotFoundError("Lista de preços");
    if (!productRow) throw new NotFoundError("Produto");

    if (unitPrice === null) {
      await tx.priceListItem.deleteMany({ where: { priceListId: listId, productId: product } });
    } else {
      const existing = await tx.priceListItem.findFirst({ where: { priceListId: listId, productId: product }, select: { id: true } });
      if (existing) await tx.priceListItem.update({ where: { id: existing.id }, data: { unitPrice } });
      else await tx.priceListItem.create({ data: { organizationId: ctx.organizationId, priceListId: listId, productId: product, unitPrice } });
    }
    await recordAudit(
      ctx,
      { action: "price_list.item_set", entityType: "PriceList", entityId: listId, metadata: { productId: product, unitPrice } },
      tx,
    );
  });
}
