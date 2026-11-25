import { mergeAttributes, parseAttributes } from "@/modules/normalization/attribute-parser";
import { sanitizeAttributes, type TechnicalAttributes } from "@/modules/normalization/attributes";
import { normalizeCode, normalizeText } from "@/modules/normalization/text";

export interface ProductSearchSource {
  sku: string;
  description: string;
  manufacturer?: string | null;
  manufacturerCode?: string | null;
  category?: string | null;
  /** Sinônimos e códigos alternativos já cadastrados. */
  aliases?: string[];
}

export interface ProductSearchFields {
  skuNormalized: string;
  descriptionNormalized: string;
  manufacturerCodeNormalized: string | null;
  searchText: string;
}

/**
 * Campos derivados usados pela busca:
 * - `skuNormalized` / `manufacturerCodeNormalized`: correspondência exata de códigos;
 * - `descriptionNormalized`: similaridade por trigramas;
 * - `searchText`: busca textual (FTS) sobre descrição, fabricante, códigos e sinônimos.
 */
export function buildProductSearchFields(source: ProductSearchSource): ProductSearchFields {
  const descriptionNormalized = normalizeText(source.description);
  const manufacturerCodeNormalized = normalizeCode(source.manufacturerCode) || null;
  const parts = [
    descriptionNormalized,
    normalizeText(source.manufacturer),
    normalizeText(source.category),
    source.sku.toLowerCase(),
    source.manufacturerCode?.toLowerCase() ?? "",
    ...(source.aliases ?? []).map((alias) => normalizeText(alias)),
  ];
  return {
    skuNormalized: normalizeCode(source.sku),
    descriptionNormalized,
    manufacturerCodeNormalized,
    searchText: [...new Set(parts.filter(Boolean))].join(" ").slice(0, 4000),
  };
}

/**
 * Atributos técnicos do produto: derivados da descrição, com os valores informados
 * explicitamente (formulário ou colunas da planilha) prevalecendo.
 */
export function buildProductAttributes(description: string, explicit?: unknown, extraText?: string): TechnicalAttributes {
  const derived = parseAttributes([description, extraText].filter(Boolean).join(" "));
  return mergeAttributes(derived, sanitizeAttributes(explicit));
}
