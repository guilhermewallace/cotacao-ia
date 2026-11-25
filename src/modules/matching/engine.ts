import { PgCandidateRetriever } from "@/modules/matching/retrieval";
import { rankCandidates } from "@/modules/matching/scoring";
import type { CandidateRetriever, MatchQuery, MatchResult } from "@/modules/matching/types";
import { sanitizeAttributes } from "@/modules/normalization/attributes";
import type { TenantDbOrTx } from "@/modules/tenancy/tenant-db";

/**
 * Matching Engine: relaciona um item solicitado aos produtos do catálogo.
 *
 *   recuperação híbrida (SQL)  →  validação de atributos  →  ranking  →  classificação
 *
 * O LLM não participa desta etapa. Toda sugestão passa por revisão humana.
 */
export async function matchItem(query: MatchQuery, retriever: CandidateRetriever): Promise<MatchResult> {
  const candidates = await retriever.retrieve(query);
  return rankCandidates(query, candidates);
}

export interface PersistedMatchSummary {
  itemsCount: number;
  suggested: number;
  ambiguous: number;
  noMatch: number;
}

/**
 * Executa o matching de todos os itens pendentes de uma solicitação e grava os
 * candidatos (ProductMatch). Itens já revisados por uma pessoa não são tocados.
 */
export async function matchRequestItems(
  db: TenantDbOrTx,
  organizationId: string,
  quotationRequestId: string,
  retriever: CandidateRetriever = new PgCandidateRetriever(organizationId),
): Promise<PersistedMatchSummary> {
  const items = await db.requestedItem.findMany({
    where: { quotationRequestId, status: "PENDING" },
    orderBy: { lineNumber: "asc" },
  });

  const summary: PersistedMatchSummary = { itemsCount: items.length, suggested: 0, ambiguous: 0, noMatch: 0 };

  for (const item of items) {
    const query: MatchQuery = {
      originalDescription: item.originalDescription,
      normalizedDescription: item.normalizedDescription,
      unit: item.unit,
      manufacturer: item.manufacturer,
      manufacturerCode: item.manufacturerCode,
      attributes: sanitizeAttributes(item.attributes),
    };
    const result = await matchItem(query, retriever);

    await db.productMatch.deleteMany({ where: { requestedItemId: item.id } });
    const rows = [...result.candidates, ...result.rejected].map((candidate, index) => ({
      organizationId,
      requestedItemId: item.id,
      productId: candidate.productId,
      rank: index + 1,
      score: candidate.score,
      compatible: candidate.compatible,
      strategies: candidate.strategies,
      signals: candidate.signals as object,
      reasons: candidate.reasons,
      incompatibilities: candidate.incompatibilities as unknown as object,
    }));
    if (rows.length > 0) await db.productMatch.createMany({ data: rows });
    await db.requestedItem.update({ where: { id: item.id }, data: { matchOutcome: result.outcome } });

    if (result.outcome === "SUGGESTED") summary.suggested += 1;
    else if (result.outcome === "AMBIGUOUS") summary.ambiguous += 1;
    else summary.noMatch += 1;
  }
  return summary;
}
