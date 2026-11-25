import { Prisma } from "@/generated/prisma/client";
import { disabledSemanticRetriever, type SemanticRetriever } from "@/modules/matching/semantic";
import type { CandidateProduct, CandidateRetriever, MatchQuery, RetrievalSignals } from "@/modules/matching/types";
import { sanitizeAttributes } from "@/modules/normalization/attributes";
import { extractCodeCandidates, normalizeCode, significantTokens } from "@/modules/normalization/text";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { getPrisma } from "@/platform/db";
import { parseId } from "@/platform/ids";

/**
 * Recuperação de candidatos no PostgreSQL. Cada estratégia é uma consulta simples,
 * apoiada em índice e sempre filtrada por `organization_id`:
 *
 *   1. SKU exato                      (índice único organization_id + sku_normalized)
 *   2. Código de fabricante exato     (produto e códigos alternativos)
 *   3. Busca textual em português     (GIN sobre to_tsvector(search_text))
 *   4. Similaridade por trigramas     (GIN pg_trgm sobre description_normalized)
 *   5. Sinônimos por trigramas        (GIN pg_trgm sobre product_aliases.value_normalized)
 *   6. Busca semântica                (ponto de extensão; desligada nesta versão)
 *
 * A recuperação só reúne candidatos; quem decide é a pontuação (scoring.ts).
 */

const PER_STRATEGY_LIMIT = 20;
const MAX_QUERY_TOKENS = 14;

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

/** Códigos candidatos do item: o código informado e tokens com cara de código na descrição. */
export function queryCodes(query: MatchQuery): string[] {
  const codes = new Set<string>(extractCodeCandidates(query.originalDescription));
  const explicit = normalizeCode(query.manufacturerCode);
  if (explicit.length >= 3) codes.add(explicit);
  return [...codes].slice(0, 12);
}

/** Consulta textual com semântica OU: descrições de clientes trazem palavras a mais. */
export function buildOrTsQuery(normalizedDescription: string): string | null {
  const tokens = significantTokens(normalizedDescription)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 2)
    .slice(0, MAX_QUERY_TOKENS);
  return tokens.length > 0 ? tokens.join(" | ") : null;
}

export class PgCandidateRetriever implements CandidateRetriever {
  private readonly organizationId: string;

  constructor(
    organizationId: string,
    private readonly semantic: SemanticRetriever = disabledSemanticRetriever,
  ) {
    this.organizationId = parseId(organizationId, "Organização");
  }

