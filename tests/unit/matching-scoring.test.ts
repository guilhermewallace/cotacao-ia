import { describe, expect, it } from "vitest";
import { MATCHING_THRESHOLDS, classifyMatch, rankCandidates, scoreCandidate } from "@/modules/matching/scoring";
import type { CandidateProduct, MatchQuery, RetrievalSignals } from "@/modules/matching/types";
import { parseAttributes } from "@/modules/normalization/attribute-parser";
import { normalizeText } from "@/modules/normalization/text";

const NO_SIGNALS: RetrievalSignals = {
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

function query(description: string, extra: Partial<MatchQuery> = {}): MatchQuery {
  return {
    originalDescription: description,
    normalizedDescription: normalizeText(description),
    unit: null,
    manufacturer: null,
    manufacturerCode: null,
    attributes: parseAttributes(description),
    ...extra,
  };
}

function product(sku: string, description: string, signals: Partial<RetrievalSignals> = {}, unit = "UN"): CandidateProduct {
  const normalized = normalizeText(description);
  return {
    id: sku,
    sku,
    description,
    descriptionNormalized: normalized,
    searchText: normalized,
    manufacturer: "Zentrik",
    manufacturerCode: null,
    unit,
    attributes: parseAttributes(description),
    signals: { ...NO_SIGNALS, fullTextRank: 0.1, trigram: 0.5, ...signals },
  };
}

/** Candidato compatível, sem ressalvas, com a pontuação indicada. */
function scoreLike(score: number) {
  const base = scoreCandidate(query("disjuntor tripolar 32A curva C"), product("DJ-3P-032-C", "Disjuntor DIN Tripolar 32A Curva C 3kA"));
  return { ...base, score };
}

const breakers = [
  product("DJ-3P-032-C", "Disjuntor DIN Tripolar 32A Curva C 3kA"),
  product("DJ-3P-040-C", "Disjuntor DIN Tripolar 40A Curva C 3kA"),
  product("DJ-3P-025-C", "Disjuntor DIN Tripolar 25A Curva C 3kA"),
  product("DJ-2P-032-C", "Disjuntor DIN Bipolar 32A Curva C 3kA"),
];

describe("pontuação e classificação de candidatos", () => {
  it("um disjuntor de 32A não é confundido com um de 40A", () => {
    const result = rankCandidates(query("disjuntor tripolar 32A curva C"), breakers);

    expect(result.outcome).toBe("SUGGESTED");
    expect(result.candidates[0]?.sku).toBe("DJ-3P-032-C");
    // Os parecidos só aparecem como DESCARTADOS, com o motivo técnico — nunca como equivalentes.
    expect(result.candidates.map((candidate) => candidate.sku)).not.toContain("DJ-3P-040-C");
    expect(result.candidates.map((candidate) => candidate.sku)).not.toContain("DJ-2P-032-C");
    const rejected40 = result.rejected.find((candidate) => candidate.sku === "DJ-3P-040-C");
    expect(rejected40?.compatible).toBe(false);
    expect(rejected40?.incompatibilities.map((entry) => entry.key)).toContain("corrente_a");
    expect(rejected40?.score).toBeLessThan(MATCHING_THRESHOLDS.minimum);
  });

  it("sem produto compatível, o resultado é NO_MATCH mesmo com textos quase idênticos", () => {
    const result = rankCandidates(query("disjuntor tripolar 80A curva C"), breakers);
    expect(result.outcome).toBe("NO_MATCH");
    expect(result.candidates).toHaveLength(0);
    expect(result.rejected.length).toBeGreaterThan(0);
    expect(result.rejected.every((candidate) => !candidate.compatible)).toBe(true);
  });

  it("pedido sem especificação suficiente fica ambíguo — nunca aprovado sozinho", () => {
    const result = rankCandidates(query("disjuntor tripolar curva C"), breakers);
    expect(result.outcome).toBe("AMBIGUOUS");
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it("código do fabricante idêntico gera sugestão forte, com justificativa", () => {
    const candidates = [
      product("DJ-3P-032-C", "Disjuntor DIN Tripolar 32A Curva C 3kA", { manufacturerCodeExact: true, matchedCode: "ZTK-M3C32" }),
      product("DJ-3P-040-C", "Disjuntor DIN Tripolar 40A Curva C 3kA"),
    ];
    const result = rankCandidates(query("Disjuntor DIN tripolar 32A curva C (ref. ZTK-M3C32)", { manufacturerCode: "ZTK-M3C32" }), candidates);
    expect(result.outcome).toBe("SUGGESTED");
    expect(result.candidates[0]?.sku).toBe("DJ-3P-032-C");
    expect(result.candidates[0]?.strategies).toContain("MANUFACTURER_CODE");
    expect(result.candidates[0]?.score).toBeGreaterThanOrEqual(0.95);
    expect(result.candidates[0]?.reasons.join(" ")).toMatch(/c[óo]digo/i);
  });

  it("código que bate com atributos que divergem nunca vira sugestão forte", () => {
    // O cliente citou o código do 40A, mas escreveu 32A: conflito → exige decisão humana.
    const candidates = [product("DJ-3P-040-C", "Disjuntor DIN Tripolar 40A Curva C 3kA", { manufacturerCodeExact: true, matchedCode: "ZTK-M3C40" })];
    const result = rankCandidates(query("disjuntor tripolar 32A curva C ref ZTK-M3C40", { manufacturerCode: "ZTK-M3C40" }), candidates);
    expect(result.outcome).not.toBe("SUGGESTED");
    const scored = [...result.candidates, ...result.rejected].find((candidate) => candidate.sku === "DJ-3P-040-C");
    expect(scored?.score).toBeLessThanOrEqual(0.7);
    expect(scored?.incompatibilities.map((entry) => entry.key)).toContain("corrente_a");
  });

  it("código citado que aponta para outro produto impede a sugestão forte", () => {
    // Texto pede bobina 24V; o código citado é o do modelo 220V.
    const candidates = [
      product("CT-18-24", "Contator Tripolar 18A Bobina 24Vca 1NA"),
      product("CT-18-220", "Contator Tripolar 18A Bobina 220Vca 1NA", { manufacturerCodeExact: true, matchedCode: "AMP-K18M" }),
    ];
    const withCode = rankCandidates(query("contator tripolar 18A bobina 24Vca AMP-K18M", { manufacturerCode: "AMP-K18M" }), candidates);
    expect(withCode.candidates[0]?.sku).toBe("CT-18-24");
    expect(withCode.outcome).toBe("AMBIGUOUS");

    // Sem o código contraditório, o mesmo pedido é uma sugestão forte.
    const withoutCode = rankCandidates(query("contator tripolar 18A bobina 24Vca"), [candidates[0]!, product("CT-18-220", "Contator Tripolar 18A Bobina 220Vca 1NA")]);
    expect(withoutCode.outcome).toBe("SUGGESTED");
    expect(withoutCode.candidates.map((candidate) => candidate.sku)).toEqual(["CT-18-24"]);
  });

  it("semelhança apenas de atributos (sem semelhança de texto) não gera candidato", () => {
    const scored = scoreCandidate(query("válvula solenoide 1/2\" 24Vcc"), product("FT-24-5", "Fonte Chaveada 24Vcc 5A 120W Trilho DIN", { fullTextRank: 0, trigram: 0.05 }));
    expect(scored.score).toBeLessThan(MATCHING_THRESHOLDS.minimum);
    const result = rankCandidates(query("válvula solenoide 1/2\" 24Vcc"), [product("FT-24-5", "Fonte Chaveada 24Vcc 5A 120W Trilho DIN", { fullTextRank: 0, trigram: 0.05 })]);
    expect(result.outcome).toBe("NO_MATCH");
  });

  it("classifica como forte apenas com pontuação alta E margem clara para o segundo", () => {
    const make = (score: number) => scoreLike(score);
    expect(classifyMatch([])).toBe("NO_MATCH");
    expect(classifyMatch([make(0.9)])).toBe("SUGGESTED");
    expect(classifyMatch([make(0.9), make(0.5)])).toBe("SUGGESTED");
    expect(classifyMatch([make(0.9), make(0.86)])).toBe("AMBIGUOUS");
    expect(classifyMatch([make(0.6)])).toBe("AMBIGUOUS");
  });

  it("limita a quantidade de candidatos apresentados", () => {
    const many = Array.from({ length: 12 }, (_, index) => product(`CB-${index}`, `Cabo Flexível 2,5mm² 750V cor ${index}`));
    const result = rankCandidates(query("cabo flexível 2,5mm"), many);
    expect(result.candidates.length).toBeLessThanOrEqual(MATCHING_THRESHOLDS.keepCompatible);
    expect(result.rejected.length).toBeLessThanOrEqual(MATCHING_THRESHOLDS.keepRejected);
  });
});
