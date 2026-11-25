import type { MatchOutcome } from "@/generated/prisma/enums";
import type { CandidateProduct, MatchQuery, MatchResult, MatchStrategy, ScoredCandidate } from "@/modules/matching/types";
import { compareAttributes, type AttributeComparison } from "@/modules/normalization/attribute-compare";
import { significantTokens } from "@/modules/normalization/text";

/**
 * Pontuação, validação técnica e classificação dos candidatos — funções puras.
 *
 * Princípios:
 *  - Similaridade textual NUNCA basta: se um atributo técnico crítico diverge
 *    (ex.: 32 A × 40 A), o candidato é rejeitado, por mais parecido que seja o texto.
 *  - Código idêntico (SKU ou fabricante) é o sinal mais forte, mas não esconde
 *    contradições: código de um produto + especificação de outro vira "ambíguo".
 *  - Nada é aprovado automaticamente. "SUGGESTED" significa apenas que há uma
 *    sugestão forte e única para o revisor confirmar com um clique.
 */

export const MATCHING_THRESHOLDS = {
  /** Pontuação mínima para uma sugestão forte. */
  strong: 0.78,
  /** Distância mínima para o segundo colocado. */
  margin: 0.08,
  /** Abaixo disso o candidato não é apresentado. */
  minimum: 0.35,
  /** Semelhança textual mínima: atributos iguais não bastam se a descrição não tem nada a ver. */
  lexicalFloor: 0.3,
  /** Máximo de candidatos compatíveis e de rejeitados guardados por item. */
  keepCompatible: 5,
  keepRejected: 3,
} as const;

const CODE_SCORES = { SKU: 0.99, MANUFACTURER_CODE: 0.97, ALIAS_CODE: 0.95 } as const;

function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Cobertura de termos: fração (ponderada) dos termos do item presentes no produto.
 * O primeiro termo relevante costuma ser o tipo do produto ("disjuntor", "cabo") e pesa mais.
 */
export function tokenCoverage(queryTokens: string[], productTokens: Set<string>): { coverage: number; headMatched: boolean } {
  if (queryTokens.length === 0) return { coverage: 0, headMatched: false };
  let total = 0;
  let matched = 0;
  let headMatched = false;
  queryTokens.forEach((token, index) => {
    // Termos com dígitos ("24", "32a", "m18") distinguem produtos de uma mesma família e pesam em dobro.
    const weight = index === 0 ? 3 : /\d/.test(token) ? 2 : 1;
    total += weight;
    if (productTokens.has(token)) {
      matched += weight;
      if (index === 0) headMatched = true;
    }
  });
  return { coverage: matched / total, headMatched };
}

/**
 * Distância das divergências críticas: quanto menor, mais "próximo" do pedido está o
 * produto rejeitado (63 A está mais perto de 80 A do que 10 A). Serve só para ordenar
 * as alternativas mostradas ao revisor — nunca para torná-las compatíveis.
 */
function mismatchDistance(query: MatchQuery, candidate: CandidateProduct, mismatches: AttributeComparison[]): number {
  let distance = 0;
  for (const mismatch of mismatches) {
    const requested = query.attributes[mismatch.key];
    const offered = candidate.attributes[mismatch.key];
    if (typeof requested === "number" && typeof offered === "number" && requested > 0) {
      distance += Math.min(Math.abs(requested - offered) / requested, 1);
    } else {
      distance += 1;
    }
  }
  return distance;
}

function describe(comparison: AttributeComparison): string {
  return `${comparison.label.toLowerCase()} ${comparison.requested}`;
}

