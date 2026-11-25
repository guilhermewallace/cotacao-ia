import { z } from "zod";
import { recordAudit } from "@/modules/audit/audit";
import { assertCan } from "@/modules/identity/permissions";
import { matchItem } from "@/modules/matching/engine";
import { PgCandidateRetriever } from "@/modules/matching/retrieval";
import { parseAttributes } from "@/modules/normalization/attribute-parser";
import { compareAttributes } from "@/modules/normalization/attribute-compare";
import { sanitizeAttributes } from "@/modules/normalization/attributes";
import { normalizeText } from "@/modules/normalization/text";
import { normalizeUnit } from "@/modules/normalization/units";
import { resolvePrice, resolvePrices } from "@/modules/pricing/resolve";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb, type TenantTx } from "@/modules/tenancy/tenant-db";
import { ConflictError, NotFoundError, ValidationError } from "@/platform/errors";
import { parseId } from "@/platform/ids";

/**
 * Revisão humana dos itens de uma solicitação.
 *
 * Cada ação é gravada imediatamente (não há "salvar tudo" a esquecer) e auditada.
 * Nenhuma correspondência é confirmada sem uma ação explícita de um usuário.
 * Após a geração da cotação, a revisão fica travada — ajustes passam a ser feitos na cotação.
 */

async function loadEditableItem(tx: TenantTx, itemId: string) {
  const item = await tx.requestedItem.findUnique({
    where: { id: itemId },
    include: { request: { select: { id: true, status: true, customerId: true } } },
  });
  if (!item) throw new NotFoundError("Item");
  assertRequestEditable(item.request.status);
  return item;
}

function assertRequestEditable(status: string): void {
  if (status === "QUOTED") throw new ConflictError("Esta solicitação já gerou uma cotação. Faça os ajustes na cotação.");
  if (status !== "AWAITING_REVIEW") throw new ConflictError("A solicitação não está disponível para revisão.");
}

async function touchReview(tx: TenantTx, ctx: TenantContext, requestId: string): Promise<void> {
  await tx.quotationRequest.update({ where: { id: requestId }, data: { reviewedAt: new Date(), reviewedById: ctx.userId } });
}

/** Aceita um candidato ou seleciona outro produto do catálogo para o item. */
export async function confirmItem(ctx: TenantContext, itemId: string, productId: string): Promise<void> {
  assertCan(ctx, "request:review");
  const id = parseId(itemId, "Item");
  const product = parseId(productId, "Produto");

  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const item = await loadEditableItem(tx, id);
    const productRow = await tx.product.findUnique({ where: { id: product }, select: { id: true, sku: true, isActive: true, attributes: true } });
    if (!productRow) throw new NotFoundError("Produto");
    if (!productRow.isActive) throw new ValidationError("Este produto está inativo no catálogo.");

    // Preço: mantém um preço manual já informado; caso contrário, vem do catálogo/lista.
    const keepManual = item.priceSource === "MANUAL" && item.unitPrice !== null && item.selectedProductId === product;
    const price = keepManual ? null : await resolvePrice(tx, product, { customerId: item.request.customerId });

    const comparison = compareAttributes(sanitizeAttributes(item.attributes), sanitizeAttributes(productRow.attributes));
    await tx.requestedItem.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        selectedProductId: product,
        ...(keepManual ? {} : { unitPrice: price?.unitPrice ?? null, priceSource: price?.source ?? null }),
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
      },
    });
    await touchReview(tx, ctx, item.request.id);
    await recordAudit(
      ctx,
      {
        action: "request.item_confirm",
        entityType: "RequestedItem",
        entityId: id,
        metadata: {
          requestId: item.request.id,
          productId: product,
          sku: productRow.sku,
          // Registra quando o revisor escolhe, conscientemente, um produto com divergência técnica.
          ...(comparison.compatible ? {} : { overrodeIncompatibility: comparison.criticalMismatches.map((entry) => entry.key) }),
        },
      },
      tx,
    );
  });
}

