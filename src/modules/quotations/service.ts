import { digitsOnly } from "@/modules/customers/customers";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { PriceSource, QuotationStatus } from "@/generated/prisma/enums";
import { recordAudit } from "@/modules/audit/audit";
import { assertCan } from "@/modules/identity/permissions";
import { resolvePrices } from "@/modules/pricing/resolve";
import { computeLineTotal, computeTotals, formatQuotationNumber } from "@/modules/quotations/totals";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb, type TenantTx } from "@/modules/tenancy/tenant-db";
import { addDays, dateOnly, todayDateOnly } from "@/platform/dates";
import { getPrisma } from "@/platform/db";
import { ConflictError, NotFoundError, ValidationError } from "@/platform/errors";
import { idSchema, parseId } from "@/platform/ids";

/**
 * Cotações comerciais.
 *
 * Preços: vêm do catálogo/listas de preços (via revisão) ou são informados por uma
 * pessoa — nunca por IA. Cada linha guarda a origem do preço (lista, catálogo, manual).
 * Uma cotação é editável enquanto RASCUNHO; ao ser FINALIZADA fica congelada.
 */

// ───────────────────────────── Visões ─────────────────────────────

export interface QuotationItemView {
  id: string;
  lineNumber: number;
  productId: string | null;
  sku: string | null;
  description: string;
  unit: string | null;
  quantity: string;
  unitPrice: string | null;
  discountPercent: string;
  lineTotal: string;
  priceSource: PriceSource | null;
  available: boolean;
  notes: string | null;
}

export interface QuotationView {
  id: string;
  number: string;
  status: QuotationStatus;
  requestId: string | null;
  customerId: string | null;
  customerName: string;
  customerTaxId: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerContact: string | null;
  priceListName: string | null;
  issueDate: Date;
  validUntil: Date;
  notes: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  discountPercent: string;
  subtotal: string;
  discountTotal: string;
  total: string;
  currency: string;
  createdByName: string | null;
  finalizedAt: Date | null;
  createdAt: Date;
  items: QuotationItemView[];
}