export function scoreCandidate(query: MatchQuery, candidate: CandidateProduct): ScoredCandidate {
  const { signals } = candidate;
  const comparison = compareAttributes(query.attributes, candidate.attributes);

  const queryTokens = significantTokens(query.normalizedDescription);
  const productTokens = new Set(significantTokens(candidate.searchText || candidate.descriptionNormalized));
  const { coverage, headMatched } = tokenCoverage(queryTokens, productTokens);
  const trigram = Math.max(signals.trigram, signals.synonymTrigram, signals.semantic);

  const codeMatch = signals.skuExact ? "SKU" : signals.manufacturerCodeExact ? "MANUFACTURER_CODE" : signals.aliasCodeExact ? "ALIAS_CODE" : null;

  const strategies: MatchStrategy[] = [];
  if (signals.skuExact) strategies.push("SKU_EXACT");
  if (signals.manufacturerCodeExact) strategies.push("MANUFACTURER_CODE");
  if (signals.aliasCodeExact) strategies.push("ALIAS_CODE");
  if (signals.fullTextRank > 0) strategies.push("FULL_TEXT");
  if (signals.trigram > 0) strategies.push("TRIGRAM");
  if (signals.synonymTrigram > 0) strategies.push("SYNONYM");
  if (signals.semantic > 0) strategies.push("SEMANTIC");

  // ── Sinal lexical ────────────────────────────────────────────────────────
  let lexical = clamp(0.6 * coverage + 0.4 * trigram);
  // Sinônimo cadastrado praticamente idêntico vale como descrição idêntica.
  if (signals.synonymTrigram >= 0.85) lexical = Math.max(lexical, signals.synonymTrigram);
  // Tipo de produto diferente ("contator" × "disjuntor") derruba a similaridade.
  if (!headMatched && signals.synonymTrigram < 0.6 && queryTokens.length > 0) lexical *= 0.55;

  // ── Sinal de atributos ───────────────────────────────────────────────────
  const requestedCount = comparison.comparisons.length;
  const unknownCount = comparison.unknownCritical.length + comparison.unknownSoft.length;
  const attribute = requestedCount === 0 ? null : clamp((comparison.matches.length + 0.3 * unknownCount) / requestedCount);

  const unitMismatch = Boolean(query.unit && candidate.unit && query.unit !== candidate.unit);

  let score: number;
  if (codeMatch) {
    score = CODE_SCORES[codeMatch];
  } else if (attribute === null) {
    // Sem atributos técnicos no pedido: só o texto decide, com teto para exigir revisão atenta.
    score = Math.min(lexical, 0.9) * 0.92;
  } else {
    score = 0.55 * lexical + 0.45 * attribute;
  }
  score -= 0.06 * comparison.softMismatches.length;
  if (unitMismatch) score -= 0.07;
  // "Válvula 24Vcc" não é uma "Fonte 24Vcc" só porque a tensão coincide.
  if (!codeMatch && lexical < MATCHING_THRESHOLDS.lexicalFloor) score = Math.min(score, 0.25);

  const hasCriticalMismatch = comparison.criticalMismatches.length > 0;
  // Código idêntico com especificação divergente não é descartado: é uma contradição a esclarecer.
  const compatible = !hasCriticalMismatch || codeMatch !== null;
  if (hasCriticalMismatch) score = codeMatch ? Math.min(score, 0.7) : Math.min(score, 0.29);
  score = Math.round(clamp(score) * 1000) / 1000;

  // ── Justificativas ───────────────────────────────────────────────────────
  const reasons: string[] = [];
  if (codeMatch === "SKU") reasons.push(`SKU idêntico (${candidate.sku}).`);
  if (codeMatch === "MANUFACTURER_CODE") reasons.push(`Código do fabricante idêntico (${candidate.manufacturerCode ?? signals.matchedCode ?? ""}).`);
  if (codeMatch === "ALIAS_CODE") reasons.push(`Código alternativo cadastrado (${signals.matchedCode ?? ""}).`);
  if (signals.synonymTrigram >= 0.6 && signals.matchedSynonym) reasons.push(`Sinônimo cadastrado: "${signals.matchedSynonym}".`);
  if (queryTokens.length > 0) reasons.push(`Descrição: ${percent(coverage)} dos termos do pedido presentes no produto.`);
  if (!headMatched && queryTokens[0] && !codeMatch) reasons.push(`Tipo de produto possivelmente diferente ("${queryTokens[0]}" não consta na descrição).`);
  if (comparison.matches.length > 0) reasons.push(`Atributos compatíveis: ${comparison.matches.map(describe).join(", ")}.`);
  for (const mismatch of comparison.criticalMismatches) {
    reasons.push(`Incompatível — ${mismatch.label.toLowerCase()}: solicitado ${mismatch.requested}, produto ${mismatch.product ?? "não informado"}.`);
  }
  for (const mismatch of comparison.softMismatches) {
    reasons.push(`Diferença — ${mismatch.label.toLowerCase()}: solicitado ${mismatch.requested}, produto ${mismatch.product ?? "não informado"}.`);
  }
  if (comparison.unknownCritical.length > 0) {
    reasons.push(`Não informado no catálogo: ${comparison.unknownCritical.map((item) => item.label.toLowerCase()).join(", ")} — confira antes de aceitar.`);
  }
  if (unitMismatch) reasons.push(`Unidade diferente: solicitado em ${query.unit}, produto vendido em ${candidate.unit}.`);
  if (codeMatch && hasCriticalMismatch) reasons.unshift("Atenção: o código corresponde a este produto, mas a descrição do pedido diverge dele.");

  return {
    productId: candidate.id,
    sku: candidate.sku,
    description: candidate.description,
    manufacturer: candidate.manufacturer,
    unit: candidate.unit,
    score,
    compatible,
    strategies,
    signals: {
      lexical: Math.round(lexical * 1000) / 1000,
      tokenCoverage: Math.round(coverage * 1000) / 1000,
      trigram: Math.round(trigram * 1000) / 1000,
      attribute,
      codeMatch,
      unitMismatch,
      mismatchDistance: Math.round(mismatchDistance(query, candidate, comparison.criticalMismatches) * 1000) / 1000,
    },
    reasons,
    incompatibilities: [...comparison.criticalMismatches, ...comparison.softMismatches, ...comparison.unknownCritical],
    comparisons: comparison.comparisons,
  };
}

