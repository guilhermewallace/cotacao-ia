"use server";

import { z } from "zod";
import { analyzeImport, applyImport, type ImportAnalysis, type ImportResult } from "@/modules/catalog/import";
import { createPriceList, setDefaultPriceList, setPriceListActive, setPriceListItem } from "@/modules/catalog/price-lists";
import { addProductAlias, createProduct, removeProductAlias, setProductActive, updateProduct, type ProductInput } from "@/modules/catalog/products";
import { idSchema } from "@/platform/ids";
import { runAction, type ActionResult } from "@/server/actions";

/**
 * Server Actions do catálogo. Os serviços validam o conteúdo (Zod), a permissão do papel
 * (catalog:write / catalog:import) e a posse de cada registro pela empresa da sessão.
 */

export async function createProductAction(input: ProductInput): Promise<ActionResult<{ id: string }>> {
  return runAction("catalog.createProduct", async (ctx) => {
    const product = await createProduct(ctx, input);
    return { id: product.id };
  });
}

export async function updateProductAction(productId: string, input: ProductInput): Promise<ActionResult> {
  return runAction("catalog.updateProduct", async (ctx) => {
    await updateProduct(ctx, idSchema.parse(productId), input);
    return undefined;
  });
}

export async function setProductActiveAction(productId: string, isActive: boolean): Promise<ActionResult> {
  return runAction("catalog.setProductActive", async (ctx) => {
    await setProductActive(ctx, idSchema.parse(productId), z.boolean().parse(isActive));
    return undefined;
  });
}

export async function addProductAliasAction(productId: string, input: { type: "SYNONYM" | "MANUFACTURER_CODE"; value: string; manufacturer?: string | null }): Promise<ActionResult> {
  return runAction("catalog.addAlias", async (ctx) => {
    await addProductAlias(ctx, idSchema.parse(productId), input);
    return undefined;
  });
}

export async function removeProductAliasAction(productId: string, aliasId: string): Promise<ActionResult> {
  return runAction("catalog.removeAlias", async (ctx) => {
    await removeProductAlias(ctx, idSchema.parse(productId), idSchema.parse(aliasId));
    return undefined;
  });
}

export async function createPriceListAction(input: { name: string; isDefault?: boolean }): Promise<ActionResult<{ id: string }>> {
  return runAction("catalog.createPriceList", (ctx) => createPriceList(ctx, { name: input.name, isDefault: input.isDefault === true }));
}

export async function setDefaultPriceListAction(priceListId: string): Promise<ActionResult> {
  return runAction("catalog.setDefaultPriceList", async (ctx) => {
    await setDefaultPriceList(ctx, idSchema.parse(priceListId));
    return undefined;
  });
}

export async function setPriceListActiveAction(priceListId: string, isActive: boolean): Promise<ActionResult> {
  return runAction("catalog.setPriceListActive", async (ctx) => {
    await setPriceListActive(ctx, idSchema.parse(priceListId), z.boolean().parse(isActive));
    return undefined;
  });
}

export async function setPriceListItemAction(priceListId: string, productId: string, unitPrice: number | null): Promise<ActionResult> {
  return runAction("catalog.setPriceListItem", async (ctx) => {
    const price = z.number().min(0, "O preço não pode ser negativo").max(99_999_999).nullable().parse(unitPrice);
    await setPriceListItem(ctx, idSchema.parse(priceListId), idSchema.parse(productId), price);
    return undefined;
  });
}

export async function analyzeImportAction(importId: string, mapping: unknown): Promise<ActionResult<ImportAnalysis>> {
  return runAction("catalog.analyzeImport", (ctx) => analyzeImport(ctx, idSchema.parse(importId), mapping), { refresh: false });
}

export async function applyImportAction(importId: string, mapping: unknown, options: unknown): Promise<ActionResult<ImportResult>> {
  return runAction("catalog.applyImport", (ctx) => applyImport(ctx, idSchema.parse(importId), mapping, options));
}
