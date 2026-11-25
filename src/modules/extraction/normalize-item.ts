import type { AiExtractedItem } from "@/modules/ai/schema";
import { parseAttributes } from "@/modules/normalization/attribute-parser";
import { sanitizeAttributes, type AttributeKey, type TechnicalAttributes } from "@/modules/normalization/attributes";
import { normalizeCode, normalizeText, stripAccents, truncate } from "@/modules/normalization/text";
import { normalizeUnit, parseQuantity } from "@/modules/normalization/units";

/**
 * Normalização determinística dos itens extraídos, com verificação de aderência
 * ("grounding"): quando o texto do documento é conhecido, nenhum número proposto
 * pela IA é aceito se não estiver presente nesse texto.
 */

export interface SourceReference {
  origin: "message" | "attachment";
  fileName?: string;
  page?: number;
  sheet?: string;
  row?: number;
  excerpt?: string;
}

export interface NormalizedItem {
  originalDescription: string;
  normalizedDescription: string;
  quantity: number | null;
  unit: string | null;
  manufacturer: string | null;
  manufacturerCode: string | null;
  attributes: TechnicalAttributes;
  sourceAttachmentId: string | null;
  sourceReference: SourceReference;
  confidence: number | null;
  notes: string | null;
}

/** Números presentes em um texto, com vírgula decimal convertida ("2,5" → "2.5"). */
export function numericTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  // "1.500" também pode ser mil e quinhentos (separador de milhar brasileiro).
  for (const match of text.matchAll(/\b\d{1,3}(?:\.\d{3})+\b/g)) {
    tokens.add(String(Number(match[0].replace(/\./g, ""))));
  }
  for (const match of text.replace(/(\d),(\d)/g, "$1.$2").matchAll(/\d+(?:\.\d+)?/g)) {
    tokens.add(String(Number(match[0])));
  }
  return tokens;
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, par: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, meia: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, duzia: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cem: 100, cento: 100,
  duzentos: 200, duzentas: 200, quinhentos: 500, quinhentas: 500, mil: 1000,
};

/** A quantidade aparece no documento, em algarismos ou por extenso? */
export function isQuantityGroundedIn(quantity: number, source: string): boolean {
  if (numericTokens(source).has(String(quantity))) return true;
  const words = new Set(stripAccents(source).toLowerCase().split(/[^a-z]+/));
  return Object.entries(NUMBER_WORDS).some(([word, value]) => value === quantity && words.has(word));
}

/** Verdadeiro se todo número de `candidate` aparece em `source`. */
export function isGroundedIn(candidate: string, source: string): boolean {
  const sourceTokens = numericTokens(source);
  for (const token of numericTokens(candidate)) {
    if (!sourceTokens.has(token)) return false;
  }
  return true;
}

const BARE_NUMBER_ATTRIBUTES: Array<[RegExp, AttributeKey]> = [
  [/polo/, "polos"],
  [/bitola|secao/, "secao_mm2"],
  [/tensao|voltagem/, "tensao_v"],
  [/corrente residual|sensibilidade/, "corrente_residual_ma"],
  [/corrente|amperagem/, "corrente_a"],
  [/potencia/, "potencia_w"],
  [/condutor|vias/, "condutores"],
];

/** Converte um par nome/valor informado pela IA em atributos canônicos. */
export function attributesFromPair(name: string, value: string): TechnicalAttributes {
  const parsed = parseAttributes(`${name} ${value}`);
  if (Object.keys(parsed).length > 0) return parsed;

  const numeric = parseQuantity(value.trim());
  if (numeric === null) return {};
  const plainName = stripAccents(name).toLowerCase();
  const mapping = BARE_NUMBER_ATTRIBUTES.find(([pattern]) => pattern.test(plainName));
  return mapping ? sanitizeAttributes({ [mapping[1]]: numeric }) : {};
}

function cleanText(value: string | null | undefined, maxLength: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? truncate(text, maxLength) : null;
}

export interface NormalizeOptions {
  /** Texto integral do documento de origem, quando conhecido (habilita a verificação de aderência). */
  sourceText?: string;
  sourceAttachmentId: string | null;
  reference: SourceReference;
}

export function normalizeExtractedItem(raw: AiExtractedItem, options: NormalizeOptions): NormalizedItem | null {
  const original = cleanText(raw.originalDescription, 500);
  if (!original) return null;

  const notes: string[] = [];
  if (raw.notes) notes.push(raw.notes.trim());
  const grounding = options.sourceText;
  const grounded = (candidate: string) => grounding === undefined || isGroundedIn(candidate, `${grounding} ${original}`);

  // Descrição normalizada pela IA: aceita apenas se não introduzir números ausentes no documento.
  let aiNormalized = cleanText(raw.normalizedDescription, 500);
  if (aiNormalized && !grounded(aiNormalized)) {
    aiNormalized = null;
    notes.push("Descrição normalizada pela IA descartada por conter valores ausentes no documento.");
  }

  // Atributos: os derivados do texto literal prevalecem; os informados pela IA preenchem lacunas.
  let fromAi: TechnicalAttributes = {};
  for (const pair of raw.attributes) {
    if (!grounded(pair.value)) continue;
    fromAi = { ...fromAi, ...attributesFromPair(pair.name, pair.value) };
  }
  const derived = parseAttributes([original, aiNormalized].filter(Boolean).join(" "));
  const attributes = sanitizeAttributes({ ...fromAi, ...derived });

  // Quantidade: só é aceita se constar no documento. Um número "deduzido" pelo modelo é descartado
  // (fica nulo para o revisor preencher) — nunca inventamos informação ausente.
  let quantity = typeof raw.quantity === "number" && Number.isFinite(raw.quantity) && raw.quantity > 0 ? Math.round(raw.quantity * 1000) / 1000 : null;
  if (quantity !== null && grounding !== undefined && !isQuantityGroundedIn(quantity, `${grounding} ${original}`)) {
    quantity = null;
    notes.push("Quantidade indicada pela IA descartada por não constar no documento.");
  }

  const rawUnit = cleanText(raw.unit, 20);
  const unit = normalizeUnit(rawUnit);
  if (rawUnit && !unit) notes.push(`Unidade não reconhecida: "${rawUnit}".`);

  let manufacturerCode = cleanText(raw.manufacturerCode, 80);
  if (manufacturerCode && grounding !== undefined) {
    const haystack = normalizeCode(`${grounding} ${original}`);
    if (!haystack.includes(normalizeCode(manufacturerCode))) manufacturerCode = null;
  }
  let manufacturer = cleanText(raw.manufacturer, 100);
  if (manufacturer && grounding !== undefined) {
    const haystack = normalizeText(`${grounding} ${original}`);
    if (!haystack.includes(normalizeText(manufacturer))) manufacturer = null;
  }

  const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? Math.min(Math.max(raw.confidence, 0), 1) : null;

  const reference: SourceReference = { ...options.reference };
  if (typeof raw.page === "number" && raw.page > 0 && reference.page === undefined) reference.page = raw.page;
  const excerpt = cleanText(raw.sourceExcerpt, 400);
  if (excerpt && reference.excerpt === undefined) reference.excerpt = excerpt;

  return {
    originalDescription: original,
    normalizedDescription: normalizeText(aiNormalized ?? original),
    quantity,
    unit,
    manufacturer,
    manufacturerCode,
    attributes,
    sourceAttachmentId: options.sourceAttachmentId,
    sourceReference: reference,
    confidence,
    notes: notes.length > 0 ? truncate(notes.join(" "), 500) : null,
  };
}