export async function markItemNotFound(ctx: TenantContext, itemId: string): Promise<void> {
  assertCan(ctx, "request:review");
  const id = parseId(itemId, "Item");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const item = await loadEditableItem(tx, id);
    await tx.requestedItem.update({
      where: { id },
      data: { status: "NOT_FOUND", selectedProductId: null, unitPrice: null, priceSource: null, reviewedById: ctx.userId, reviewedAt: new Date() },
    });
    await touchReview(tx, ctx, item.request.id);
    await recordAudit(ctx, { action: "request.item_not_found", entityType: "RequestedItem", entityId: id, metadata: { requestId: item.request.id } }, tx);
  });
}

/** Desfaz a decisão sobre o item, que volta a "pendente". */
export async function reopenItem(ctx: TenantContext, itemId: string): Promise<void> {
  assertCan(ctx, "request:review");
  const id = parseId(itemId, "Item");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const item = await loadEditableItem(tx, id);
    await tx.requestedItem.update({
      where: { id },
      data: { status: "PENDING", selectedProductId: null, unitPrice: null, priceSource: null, reviewedById: null, reviewedAt: null },
    });
    await recordAudit(ctx, { action: "request.item_reopen", entityType: "RequestedItem", entityId: id, metadata: { requestId: item.request.id } }, tx);
  });
}

const quantitySchema = z.object({
  quantity: z.number().positive("A quantidade deve ser maior que zero").max(9_999_999).nullable(),
  unit: z.string().trim().max(12).nullish(),
});

export async function updateItemQuantity(ctx: TenantContext, itemId: string, input: z.input<typeof quantitySchema>): Promise<void> {
  assertCan(ctx, "request:review");
  const id = parseId(itemId, "Item");
  const data = quantitySchema.parse(input);
  const unit = data.unit ? normalizeUnit(data.unit) : undefined;
  if (data.unit && !unit) throw new ValidationError(`Unidade de medida desconhecida: "${data.unit}".`);

  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const item = await loadEditableItem(tx, id);
    await tx.requestedItem.update({ where: { id }, data: { quantity: data.quantity, ...(unit ? { unit } : {}) } });
    await touchReview(tx, ctx, item.request.id);
    await recordAudit(
      ctx,
      {
        action: "request.item_quantity",
        entityType: "RequestedItem",
        entityId: id,
        metadata: { requestId: item.request.id, before: item.quantity?.toString() ?? null, after: data.quantity },
      },
      tx,
    );
  });
}

/**
 * Preço informado manualmente pelo revisor (fica marcado como MANUAL e auditado).
 * `null` descarta o preço manual e volta ao preço do catálogo/lista.
 */
export async function setItemPrice(ctx: TenantContext, itemId: string, unitPrice: number | null): Promise<void> {
  assertCan(ctx, "request:review");
  const id = parseId(itemId, "Item");
  if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 99_999_999)) {
    throw new ValidationError("Preço inválido.");
  }
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const item = await loadEditableItem(tx, id);
    if (!item.selectedProductId) throw new ValidationError("Selecione um produto antes de informar o preço.");

    if (unitPrice === null) {
      const price = await resolvePrice(tx, item.selectedProductId, { customerId: item.request.customerId });
      await tx.requestedItem.update({ where: { id }, data: { unitPrice: price.unitPrice, priceSource: price.source } });
    } else {
      await tx.requestedItem.update({ where: { id }, data: { unitPrice, priceSource: "MANUAL" } });
    }
    await touchReview(tx, ctx, item.request.id);
    await recordAudit(
      ctx,
      {
        action: "request.item_price",
        entityType: "RequestedItem",
        entityId: id,
        metadata: { requestId: item.request.id, before: item.unitPrice?.toString() ?? null, after: unitPrice, source: unitPrice === null ? "catalog" : "manual" },
      },
      tx,
    );
  });
}

const manualItemSchema = z.object({
  description: z.string().trim().min(3, "Descreva o item").max(500),
  quantity: z.number().positive().max(9_999_999).nullable(),
  unit: z.string().trim().max(12).nullish(),
});

