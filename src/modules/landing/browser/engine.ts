/**
 * Motor das demonstrações da página pública — este arquivo roda no NAVEGADOR.
 *
 * Reúne os MESMOS módulos puros do produto (normalização de texto, leitura e comparação de
 * atributos técnicos, pontuação de candidatos) e troca apenas a recuperação em PostgreSQL por
 * uma busca em memória sobre o catálogo fictício da empresa de demonstração.
 * Nenhuma IA e nenhuma chamada de rede: tudo acontece na página.
 *
 * É empacotado por `npm run landing:build` em public/landing/engine.js (objeto global
 * `CotacaoEngine`, usado por public/landing/site.js). Por rodar no navegador, só pode importar
 * módulos sem dependência de pacotes nem de Node — o script de build recusa o contrário.
 */
import { buildDemoCatalog } from "@/demo/catalog";
import { extractWithRules } from "@/modules/ai/heuristic-extractor";
import { buildProductAttributes, buildProductSearchFields } from "@/modules/catalog/search-text";
import { normalizeExtractedItem } from "@/modules/extraction/normalize-item";
import { MATCHING_THRESHOLDS, rankCandidates, scoreCandidate } from "@/modules/matching/scoring";
import type { CandidateProduct, MatchQuery, MatchResult, RetrievalSignals, ScoredCandidate } from "@/modules/matching/types";
import { ATTRIBUTE_LIST, describeAttributes, type TechnicalAttributes } from "@/modules/normalization/attributes";
import { extractCodeCandidates, normalizeCode, normalizeText, significantTokens } from "@/modules/normalization/text";
import { UNIT_LABELS } from "@/modules/normalization/units";

interface IndexedProduct {
  id: string;
  sku: string;
  description: string;
  manufacturer: string;
  manufacturerCode: string;
  category: string;
  unit: string;
  price: number | null;
  descriptionNormalized: string;
  searchText: string;
  attributes: TechnicalAttributes;
  skuNormalized: string;
  codeNormalized: string;
  aliasCodes: Map<string, string>;
  trigrams: Set<string>;
  synonyms: Array<{ value: string; trigrams: Set<string> }>;
  tokens: Set<string>;
}

const PER_STRATEGY_LIMIT = 20;
const TRIGRAM_THRESHOLD = 0.3; // limiar padrão do operador % do pg_trgm

/** Trigramas no formato do pg_trgm: palavras alfanuméricas, com dois espaços antes e um depois. */
function trigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let index = 0; index + 3 <= padded.length; index += 1) set.add(padded.slice(index, index + 3));
  }
  return set;
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function searchTokens(text: string): string[] {
  return significantTokens(text)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 2);
}

const products: IndexedProduct[] = buildDemoCatalog().map((product, index) => {
  const fields = buildProductSearchFields({
    sku: product.sku,
    description: product.description,
    manufacturer: product.manufacturer,
    manufacturerCode: product.manufacturerCode,
    category: product.category,
    aliases: [...product.synonyms, ...product.alternativeCodes.map((code) => code.value)],
  });
  return {
    id: `p${index + 1}`,
    sku: product.sku,
    description: product.description,
    manufacturer: product.manufacturer,
    manufacturerCode: product.manufacturerCode,
    category: product.category,
    unit: product.unit,
    price: product.price,
    descriptionNormalized: fields.descriptionNormalized,
    searchText: fields.searchText,
    attributes: buildProductAttributes(product.description),
    skuNormalized: fields.skuNormalized,
    codeNormalized: fields.manufacturerCodeNormalized ?? "",
    aliasCodes: new Map(product.alternativeCodes.map((code) => [normalizeCode(code.value), code.value])),
    trigrams: trigrams(fields.descriptionNormalized),
    synonyms: product.synonyms.map((value) => ({ value, trigrams: trigrams(normalizeText(value)) })),
    tokens: new Set(searchTokens(fields.searchText)),
  };
});

const byId = new Map(products.map((product) => [product.id, product]));
const bySku = new Map(products.map((product) => [product.sku, product]));

function emptySignals(): RetrievalSignals {
  return {
    skuExact: false,
    manufacturerCodeExact: false,
    aliasCodeExact: false,
    matchedCode: null,
    fullTextRank: 0,
    trigram: 0,
    synonymTrigram: 0,
    matchedSynonym: null,
    semantic: 0,
  };
}

