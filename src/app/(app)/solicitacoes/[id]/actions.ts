"use server";

import { z } from "zod";
import { searchProducts } from "@/modules/catalog/products";
import { reprocessRequest } from "@/modules/processing/recovery";
import { deleteRequestDocuments } from "@/modules/processing/retention";
import { createQuotationFromRequest } from "@/modules/quotations/service";
import {
  acceptSuggestedItems,
  addManualItem,
  confirmItem,
  discardRequest,
  markItemNotFound,
  removeItem,
  reopenItem,
  restoreRequest,
  setItemPrice,
  setRequestCustomer as assignCustomer,
  updateItemQuantity,
} from "@/modules/requests/review";
import { resolvePrices } from "@/modules/pricing/resolve";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { assertCan } from "@/modules/identity/permissions";
import { NotFoundError } from "@/platform/errors";
import { idSchema } from "@/platform/ids";
import { runAction, type ActionResult } from "@/server/actions";

/**
 * Server Actions da tela de revisão.
 *
 * Toda entrada é validada aqui (os argumentos chegam do navegador e não são confiáveis).
 * Os serviços chamados conferem a permissão do papel e que cada registro pertence à
 * empresa da sessão — um ID de outra empresa resulta em "não encontrado".
 */

const quantity = z.number().positive("A quantidade deve ser maior que zero").max(9_999_999).nullable();
const unit = z.string().trim().max(12).nullable();
const price = z.number().min(0, "O preço não pode ser negativo").max(99_999_999).nullable();

export async function confirmItemAction(itemId: string, productId: string): Promise<ActionResult> {
  return runAction("request.confirmItem", async (ctx) => {
    await confirmItem(ctx, idSchema.parse(itemId), idSchema.parse(productId));
    return undefined;
  });
}

export async function markItemNotFoundAction(itemId: string): Promise<ActionResult> {
  return runAction("request.markNotFound", async (ctx) => {
    await markItemNotFound(ctx, idSchema.parse(itemId));
    return undefined;
  });
}

export async function reopenItemAction(itemId: string): Promise<ActionResult> {
  return runAction("request.reopenItem", async (ctx) => {
    await reopenItem(ctx, idSchema.parse(itemId));
    return undefined;
  });
}

export async function updateItemQuantityAction(itemId: string, quantityInput: number | null, unitInput: string | null): Promise<ActionResult> {
  return runAction("request.updateQuantity", async (ctx) => {
    await updateItemQuantity(ctx, idSchema.parse(itemId), { quantity: quantity.parse(quantityInput), unit: unit.parse(unitInput) });
    return undefined;
  });
}

export async function setItemPriceAction(itemId: string, unitPrice: number | null): Promise<ActionResult> {
  return runAction("request.setPrice", async (ctx) => {
    await setItemPrice(ctx, idSchema.parse(itemId), price.parse(unitPrice));
    return undefined;
  });
}

export async function addManualItemAction(requestId: string, input: { description: string; quantity: number | null; unit: string | null }): Promise<ActionResult<{ id: string }>> {
  return runAction("request.addItem", async (ctx) => {
    const data = z.object({ description: z.string().trim().min(3, "Descreva o item").max(500), quantity, unit }).parse(input);
    return addManualItem(ctx, idSchema.parse(requestId), data);
  });
}

export async function removeItemAction(itemId: string): Promise<ActionResult> {
  return runAction("request.removeItem", async (ctx) => {
    await removeItem(ctx, idSchema.parse(itemId));
    return undefined;
  });
}

export async function acceptSuggestedItemsAction(requestId: string): Promise<ActionResult<{ confirmed: number }>> {
  return runAction("request.acceptSuggested", (ctx) => acceptSuggestedItems(ctx, idSchema.parse(requestId)));
}

export async function setRequestCustomerAction(requestId: string, customerId: string | null): Promise<ActionResult> {
  return runAction("request.setCustomer", async (ctx) => {
    await assignCustomer(ctx, idSchema.parse(requestId), idSchema.nullable().parse(customerId));
    return undefined;
  });
}

export async function discardRequestAction(requestId: string): Promise<ActionResult> {
  return runAction("request.discard", async (ctx) => {
    await discardRequest(ctx, idSchema.parse(requestId));
    return undefined;
  });
}

export async function restoreRequestAction(requestId: string): Promise<ActionResult> {
  return runAction("request.restore", async (ctx) => {
    await restoreRequest(ctx, idSchema.parse(requestId));
    return undefined;
  });
}

export async function reprocessRequestAction(requestId: string): Promise<ActionResult> {
  return runAction("request.reprocess", async (ctx) => {
    await reprocessRequest(ctx, idSchema.parse(requestId));
    return undefined;
  });
}

export async function deleteRequestDocumentsAction(requestId: string): Promise<ActionResult<{ attachments: number }>> {
  return runAction("request.deleteDocuments", (ctx) => deleteRequestDocuments(ctx, idSchema.parse(requestId)));
}

export async function createQuotationAction(requestId: string): Promise<ActionResult<{ id: string; number: string }>> {
  return runAction("request.createQuotation", (ctx) => createQuotationFromRequest(ctx, idSchema.parse(requestId)), { refresh: false });
}

export interface ProductSearchResult {
  id: string;
  sku: string;
  description: string;
  manufacturer: string | null;
  unit: string;
  price: string | null;
  priceListName: string | null;
}

/** Busca manual no catálogo, com o preço que valeria para o cliente da solicitação. */
export async function searchCatalogAction(requestId: string, query: string): Promise<ActionResult<ProductSearchResult[]>> {
  return runAction(
    "request.searchCatalog",
    async (ctx) => {
      assertCan(ctx, "request:review");
      const text = z.string().trim().max(120).parse(query);
      if (text.length < 2) return [];

      const db = tenantDb(ctx.organizationId);
      // O cliente (e portanto a lista de preços) vem da solicitação gravada, não do navegador.
      const request = await db.quotationRequest.findUnique({ where: { id: idSchema.parse(requestId) }, select: { customerId: true } });
      if (!request) throw new NotFoundError("Solicitação");

      const products = await searchProducts(ctx, text, 12);
      const prices = await resolvePrices(
        db,
        products.map((product) => product.id),
        { customerId: request.customerId },
      );
      return products.map((product) => {
        const resolved = prices.get(product.id);
        return {
          id: product.id,
          sku: product.sku,
          description: product.description,
          manufacturer: product.manufacturer,
          unit: product.unit,
          price: resolved?.unitPrice?.toString() ?? null,
          priceListName: resolved?.priceListName ?? null,
        };
      });
    },
    { refresh: false },
  );
}
