import type { MatchOutcome } from "@/generated/prisma/enums";
import type { AttributeComparison } from "@/modules/normalization/attribute-compare";
import type { TechnicalAttributes } from "@/modules/normalization/attributes";

/** Item solicitado, na forma consumida pelo Matching Engine. */
export interface MatchQuery {
  originalDescription: string;
  normalizedDescription: string;
  unit: string | null;
  manufacturer: string | null;
  manufacturerCode: string | null;
  attributes: TechnicalAttributes;
}

export type MatchStrategy = "SKU_EXACT" | "MANUFACTURER_CODE" | "ALIAS_CODE" | "FULL_TEXT" | "TRIGRAM" | "SYNONYM" | "SEMANTIC";

/** Produto candidato com os sinais de recuperação que o trouxeram. */
export interface CandidateProduct {
  id: string;
  sku: string;
  description: string;
  descriptionNormalized: string;
  searchText: string;
  manufacturer: string | null;
  manufacturerCode: string | null;
  unit: string;
  attributes: TechnicalAttributes;
  signals: RetrievalSignals;
}

export interface RetrievalSignals {
  skuExact: boolean;
  manufacturerCodeExact: boolean;
  aliasCodeExact: boolean;
  /** Código que casou, para a justificativa. */
  matchedCode: string | null;
  /** ts_rank_cd da busca textual (0 quando não recuperado por FTS). */
  fullTextRank: number;
  /** Similaridade por trigramas com a descrição (0..1). */
  trigram: number;
  /** Similaridade por trigramas com o melhor sinônimo (0..1). */
  synonymTrigram: number;
  matchedSynonym: string | null;
  /** Similaridade semântica por embeddings (0..1), quando habilitada. */
  semantic: number;
}

export interface ScoredCandidate {
  productId: string;
  sku: string;
  description: string;
  manufacturer: string | null;
  unit: string;
  /** Pontuação final de 0 a 1. */
  score: number;
  /** Falso quando há atributo técnico crítico divergente. */
  compatible: boolean;
  strategies: MatchStrategy[];
  signals: {
    lexical: number;
    tokenCoverage: number;
    trigram: number;
    attribute: number | null;
    codeMatch: "SKU" | "MANUFACTURER_CODE" | "ALIAS_CODE" | null;
    unitMismatch: boolean;
    /** Soma das distâncias relativas das divergências críticas (0 = nenhuma). */
    mismatchDistance: number;
  };
  /** Justificativas em português, em ordem de relevância. */
  reasons: string[];
  /** Divergências e lacunas de atributos técnicos. */
  incompatibilities: AttributeComparison[];
  comparisons: AttributeComparison[];
}

export interface MatchResult {
  outcome: MatchOutcome;
  /** Candidatos compatíveis, do melhor para o pior. */
  candidates: ScoredCandidate[];
  /** Candidatos textualmente parecidos, mas tecnicamente incompatíveis. Nunca são sugeridos. */
  rejected: ScoredCandidate[];
}

export interface CandidateRetriever {
  retrieve(query: MatchQuery): Promise<CandidateProduct[]>;
}
