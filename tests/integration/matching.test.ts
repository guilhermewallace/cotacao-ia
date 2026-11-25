import { beforeAll, describe, expect, it } from "vitest";
import { setProductActive } from "@/modules/catalog/products";
import { matchItem } from "@/modules/matching/engine";
import { PgCandidateRetriever } from "@/modules/matching/retrieval";
import type { MatchQuery, MatchResult } from "@/modules/matching/types";
import { parseAttributes } from "@/modules/normalization/attribute-parser";
import { normalizeText } from "@/modules/normalization/text";
import { createTestOrganization, productId, type TestOrganization } from "../helpers/factory";

/**
 * MATCHING ENGINE HÍBRIDO contra o PostgreSQL real (SKU, código de fabricante, texto completo,
 * similaridade por trigramas, sinônimos e validação de atributos), com o catálogo de demonstração.
 */

let org: TestOrganization;
let retriever: PgCandidateRetriever;

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

const match = (description: string, extra: Partial<MatchQuery> = {}): Promise<MatchResult> => matchItem(query(description, extra), retriever);
const skus = (result: MatchResult) => result.candidates.map((candidate) => candidate.sku);

beforeAll(async () => {
  org = await createTestOrganization("match", { withDemoCatalog: true });
  retriever = new PgCandidateRetriever(org.id);
});

describe("correspondência exata", () => {
  it("SKU interno", async () => {
    const result = await match("DJ-3P-032-C");
    expect(result.outcome).toBe("SUGGESTED");
    expect(result.candidates[0]).toMatchObject({ sku: "DJ-3P-032-C" });
    expect(result.candidates[0]?.strategies).toContain("SKU_EXACT");
    expect(result.candidates[0]?.score).toBeGreaterThanOrEqual(0.95);
  });

  it("código do fabricante, escrito com ou sem separadores", async () => {
    for (const text of ["contator ref AMP-K18M", "contator ampk18m", "Contator (cód. AMP K18M)"]) {
      const result = await match(text);
      expect(result.candidates[0]?.sku, text).toBe("CT-18-220");
      expect(result.candidates[0]?.strategies, text).toContain("MANUFACTURER_CODE");
    }
  });
});

