"use server";

import { z } from "zod";
import { searchProducts } from "@/modules/catalog/products";
import { assertCan } from "@/modules/identity/permissions";
import { resolvePrices } from "@/modules/pricing/resolve";
import {
  cancelQuotation,
  finalizeQuotation,
  reopenQuotation,
  repriceQuotation,
  updateQuotation,
  type QuotationUpdateInput,
} from "@/modules/quotations/service";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { NotFoundError } from "@/platform/errors";
import { idSchema } from "@/platform/ids";
import { runAction, type ActionResult } from "@/server/actions";
import type { ProductOption } from "@/components/client/product-search";

/**
 * Server Actions do editor de cotação. `updateQuotation` valida o conteúdo com Zod
 * (quotationUpdateSchema) e recalcula os totais no servidor — os valores exibidos
 * no navegador durante a edição são apenas uma prévia.
 */

export async function saveQuotationAction(quotationId: string, input: QuotationUpdateInput): Promise<ActionResult> {
  return runAction("quotation.save", async (ctx) => {
    await updateQuotation(ctx, idSchema.parse(quotationId), input);
    return undefined;
  });
}

export async function finalizeQuotationAction(quotationId: string): Promise<ActionResult> {
  return runAction("quotation.finalize", async (ctx) => {
    await finalizeQuotation(ctx, idSchema.parse(quotationId));
    return undefined;
  });
}

export async function reopenQuotationAction(quotationId: string): Promise<ActionResult> {
  return runAction("quotation.reopen", async (ctx) => {
    await reopenQuotation(ctx, idSchema.parse(quotationId));
    return undefined;
  });
}

export async function cancelQuotationAction(quotationId: string): Promise<ActionResult> {
  return runAction("quotation.cancel", async (ctx) => {
    await cancelQuotation(ctx, idSchema.parse(quotationId));
    return undefined;
  });
}

export async function repriceQuotationAction(quotationId: string): Promise<ActionResult> {
  return runAction("quotation.reprice", async (ctx) => {
    await repriceQuotation(ctx, idSchema.parse(quotationId));
    return undefined;
  });
}

/** Busca de produtos para acrescentar à cotação, com o preço válido para o cliente dela. */
export async function searchProductsForQuotationAction(quotationId: string, query: string): Promise<ActionResult<ProductOption[]>> {
  return runAction(
    "quotation.searchProducts",
    async (ctx) => {
      assertCan(ctx, "quotation:write");
      const text = z.string().trim().max(120).parse(query);
      if (text.length < 2) return [];
      const db = tenantDb(ctx.organizationId);
      const quotation = await db.quotation.findUnique({ where: { id: idSchema.parse(quotationId) }, select: { customerId: true } });
      if (!quotation) throw new NotFoundError("Cotação");

      const products = await searchProducts(ctx, text, 12);
      const prices = await resolvePrices(
        db,
        products.map((product) => product.id),
        { customerId: quotation.customerId },
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