  async retrieve(query: MatchQuery): Promise<CandidateProduct[]> {
    const prisma = getPrisma();
    const org = this.organizationId;
    const codes = queryCodes(query);
    const text = query.normalizedDescription.slice(0, 400);
    const tsQuery = buildOrTsQuery(text);

    const [codeHits, aliasCodeHits, fullTextHits, trigramHits, synonymHits, semanticHits] = await Promise.all([
      codes.length > 0
        ? prisma.$queryRaw<Array<{ id: string; sku_normalized: string; manufacturer_code_normalized: string | null }>>(Prisma.sql`
            SELECT p.id, p.sku_normalized, p.manufacturer_code_normalized
            FROM products p
            WHERE p.organization_id = ${org}::uuid AND p.is_active
              AND (p.sku_normalized = ANY(${codes}::text[]) OR p.manufacturer_code_normalized = ANY(${codes}::text[]))
            LIMIT ${PER_STRATEGY_LIMIT}`)
        : [],
      codes.length > 0
        ? prisma.$queryRaw<Array<{ id: string; value: string }>>(Prisma.sql`
            SELECT a.product_id AS id, a.value
            FROM product_aliases a
            JOIN products p ON p.organization_id = a.organization_id AND p.id = a.product_id
            WHERE a.organization_id = ${org}::uuid AND a.type = 'MANUFACTURER_CODE' AND p.is_active
              AND a.value_normalized = ANY(${codes}::text[])
            LIMIT ${PER_STRATEGY_LIMIT}`)
        : [],
      tsQuery
        ? prisma.$queryRaw<Array<{ id: string; rank: number }>>(Prisma.sql`
            SELECT p.id, ts_rank_cd(to_tsvector('portuguese', p.search_text), q.query)::float8 AS rank
            FROM products p, to_tsquery('portuguese', ${tsQuery}) AS q(query)
            WHERE p.organization_id = ${org}::uuid AND p.is_active
              AND to_tsvector('portuguese', p.search_text) @@ q.query
            ORDER BY rank DESC
            LIMIT ${PER_STRATEGY_LIMIT}`)
        : [],
      text.length >= 3
        ? prisma.$queryRaw<Array<{ id: string; similarity: number }>>(Prisma.sql`
            SELECT p.id, similarity(p.description_normalized, ${text})::float8 AS similarity
            FROM products p
            WHERE p.organization_id = ${org}::uuid AND p.is_active
              AND p.description_normalized % ${text}
            ORDER BY similarity DESC
            LIMIT ${PER_STRATEGY_LIMIT}`)
        : [],
      text.length >= 3
        ? prisma.$queryRaw<Array<{ id: string; similarity: number; value: string }>>(Prisma.sql`
            SELECT DISTINCT ON (a.product_id) a.product_id AS id, similarity(a.value_normalized, ${text})::float8 AS similarity, a.value
            FROM product_aliases a
            JOIN products p ON p.organization_id = a.organization_id AND p.id = a.product_id
            WHERE a.organization_id = ${org}::uuid AND a.type = 'SYNONYM' AND p.is_active
              AND a.value_normalized % ${text}
            ORDER BY a.product_id, similarity DESC
            LIMIT ${PER_STRATEGY_LIMIT * 3}`)
        : [],
      this.semantic.enabled ? this.semantic.search(org, text, PER_STRATEGY_LIMIT) : [],
    ]);

    const signals = new Map<string, RetrievalSignals>();
    const signalFor = (id: string): RetrievalSignals => {
      let entry = signals.get(id);
      if (!entry) {
        entry = emptySignals();
        signals.set(id, entry);
      }
      return entry;
    };

    for (const hit of codeHits) {
      const entry = signalFor(hit.id);
      if (codes.includes(hit.sku_normalized)) {
        entry.skuExact = true;
        entry.matchedCode = hit.sku_normalized;
      }
      if (hit.manufacturer_code_normalized && codes.includes(hit.manufacturer_code_normalized)) {
        entry.manufacturerCodeExact = true;
        entry.matchedCode ??= hit.manufacturer_code_normalized;
      }
    }
    for (const hit of aliasCodeHits) {
      const entry = signalFor(hit.id);
      entry.aliasCodeExact = true;
      entry.matchedCode ??= hit.value;
    }
    for (const hit of fullTextHits) signalFor(hit.id).fullTextRank = hit.rank;
    for (const hit of trigramHits) signalFor(hit.id).trigram = hit.similarity;
    for (const hit of synonymHits) {
      const entry = signalFor(hit.id);
      if (hit.similarity > entry.synonymTrigram) {
        entry.synonymTrigram = hit.similarity;
        entry.matchedSynonym = hit.value;
      }
    }
    for (const hit of semanticHits) signalFor(hit.productId).semantic = hit.similarity;

    if (signals.size === 0) return [];

    // A carga dos produtos passa pelo cliente com escopo de organização (defesa em profundidade).
    const products = await tenantDb(org).product.findMany({
      where: { id: { in: [...signals.keys()] }, isActive: true },
      select: {
        id: true,
        sku: true,
        description: true,
        descriptionNormalized: true,
        searchText: true,
        manufacturer: true,
        manufacturerCode: true,
        unit: true,
        attributes: true,
      },
    });

    return products.map((product) => ({
      ...product,
      attributes: sanitizeAttributes(product.attributes),
      signals: signals.get(product.id) ?? emptySignals(),
    }));
  }
}