function queryCodes(query: MatchQuery): string[] {
  const codes = new Set<string>(extractCodeCandidates(query.originalDescription));
  const explicit = normalizeCode(query.manufacturerCode);
  if (explicit.length >= 3) codes.add(explicit);
  return [...codes].slice(0, 12);
}

/** Sinais de um produto para uma consulta — os mesmos que a recuperação em SQL produz. */
function signalsFor(product: IndexedProduct, codes: string[], queryTrigrams: Set<string>, queryTokens: string[]): RetrievalSignals {
  const signals = emptySignals();
  if (codes.includes(product.skuNormalized)) {
    signals.skuExact = true;
    signals.matchedCode = product.skuNormalized;
  }
  if (product.codeNormalized && codes.includes(product.codeNormalized)) {
    signals.manufacturerCodeExact = true;
    signals.matchedCode ??= product.codeNormalized;
  }
  for (const code of codes) {
    const alias = product.aliasCodes.get(code);
    if (alias) {
      signals.aliasCodeExact = true;
      signals.matchedCode ??= alias;
    }
  }
  const matchedTokens = queryTokens.filter((token) => product.tokens.has(token)).length;
  if (matchedTokens > 0) signals.fullTextRank = matchedTokens / queryTokens.length;

  const descriptionSimilarity = similarity(queryTrigrams, product.trigrams);
  if (descriptionSimilarity >= TRIGRAM_THRESHOLD) signals.trigram = descriptionSimilarity;

  for (const synonym of product.synonyms) {
    const value = similarity(queryTrigrams, synonym.trigrams);
    if (value >= TRIGRAM_THRESHOLD && value > signals.synonymTrigram) {
      signals.synonymTrigram = value;
      signals.matchedSynonym = synonym.value;
    }
  }
  return signals;
}

function toCandidate(product: IndexedProduct, signals: RetrievalSignals): CandidateProduct {
  return {
    id: product.id,
    sku: product.sku,
    description: product.description,
    descriptionNormalized: product.descriptionNormalized,
    searchText: product.searchText,
    manufacturer: product.manufacturer,
    manufacturerCode: product.manufacturerCode,
    unit: product.unit,
    attributes: product.attributes,
    signals,
  };
}

function prepare(query: MatchQuery) {
  const text = query.normalizedDescription.slice(0, 400);
  return { codes: queryCodes(query), queryTrigrams: trigrams(text), queryTokens: searchTokens(text).slice(0, 14) };
}

/** Recuperação em memória: código exato, termos em comum, trigramas e sinônimos — com os mesmos limites do SQL. */
function retrieve(query: MatchQuery): CandidateProduct[] {
  const { codes, queryTrigrams, queryTokens } = prepare(query);
  const all = products.map((product) => ({ product, signals: signalsFor(product, codes, queryTrigrams, queryTokens) }));

  const keep = new Set<string>();
  const top = (score: (entry: (typeof all)[number]) => number, limit: number) => {
    all
      .filter((entry) => score(entry) > 0)
      .sort((a, b) => score(b) - score(a))
      .slice(0, limit)
      .forEach((entry) => keep.add(entry.product.id));
  };
  for (const entry of all) {
    if (entry.signals.skuExact || entry.signals.manufacturerCodeExact || entry.signals.aliasCodeExact) keep.add(entry.product.id);
  }
  top((entry) => entry.signals.fullTextRank, PER_STRATEGY_LIMIT);
  top((entry) => entry.signals.trigram, PER_STRATEGY_LIMIT);
  top((entry) => entry.signals.synonymTrigram, PER_STRATEGY_LIMIT * 3);

  return all
    .filter((entry) => keep.has(entry.product.id))
    .map((entry) => toCandidate(entry.product, entry.signals));
}

export interface DemoItem {
  originalDescription: string;
  normalizedDescription: string;
  quantity: number | null;
  unit: string | null;
  manufacturerCode: string | null;
  attributes: TechnicalAttributes;
  notes: string | null;
  excerpt: string;
}

function toQuery(item: DemoItem): MatchQuery {
  return {
    originalDescription: item.originalDescription,
    normalizedDescription: item.normalizedDescription,
    unit: item.unit,
    manufacturer: null,
    manufacturerCode: item.manufacturerCode,
    attributes: item.attributes,
  };
}