const quotationInclude = {
  items: { orderBy: { lineNumber: "asc" } },
  priceList: { select: { name: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.QuotationInclude;

type QuotationRow = Prisma.QuotationGetPayload<{ include: typeof quotationInclude }>;

function toView(row: QuotationRow): QuotationView {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    requestId: row.quotationRequestId,
    customerId: row.customerId,
    customerName: row.customerName,
    customerTaxId: row.customerTaxId,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    customerContact: row.customerContact,
    priceListName: row.priceList?.name ?? null,
    issueDate: row.issueDate,
    validUntil: row.validUntil,
    notes: row.notes,
    paymentTerms: row.paymentTerms,
    deliveryTerms: row.deliveryTerms,
    discountPercent: row.discountPercent.toString(),
    subtotal: row.subtotal.toFixed(2),
    discountTotal: row.discountTotal.toFixed(2),
    total: row.total.toFixed(2),
    currency: row.currency,
    createdByName: row.createdBy?.name ?? null,
    finalizedAt: row.finalizedAt,
    createdAt: row.createdAt,
    items: row.items.map((item) => ({
      id: item.id,
      lineNumber: item.lineNumber,
      productId: item.productId,
      sku: item.sku,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice?.toString() ?? null,
      discountPercent: item.discountPercent.toString(),
      lineTotal: item.lineTotal.toFixed(2),
      priceSource: item.priceSource,
      available: item.available,
      notes: item.notes,
    })),
  };
}

export async function getQuotation(ctx: TenantContext, quotationId: string): Promise<QuotationView> {
  assertCan(ctx, "quotation:read");
  const id = parseId(quotationId, "Cotação");
  const row = await tenantDb(ctx.organizationId).quotation.findUnique({ where: { id }, include: quotationInclude });
  if (!row) throw new NotFoundError("Cotação");
  return toView(row);
}

export interface QuotationListItem {
  id: string;
  number: string;
  status: QuotationStatus;
  customerName: string;
  issueDate: Date;
  validUntil: Date;
  total: string;
  itemCount: number;
  createdByName: string | null;
  requestId: string | null;
}

export async function listQuotations(
  ctx: TenantContext,
  filters: { status?: QuotationStatus | "all"; query?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: QuotationListItem[]; total: number; page: number; pageSize: number; pageCount: number }> {
  assertCan(ctx, "quotation:read");
  const pageSize = Math.min(Math.max(filters.pageSize ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const query = filters.query?.trim();
  const where: Prisma.QuotationWhereInput = {
    ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
    ...(query ? { OR: [{ number: { contains: query, mode: "insensitive" } }, { customerName: { contains: query, mode: "insensitive" } }] } : {}),
  };
  const db = tenantDb(ctx.organizationId);
  const [rows, total] = await Promise.all([
    db.quotation.findMany({
      where,
      orderBy: [{ sequence: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { createdBy: { select: { name: true } }, _count: { select: { items: true } } },
    }),
    db.quotation.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      customerName: row.customerName,
      issueDate: row.issueDate,
      validUntil: row.validUntil,
      total: row.total.toFixed(2),
      itemCount: row._count.items,
      createdByName: row.createdBy?.name ?? null,
      requestId: row.quotationRequestId,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
  };
}

// ───────────────────────────── Criação ─────────────────────────────

/** Próximo número sequencial da organização — incremento atômico, sem buracos por concorrência. */
async function nextSequence(tx: TenantTx, organizationId: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ quotation_sequence: number }>>(Prisma.sql`
    UPDATE organizations SET quotation_sequence = quotation_sequence + 1, updated_at = now()
    WHERE id = ${organizationId}::uuid
    RETURNING quotation_sequence
  `);
  const sequence = rows[0]?.quotation_sequence;
  if (!sequence) throw new Error("Organização não encontrada ao gerar o número da cotação.");
  return sequence;
}

async function recalculate(tx: TenantTx, quotationId: string): Promise<void> {
  const quotation = await tx.quotation.findUniqueOrThrow({ where: { id: quotationId }, select: { discountPercent: true, items: true } });
  for (const item of quotation.items) {
    const lineTotal = computeLineTotal(item);
    if (!lineTotal.equals(item.lineTotal)) await tx.quotationItem.update({ where: { id: item.id }, data: { lineTotal } });
  }
  const totals = computeTotals(quotation.items, quotation.discountPercent);
  await tx.quotation.update({ where: { id: quotationId }, data: totals });
}

/**
 * Gera a cotação a partir de uma solicitação totalmente revisada.
 * Itens confirmados viram linhas com produto e preço; itens "não encontrados"
 * constam como não atendidos, para o cliente saber o que ficou de fora.
 */
export async function createQuotationFromRequest(ctx: TenantContext, requestId: string): Promise<{ id: string; number: string }> {
  assertCan(ctx, "quotation:write");
  const request = parseId(requestId, "Solicitação");
  const organization = await getPrisma().organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { defaultQuotationValidityDays: true },
  });

  return tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const requestRow = await tx.quotationRequest.findUnique({
      where: { id: request },
      include: {
        customer: true,
        inboundMessage: { select: { senderName: true, channel: true } },
        items: { orderBy: { lineNumber: "asc" }, include: { selectedProduct: true } },
      },
    });
    if (!requestRow) throw new NotFoundError("Solicitação");
    if (requestRow.status === "QUOTED") throw new ConflictError("Esta solicitação já possui uma cotação.");
    if (requestRow.status !== "AWAITING_REVIEW") throw new ConflictError("A solicitação ainda não está pronta para gerar cotação.");

    const pending = requestRow.items.filter((item) => item.status === "PENDING");
    if (pending.length > 0) {
      throw new ValidationError(`Ainda há ${pending.length} ${pending.length === 1 ? "item pendente" : "itens pendentes"} de revisão.`, {
        pendingLines: pending.map((item) => item.lineNumber),
      });
    }
    const confirmed = requestRow.items.filter((item) => item.status === "CONFIRMED" && item.selectedProduct);
    if (confirmed.length === 0) throw new ValidationError("Nenhum item foi confirmado — não há o que cotar.");
    const withoutQuantity = confirmed.filter((item) => item.quantity === null);
    if (withoutQuantity.length > 0) {
      throw new ValidationError(`Informe a quantidade ${withoutQuantity.length === 1 ? "do item" : "dos itens"} ${withoutQuantity.map((item) => item.lineNumber).join(", ")}.`);
    }

    const issueDate = todayDateOnly();
    const sequence = await nextSequence(tx, ctx.organizationId);
    const number = formatQuotationNumber(sequence, issueDate);
    const hint = (requestRow.customerHint ?? {}) as { name?: string | null; taxId?: string | null; email?: string | null; phone?: string | null; contactName?: string | null };
    const customer = requestRow.customer;

    const lines = requestRow.items
      .filter((item) => item.status !== "PENDING")
      .map((item, index) => {
        const available = item.status === "CONFIRMED" && Boolean(item.selectedProduct);
        const quantity = item.quantity ?? new Prisma.Decimal(1);
        const line = {
          organizationId: ctx.organizationId,
          lineNumber: index + 1,
          requestedItemId: item.id,
          productId: available ? item.selectedProductId : null,
          sku: available ? (item.selectedProduct?.sku ?? null) : null,
          description: available ? (item.selectedProduct?.description ?? item.originalDescription) : item.originalDescription,
          unit: available ? (item.selectedProduct?.unit ?? item.unit) : item.unit,
          quantity,
          unitPrice: available ? item.unitPrice : null,
          priceSource: available ? item.priceSource : null,
          available,
          notes: available ? null : "Item não disponível em nosso catálogo.",
        };
        return { ...line, lineTotal: computeLineTotal(line) };
      });
    const totals = computeTotals(lines, 0);

    const quotation = await tx.quotation.create({
      data: {
        organizationId: ctx.organizationId,
        sequence,
        number,
        quotationRequestId: request,
        customerId: customer?.id ?? null,
        priceListId: customer?.priceListId ?? null,
        // No upload manual o "remetente" é o próprio usuário interno — não é o cliente.
        customerName:
          customer?.name ?? hint.name ?? (requestRow.inboundMessage.channel === "UPLOAD" ? null : requestRow.inboundMessage.senderName) ?? "Cliente a definir",
        customerTaxId: customer?.taxId ?? null,
        customerEmail: customer?.email ?? null,
        customerPhone: customer?.phone ?? null,
        customerContact: customer?.contactName ?? hint.contactName ?? null,
        issueDate,
        validUntil: addDays(issueDate, organization.defaultQuotationValidityDays),
        createdById: ctx.userId,
        ...totals,
      },
    });
    await tx.quotationItem.createMany({ data: lines.map((line) => ({ ...line, quotationId: quotation.id })) });
    await tx.quotationRequest.update({ where: { id: request }, data: { status: "QUOTED", reviewedAt: new Date(), reviewedById: ctx.userId } });
    await recordAudit(
      ctx,
      { action: "quotation.create", entityType: "Quotation", entityId: quotation.id, metadata: { number, requestId: request, lines: lines.length } },
      tx,
    );
    return { id: quotation.id, number };
  });
}

// ───────────────────────────── Edição ─────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const percent = z.number().min(0, "O desconto não pode ser negativo").max(100, "O desconto não pode passar de 100%");

export const quotationUpdateSchema = z.object({
  customerId: idSchema.nullish().transform((value) => value ?? null),
  customerName: z.string().trim().min(2, "Informe o cliente").max(200),
  // CNPJ/CPF guardado só com dígitos, como no cadastro de clientes (a máscara é aplicada na exibição).
  customerTaxId: optionalText(20).transform((value) => digitsOnly(value)),
  customerEmail: optionalText(200),
  customerPhone: optionalText(30),
  customerContact: optionalText(120),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de validade inválida"),
  notes: optionalText(4000),
  paymentTerms: optionalText(500),
  deliveryTerms: optionalText(500),
  discountPercent: percent,
  items: z
    .array(
      z.object({
        id: idSchema,
        quantity: z.number().positive("A quantidade deve ser maior que zero").max(9_999_999),
        unitPrice: z.number().min(0, "O preço não pode ser negativo").max(99_999_999).nullable(),
        discountPercent: percent,
        notes: optionalText(500),
      }),
    )
    .max(500),
  removedItemIds: z.array(idSchema).max(500).optional(),
  addedItems: z.array(z.object({ productId: idSchema, quantity: z.number().positive().max(9_999_999) })).max(100).optional(),
});

export type QuotationUpdateInput = z.input<typeof quotationUpdateSchema>;

async function loadDraft(tx: TenantTx, quotationId: string) {
  const quotation = await tx.quotation.findUnique({ where: { id: quotationId }, include: { items: true } });
  if (!quotation) throw new NotFoundError("Cotação");
  if (quotation.status !== "DRAFT") throw new ConflictError("Somente cotações em rascunho podem ser editadas.");
  return quotation;
}

export async function updateQuotation(ctx: TenantContext, quotationId: string, input: QuotationUpdateInput): Promise<QuotationView> {
  assertCan(ctx, "quotation:write");
  const id = parseId(quotationId, "Cotação");
  const data = quotationUpdateSchema.parse(input);

  return tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const quotation = await loadDraft(tx, id);
    const validUntil = dateOnly(data.validUntil);
    if (validUntil < quotation.issueDate) throw new ValidationError("A validade não pode ser anterior à data da cotação.");

    let priceListId = quotation.priceListId;
    if (data.customerId !== quotation.customerId) {
      if (data.customerId) {
        const customer = await tx.customer.findUnique({ where: { id: data.customerId }, select: { priceListId: true } });
        if (!customer) throw new NotFoundError("Cliente");
        priceListId = customer.priceListId;
      } else {
        priceListId = null;
      }
    }

    const existing = new Map(quotation.items.map((item) => [item.id, item]));
    const priceChanges: Array<{ line: number; before: string | null; after: number | null }> = [];

    for (const removedId of data.removedItemIds ?? []) {
      if (!existing.has(removedId)) throw new NotFoundError("Item da cotação");
      await tx.quotationItem.delete({ where: { id: removedId } });
      existing.delete(removedId);
    }

    for (const line of data.items) {
      const current = existing.get(line.id);
      if (!current) throw new NotFoundError("Item da cotação");
      const priceChanged = (current.unitPrice?.toNumber() ?? null) !== line.unitPrice;
      if (priceChanged) priceChanges.push({ line: current.lineNumber, before: current.unitPrice?.toString() ?? null, after: line.unitPrice });
      await tx.quotationItem.update({
        where: { id: line.id },
        data: {
          quantity: line.quantity,
          unitPrice: current.available ? line.unitPrice : null,
          discountPercent: line.discountPercent,
          notes: line.notes,
          // Preço alterado à mão passa a ser MANUAL; preço removido perde a origem.
          ...(priceChanged ? { priceSource: line.unitPrice === null ? null : "MANUAL" } : {}),
        },
      });
    }

    if (data.addedItems?.length) {
      const products = await tx.product.findMany({ where: { id: { in: data.addedItems.map((item) => item.productId) }, isActive: true } });
      const byId = new Map(products.map((product) => [product.id, product]));
      const prices = await resolvePrices(tx, [...byId.keys()], { customerId: data.customerId });
      let lineNumber = Math.max(0, ...[...existing.values()].map((item) => item.lineNumber));
      for (const added of data.addedItems) {
        const product = byId.get(added.productId);
        if (!product) throw new NotFoundError("Produto");
        const price = prices.get(product.id);
        lineNumber += 1;
        await tx.quotationItem.create({
          data: {
            organizationId: ctx.organizationId,
            quotationId: id,
            lineNumber,
            productId: product.id,
            sku: product.sku,
            description: product.description,
            unit: product.unit,
            quantity: added.quantity,
            unitPrice: price?.unitPrice ?? null,
            priceSource: price?.source ?? null,
          },
        });
      }
    }

    await tx.quotation.update({
      where: { id },
      data: {
        customerId: data.customerId,
        priceListId,
        customerName: data.customerName,
        customerTaxId: data.customerTaxId,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        customerContact: data.customerContact,
        validUntil,
        notes: data.notes,
        paymentTerms: data.paymentTerms,
        deliveryTerms: data.deliveryTerms,
        discountPercent: data.discountPercent,
      },
    });
    await recalculate(tx, id);
    await recordAudit(
      ctx,
      {
        action: "quotation.update",
        entityType: "Quotation",
        entityId: id,
        metadata: { number: quotation.number, ...(priceChanges.length > 0 ? { manualPriceChanges: priceChanges } : {}) },
      },
      tx,
    );
    return toView(await tx.quotation.findUniqueOrThrow({ where: { id }, include: quotationInclude }));
  });
}

/** Reaplica os preços de catálogo/lista a todas as linhas com produto (descarta preços manuais). */
export async function repriceQuotation(ctx: TenantContext, quotationId: string): Promise<void> {
  assertCan(ctx, "quotation:write");
  const id = parseId(quotationId, "Cotação");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const quotation = await loadDraft(tx, id);
    const lines = quotation.items.filter((item) => item.available && item.productId);
    const prices = await resolvePrices(tx, lines.flatMap((item) => (item.productId ? [item.productId] : [])), { customerId: quotation.customerId });
    for (const line of lines) {
      const price = line.productId ? prices.get(line.productId) : undefined;
      await tx.quotationItem.update({ where: { id: line.id }, data: { unitPrice: price?.unitPrice ?? null, priceSource: price?.source ?? null } });
    }
    await recalculate(tx, id);
    await recordAudit(ctx, { action: "quotation.reprice", entityType: "Quotation", entityId: id, metadata: { number: quotation.number } }, tx);
  });
}