/** Acrescenta um item que a extração não captou. O matching roda normalmente para ele. */
export async function addManualItem(ctx: TenantContext, requestId: string, input: z.input<typeof manualItemSchema>): Promise<{ id: string }> {
  assertCan(ctx, "request:review");
  const request = parseId(requestId, "Solicitação");
  const data = manualItemSchema.parse(input);
  const unit = data.unit ? normalizeUnit(data.unit) : null;
  if (data.unit && !unit) throw new ValidationError(`Unidade de medida desconhecida: "${data.unit}".`);

  const normalizedDescription = normalizeText(data.description);
  const attributes = parseAttributes(data.description);
  const match = await matchItem(
    { originalDescription: data.description, normalizedDescription, unit, manufacturer: null, manufacturerCode: null, attributes },
    new PgCandidateRetriever(ctx.organizationId),
  );

  return tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const requestRow = await tx.quotationRequest.findUnique({ where: { id: request }, select: { id: true, status: true } });
    if (!requestRow) throw new NotFoundError("Solicitação");
    assertRequestEditable(requestRow.status);

    const last = await tx.requestedItem.findFirst({ where: { quotationRequestId: request }, orderBy: { lineNumber: "desc" }, select: { lineNumber: true } });
    const item = await tx.requestedItem.create({
      data: {
        organizationId: ctx.organizationId,
        quotationRequestId: request,
        lineNumber: (last?.lineNumber ?? 0) + 1,
        originalDescription: data.description,
        normalizedDescription,
        quantity: data.quantity,
        unit,
        attributes: attributes as object,
        isManual: true,
        matchOutcome: match.outcome,
        sourceReference: { origin: "manual" },
      },
    });
    const candidates = [...match.candidates, ...match.rejected];
    if (candidates.length > 0) {
      await tx.productMatch.createMany({
        data: candidates.map((candidate, index) => ({
          organizationId: ctx.organizationId,
          requestedItemId: item.id,
          productId: candidate.productId,
          rank: index + 1,
          score: candidate.score,
          compatible: candidate.compatible,
          strategies: candidate.strategies,
          signals: candidate.signals as object,
          reasons: candidate.reasons,
          incompatibilities: candidate.incompatibilities as unknown as object,
        })),
      });
    }
    await tx.quotationRequest.update({ where: { id: request }, data: { itemsCount: { increment: 1 } } });
    await touchReview(tx, ctx, request);
    await recordAudit(ctx, { action: "request.item_add", entityType: "RequestedItem", entityId: item.id, metadata: { requestId: request } }, tx);
    return { id: item.id };
  });
}

export async function removeItem(ctx: TenantContext, itemId: string): Promise<void> {
  assertCan(ctx, "request:review");
  const id = parseId(itemId, "Item");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const item = await loadEditableItem(tx, id);
    await tx.requestedItem.delete({ where: { id } });
    await tx.quotationRequest.update({ where: { id: item.request.id }, data: { itemsCount: { decrement: 1 } } });
    await touchReview(tx, ctx, item.request.id);
    await recordAudit(
      ctx,
      { action: "request.item_remove", entityType: "RequestedItem", entityId: id, metadata: { requestId: item.request.id, description: item.originalDescription.slice(0, 120) } },
      tx,
    );
  });
}

/**
 * Confirma, por ação explícita do revisor, todos os itens pendentes com sugestão forte.
 * Itens ambíguos ou sem correspondência nunca entram neste lote.
 */