describe("texto, sinônimos e erros de digitação", () => {
  it("descrição completa encontra o produto certo", async () => {
    const result = await match("disjuntor tripolar 32A curva C");
    expect(result.outcome).toBe("SUGGESTED");
    expect(skus(result)).toEqual(["DJ-3P-032-C"]);
    expect(result.candidates[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("sinônimos cadastrados e abreviações do dia a dia", async () => {
    expect(skus(await match("minidisjuntor 3P 32A curva C"))[0]).toBe("DJ-3P-032-C");
    expect(skus(await match("disj. 3P 32A C"))[0]).toBe("DJ-3P-032-C");
    expect(skus(await match("tomada 2P+T 20A branca"))[0]).toBe("TM-2PT-20");
  });

  it("tolera erro de digitação, mas sem tratar como sugestão forte", async () => {
    const result = await match("dijuntor tripolar 32A curva C");
    expect(skus(result)[0]).toBe("DJ-3P-032-C");
    expect(result.candidates[0]?.strategies).toContain("TRIGRAM");
  });
});

describe("validação de atributos técnicos", () => {
  it("um disjuntor de 32A não é confundido com um de 40A (nem de 25A, nem bipolar)", async () => {
    const result = await match("disjuntor tripolar 32A curva C");
    expect(skus(result)).not.toContain("DJ-3P-040-C");
    expect(skus(result)).not.toContain("DJ-3P-025-C");
    expect(skus(result)).not.toContain("DJ-2P-032-C");

    const rejected = new Map(result.rejected.map((candidate) => [candidate.sku, candidate]));
    expect(rejected.size).toBeGreaterThan(0);
    for (const candidate of rejected.values()) {
      expect(candidate.compatible).toBe(false);
      expect(candidate.incompatibilities.length).toBeGreaterThan(0);
    }
    const forty = rejected.get("DJ-3P-040-C");
    if (forty) expect(forty.incompatibilities.map((entry) => entry.key)).toEqual(["corrente_a"]);
  });

  it("especificação que o catálogo não tem resulta em 'sem correspondência', com os parecidos explicados", async () => {
    const result = await match("disjuntor tripolar 80A curva C");
    expect(result.outcome).toBe("NO_MATCH");
    expect(result.candidates).toHaveLength(0);
    expect(result.rejected.length).toBeGreaterThan(0);
    expect(result.rejected.every((candidate) => candidate.incompatibilities.some((entry) => entry.key === "corrente_a"))).toBe(true);
  });

  it("bitola, tensão de bobina e diâmetro também são conferidos", async () => {
    const cable = await match("cabo flexível 2,5mm azul");
    expect(skus(cable)[0]).toBe("CB-25-AZ");
    expect(cable.candidates.every((candidate) => /2,5mm/.test(candidate.description))).toBe(true);
    expect(cable.rejected.every((candidate) => candidate.incompatibilities.some((entry) => entry.key === "secao_mm2"))).toBe(true);

    const coil = await match("contator tripolar 18A bobina 24V");
    expect(skus(coil)[0]).toBe("CT-18-24");
    expect(skus(coil)).not.toContain("CT-18-220");

    const conduit = await match("eletroduto pvc 3/4");
    expect(conduit.candidates.every((candidate) => !/1"|1\/2"/.test(candidate.description) || /3\/4/.test(candidate.description))).toBe(true);
    expect(skus(conduit)[0]).toBe("EL-PVC-34");
  });

  it("faixa de ajuste: corrente dentro da faixa do relé é compatível", async () => {
    const result = await match("relé térmico 15A");
    expect(skus(result)).toEqual(["RT-1218"]);
    expect(result.rejected.map((candidate) => candidate.sku)).not.toContain("RT-1218");
  });

  it("código que contradiz a descrição nunca vira sugestão forte", async () => {
    // O código é do contator com bobina 220V, mas o texto pede 24V.
    const result = await match("contator 18A bobina 24V AMP-K18M");
    expect(result.outcome).toBe("AMBIGUOUS");
    expect(skus(result)).toEqual(expect.arrayContaining(["CT-18-24", "CT-18-220"]));
    const byCode = result.candidates.find((candidate) => candidate.sku === "CT-18-220");
    expect(byCode?.score).toBeLessThanOrEqual(0.7);
    expect(byCode?.incompatibilities.map((entry) => entry.key)).toContain("tensao_v");
  });
});

describe("ambiguidade e ausência de correspondência", () => {
  it("pedido incompleto fica ambíguo: várias opções igualmente plausíveis", async () => {
    const result = await match("cabo flexível 2,5mm");
    expect(result.outcome).toBe("AMBIGUOUS");
    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
    const [first, second] = result.candidates;
    expect(first!.score - second!.score).toBeLessThan(0.08);
  });

  it("item que não existe no catálogo não recebe candidato 'por aproximação'", async () => {
    for (const text of ["manômetro 0-10 bar", "válvula solenoide 1/2\" 24Vcc", "chave fim de curso com rolete"]) {
      const result = await match(text);
      expect(result.outcome, text).toBe("NO_MATCH");
      expect(result.candidates, text).toHaveLength(0);
    }
  });

  it("produtos inativos não são sugeridos", async () => {
    const id = productId(org, "DJ-3P-032-C");
    await setProductActive(org.owner, id, false);
    try {
      const result = await match("disjuntor tripolar 32A curva C");
      expect(skus(result)).not.toContain("DJ-3P-032-C");
      expect(result.outcome).toBe("NO_MATCH");
      expect(skus(await match("DJ-3P-032-C"))).not.toContain("DJ-3P-032-C");
    } finally {
      await setProductActive(org.owner, id, true);
    }
  });

  it("é determinístico: a mesma consulta produz o mesmo resultado", async () => {
    const first = await match("sensor indutivo M18 PNP 24Vcc");
    const second = await match("sensor indutivo M18 PNP 24Vcc");
    expect(second).toEqual(first);
    expect(skus(first)[0]).toBe("SI-M18-PNP");
  });

  it("entradas hostis não quebram a busca (texto tratado como dado, nunca como SQL)", async () => {
    for (const text of ["'; DROP TABLE products; --", "disjuntor & | ! ( ) : * <-> 32A", "%%%___", "a".repeat(600), "32A"]) {
      const result = await match(text);
      expect(["SUGGESTED", "AMBIGUOUS", "NO_MATCH"]).toContain(result.outcome);
    }
    expect(skus(await match("disjuntor tripolar 32A curva C"))).toEqual(["DJ-3P-032-C"]);
  });
});