// ───────────────────────────── Ciclo de vida ─────────────────────────────

export async function finalizeQuotation(ctx: TenantContext, quotationId: string): Promise<void> {
  assertCan(ctx, "quotation:finalize");
  const id = parseId(quotationId, "Cotação");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const quotation = await loadDraft(tx, id);
    const priced = quotation.items.filter((item) => item.available);
    if (priced.length === 0) throw new ValidationError("A cotação não tem itens disponíveis.");
    const withoutPrice = priced.filter((item) => item.unitPrice === null);
    if (withoutPrice.length > 0) {
      throw new ValidationError(
        `Informe o preço ${withoutPrice.length === 1 ? "do item" : "dos itens"} ${withoutPrice.map((item) => item.lineNumber).join(", ")} antes de finalizar.`,
      );
    }
    await recalculate(tx, id);
    await tx.quotation.update({ where: { id }, data: { status: "FINALIZED", finalizedAt: new Date(), finalizedById: ctx.userId } });
    await recordAudit(ctx, { action: "quotation.finalize", entityType: "Quotation", entityId: id, metadata: { number: quotation.number } }, tx);
  });
}

export async function reopenQuotation(ctx: TenantContext, quotationId: string): Promise<void> {
  assertCan(ctx, "quotation:finalize");
  const id = parseId(quotationId, "Cotação");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const result = await tx.quotation.updateMany({ where: { id, status: "FINALIZED" }, data: { status: "DRAFT", finalizedAt: null, finalizedById: null } });
    if (result.count === 0) throw new ConflictError("Somente cotações finalizadas podem ser reabertas.");
    await recordAudit(ctx, { action: "quotation.reopen", entityType: "Quotation", entityId: id }, tx);
  });
}

/** Cancela a cotação. A solicitação de origem volta para revisão e pode gerar outra cotação. */
export async function cancelQuotation(ctx: TenantContext, quotationId: string): Promise<void> {
  assertCan(ctx, "quotation:finalize");
  const id = parseId(quotationId, "Cotação");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const quotation = await tx.quotation.findUnique({ where: { id }, select: { status: true, quotationRequestId: true, number: true } });
    if (!quotation) throw new NotFoundError("Cotação");
    if (quotation.status === "CANCELED") return;
    await tx.quotation.update({ where: { id }, data: { status: "CANCELED" } });
    if (quotation.quotationRequestId) {
      const others = await tx.quotation.count({ where: { quotationRequestId: quotation.quotationRequestId, status: { not: "CANCELED" } } });
      if (others === 0) {
        await tx.quotationRequest.updateMany({ where: { id: quotation.quotationRequestId, status: "QUOTED" }, data: { status: "AWAITING_REVIEW" } });
      }
    }
    await recordAudit(ctx, { action: "quotation.cancel", entityType: "Quotation", entityId: id, metadata: { number: quotation.number } }, tx);
  });
}