function hasBlockingDoubt(candidate: ScoredCandidate): boolean {
  if (candidate.signals.unitMismatch) return true;
  return candidate.incompatibilities.some((item) => {
    if (!item.critical) return false;
    // Com código idêntico, um atributo não informado no catálogo não gera dúvida; uma divergência, sim.
    return item.verdict === "MISMATCH" || candidate.signals.codeMatch === null;
  });
}

/**
 * Classificação do item:
 *  - SUGGESTED: um candidato compatível, forte, sem dúvidas técnicas e claramente à frente dos demais;
 *  - AMBIGUOUS: há candidatos plausíveis, mas a escolha exige análise;
 *  - NO_MATCH: nenhum candidato compatível relevante.
 */
export function classifyMatch(compatible: ScoredCandidate[]): MatchOutcome {
  const [best, second] = compatible;
  if (!best || best.score < MATCHING_THRESHOLDS.minimum) return "NO_MATCH";

  const clearLead = !second || best.score - second.score >= MATCHING_THRESHOLDS.margin;
  if (best.score >= MATCHING_THRESHOLDS.strong && clearLead && !hasBlockingDoubt(best)) return "SUGGESTED";
  return "AMBIGUOUS";
}

export function rankCandidates(query: MatchQuery, candidates: CandidateProduct[]): MatchResult {
  const scored = candidates.map((candidate) => scoreCandidate(query, candidate));
  const byScore = (a: ScoredCandidate, b: ScoredCandidate) => b.score - a.score || a.sku.localeCompare(b.sku);

  const compatible = scored
    .filter((candidate) => candidate.compatible && candidate.score >= MATCHING_THRESHOLDS.minimum)
    .sort(byScore)
    .slice(0, MATCHING_THRESHOLDS.keepCompatible);

  // Rejeitados: parecidos no texto, incompatíveis na técnica. Guardados para explicar ao revisor
  // por que não foram sugeridos — ordenados pela semelhança textual.
  const rejected = scored
    .filter((candidate) => !candidate.compatible && candidate.signals.lexical >= 0.35)
    .sort((a, b) => a.signals.mismatchDistance - b.signals.mismatchDistance || b.signals.lexical - a.signals.lexical || a.sku.localeCompare(b.sku))
    .slice(0, MATCHING_THRESHOLDS.keepRejected);

  let outcome = classifyMatch(compatible);

  // Contradição no pedido: ele cita um código que identifica OUTRO produto, diferente do melhor
  // candidato pela descrição (ex.: código do modelo 220 V, texto pedindo 24 V). Nunca é sugestão
  // forte — quem decide é o revisor.
  const best = compatible[0];
  if (outcome === "SUGGESTED" && best && best.signals.codeMatch === null) {
    const codeElsewhere = scored.some((candidate) => candidate.signals.codeMatch !== null && candidate.productId !== best.productId);
    if (codeElsewhere) outcome = "AMBIGUOUS";
  }

  return { outcome, candidates: compatible, rejected };
}