export async function acceptSuggestedItems(ctx: TenantContext, requestId: string): Promise<{ confirmed: number }> {
  assertCan(ctx, "request:review");
  const request = parseId(requestId, "Solicitação");

  return tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const requestRow = await tx.quotationRequest.findUnique({ where: { id: request }, select: { id: true, status: true, customerId: true } });
    if (!requestRow) throw new NotFoundError("Solicitação");
    assertRequestEditable(requestRow.status);

    const items = await tx.requestedItem.findMany({
      where: { quotationRequestId: request, status: "PENDING", matchOutcome: "SUGGESTED" },
      include: { matches: { where: { compatible: true }, orderBy: { rank: "asc" }, take: 1 } },
    });
    const selections = items.flatMap((item) => (item.matches[0] ? [{ item, productId: item.matches[0].productId }] : []));
    const prices = await resolvePrices(tx, selections.map((selection) => selection.productId), { customerId: requestRow.customerId });

    for (const { item, productId } of selections) {
      const price = prices.get(productId);
      await tx.requestedItem.update({
        where: { id: item.id },
        data: {
          status: "CONFIRMED",
          selectedProductId: productId,
          unitPrice: price?.unitPrice ?? null,
          priceSource: price?.source ?? null,
          reviewedById: ctx.userId,
          reviewedAt: new Date(),
        },
      });
    }
    if (selections.length > 0) {
      await touchReview(tx, ctx, request);
      await recordAudit(
        ctx,
        { action: "request.accept_suggested", entityType: "QuotationRequest", entityId: request, metadata: { confirmed: selections.length } },
        tx,
      );
    }
    return { confirmed: selections.length };
  });
}

/** Define (ou remove) o cliente da solicitação e reaplica os preços de catálogo/lista dos itens confirmados. */
export async function setRequestCustomer(ctx: TenantContext, requestId: string, customerId: string | null): Promise<void> {
  assertCan(ctx, "request:review");
  const request = parseId(requestId, "Solicitação");
  const customer = customerId ? parseId(customerId, "Cliente") : null;

  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const requestRow = await tx.quotationRequest.findUnique({ where: { id: request }, select: { id: true, status: true } });
    if (!requestRow) throw new NotFoundError("Solicitação");
    assertRequestEditable(requestRow.status);
    if (customer) {
      const exists = await tx.customer.findUnique({ where: { id: customer }, select: { id: true } });
      if (!exists) throw new NotFoundError("Cliente");
    }
    await tx.quotationRequest.update({ where: { id: request }, data: { customerId: customer } });

    // Preços não manuais acompanham a lista de preços do novo cliente.
    const items = await tx.requestedItem.findMany({
      where: { quotationRequestId: request, status: "CONFIRMED", selectedProductId: { not: null }, NOT: { priceSource: "MANUAL" } },
      select: { id: true, selectedProductId: true },
    });
    const prices = await resolvePrices(tx, items.flatMap((item) => (item.selectedProductId ? [item.selectedProductId] : [])), { customerId: customer });
    for (const item of items) {
      const price = item.selectedProductId ? prices.get(item.selectedProductId) : undefined;
      await tx.requestedItem.update({ where: { id: item.id }, data: { unitPrice: price?.unitPrice ?? null, priceSource: price?.source ?? null } });
    }
    await recordAudit(ctx, { action: "request.customer_set", entityType: "QuotationRequest", entityId: request, metadata: { customerId: customer } }, tx);
  });
}

export async function discardRequest(ctx: TenantContext, requestId: string): Promise<void> {
  assertCan(ctx, "request:review");
  const request = parseId(requestId, "Solicitação");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const requestRow = await tx.quotationRequest.findUnique({ where: { id: request }, select: { status: true } });
    if (!requestRow) throw new NotFoundError("Solicitação");
    if (requestRow.status === "QUOTED") throw new ConflictError("Solicitações com cotação não podem ser descartadas.");
    if (requestRow.status === "PROCESSING" || requestRow.status === "RECEIVED") throw new ConflictError("Aguarde o fim do processamento.");
    await tx.quotationRequest.update({ where: { id: request }, data: { status: "DISCARDED" } });
    await recordAudit(ctx, { action: "request.discard", entityType: "QuotationRequest", entityId: request }, tx);
  });
}

export async function restoreRequest(ctx: TenantContext, requestId: string): Promise<void> {
  assertCan(ctx, "request:review");
  const request = parseId(requestId, "Solicitação");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const result = await tx.quotationRequest.updateMany({ where: { id: request, status: "DISCARDED" }, data: { status: "AWAITING_REVIEW" } });
    if (result.count === 0) throw new NotFoundError("Solicitação");
    await recordAudit(ctx, { action: "request.restore", entityType: "QuotationRequest", entityId: request }, tx);
  });
}