/** Lê um texto livre (uma ou várias linhas) com o extrator por regras do produto. */
export function readText(text: string): DemoItem[] {
  const extraction = extractWithRules(text);
  const items: DemoItem[] = [];
  for (const raw of extraction.items) {
    const normalized = normalizeExtractedItem(raw, { sourceText: text, sourceAttachmentId: null, reference: { origin: "message" } });
    if (!normalized) continue;
    items.push({
      originalDescription: normalized.originalDescription,
      normalizedDescription: normalized.normalizedDescription,
      quantity: normalized.quantity,
      unit: normalized.unit,
      manufacturerCode: normalized.manufacturerCode,
      attributes: normalized.attributes,
      notes: normalized.notes,
      excerpt: raw.sourceExcerpt ?? normalized.originalDescription,
    });
  }
  return items;
}

/** Item já estruturado (linha de planilha ou de tabela em PDF): descrição + quantidade + unidade. */
export function readRow(description: string, quantity: number | null, unit: string | null, code: string | null = null): DemoItem | null {
  const normalized = normalizeExtractedItem(
    {
      originalDescription: description,
      normalizedDescription: null,
      quantity,
      unit,
      manufacturer: null,
      manufacturerCode: code,
      attributes: [],
      page: null,
      sourceExcerpt: description,
      confidence: null,
      notes: null,
    },
    { sourceAttachmentId: null, reference: { origin: "attachment" } },
  );
  if (!normalized) return null;
  return {
    originalDescription: normalized.originalDescription,
    normalizedDescription: normalized.normalizedDescription,
    quantity: normalized.quantity,
    unit: normalized.unit,
    manufacturerCode: normalized.manufacturerCode,
    attributes: normalized.attributes,
    notes: normalized.notes,
    excerpt: description,
  };
}

export interface DemoCandidate extends ScoredCandidate {
  price: number | null;
  manufacturerCode: string;
  category: string;
}

export interface DemoMatch {
  outcome: MatchResult["outcome"];
  candidates: DemoCandidate[];
  rejected: DemoCandidate[];
}

function decorate(candidate: ScoredCandidate): DemoCandidate {
  const product = byId.get(candidate.productId);
  return { ...candidate, price: product?.price ?? null, manufacturerCode: product?.manufacturerCode ?? "", category: product?.category ?? "" };
}

export function match(item: DemoItem): DemoMatch {
  const query = toQuery(item);
  const result = rankCandidates(query, retrieve(query));
  return { outcome: result.outcome, candidates: result.candidates.map(decorate), rejected: result.rejected.map(decorate) };
}

/** Avalia um produto específico contra um item — usado pelo trilho de disjuntores. */
export function scoreAgainst(item: DemoItem, sku: string): DemoCandidate | null {
  const product = bySku.get(sku);
  if (!product) return null;
  const query = toQuery(item);
  const { codes, queryTrigrams, queryTokens } = prepare(query);
  return decorate(scoreCandidate(query, toCandidate(product, signalsFor(product, codes, queryTrigrams, queryTokens))));
}

export function describe(attributes: TechnicalAttributes): Array<{ key: string; label: string; value: string; critical: boolean }> {
  const critical = new Map(ATTRIBUTE_LIST.map((definition) => [definition.key, definition.critical]));
  return describeAttributes(attributes).map((entry) => ({ ...entry, critical: critical.get(entry.key) ?? false }));
}

export function product(sku: string) {
  const found = bySku.get(sku);
  if (!found) return null;
  return {
    sku: found.sku,
    description: found.description,
    manufacturer: found.manufacturer,
    manufacturerCode: found.manufacturerCode,
    category: found.category,
    unit: found.unit,
    price: found.price,
    attributes: describe(found.attributes),
  };
}

export const info = {
  products: products.length,
  categories: [...new Set(products.map((entry) => entry.category))],
  attributes: ATTRIBUTE_LIST.length,
  criticalAttributes: ATTRIBUTE_LIST.filter((definition) => definition.critical).length,
  thresholds: MATCHING_THRESHOLDS,
  unitLabels: UNIT_LABELS,
};

export { normalizeText };
