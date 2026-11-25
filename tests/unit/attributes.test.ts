import { describe, expect, it } from "vitest";
import { compareAttributes } from "@/modules/normalization/attribute-compare";
import { parseAttributes } from "@/modules/normalization/attribute-parser";
import { sanitizeAttributes } from "@/modules/normalization/attributes";

const verdictOf = (requested: string, product: string, key: string) =>
  compareAttributes(parseAttributes(requested), parseAttributes(product)).comparisons.find((entry) => entry.key === key)?.verdict;

describe("identificação de atributos técnicos", () => {
  it("lê corrente, polos e curva de um disjuntor", () => {
    const attributes = parseAttributes("Disjuntor DIN tripolar 40A curva C 6kA");
    expect(attributes.corrente_a).toBe(40);
    expect(attributes.polos).toBe(3);
    expect(attributes.curva).toBe("c");
    expect(attributes.capacidade_interrupcao_ka).toBe(6);
  });

  it("lê polos em diferentes grafias", () => {
    expect(parseAttributes("disjuntor 3P 32A").polos).toBe(3);
    expect(parseAttributes("disjuntores tripolares 32A").polos).toBe(3);
    expect(parseAttributes("minidisjuntor bipolar 20A").polos).toBe(2);
    expect(parseAttributes("IDR tetrapolar 63A 30mA").polos).toBe(4);
  });

  it("lê seção de cabos com vírgula decimal e formações", () => {
    expect(parseAttributes("Cabo flexível 2,5mm² azul 750V").secao_mm2).toBe(2.5);
    const pp = parseAttributes("Cabo PP 3x2,5mm²");
    expect(pp.secao_mm2).toBe(2.5);
    expect(pp.condutores).toBe(3);
    expect(parseAttributes("cabo flex 4mm preto").secao_mm2).toBe(4);
  });

  it("lê tensão e distingue corrente alternada de contínua", () => {
    const ac = parseAttributes("Contator tripolar 18A bobina 220Vca");
    expect(ac.tensao_v).toEqual([220]);
    expect(ac.tipo_tensao).toBe("ca");
    const dc = parseAttributes("Fonte chaveada 24Vcc 5A");
    expect(dc.tensao_v).toEqual([24]);
    expect(dc.tipo_tensao).toBe("cc");
  });

  it("lê diâmetros em polegadas e em milímetros", () => {
    const inches = parseAttributes('Eletroduto PVC rígido roscável 3/4" barra 3m');
    expect(inches.diametro).toBeDefined();
    expect(parseAttributes("eletroduto 3/4").diametro).toEqual(inches.diametro);
    expect(parseAttributes('Eletroduto PVC 1"').diametro).not.toEqual(inches.diametro);
  });

  it("lê corrente residual, grau de proteção e potência", () => {
    expect(parseAttributes("IDR bipolar 40A 30mA").corrente_residual_ma).toBe(30);
    expect(parseAttributes("Caixa de passagem IP65").grau_protecao).toBe("ip65");
    // "bivolt" vira o conjunto de tensões aceitas
    expect(parseAttributes("Lâmpada LED 9W bivolt").tensao_v).toEqual([127, 220]);
    expect(parseAttributes("Lâmpada LED 9W bivolt").potencia_w).toBe(9);
    expect(parseAttributes("Inversor de frequência 2CV 220V").potencia_w).toBeGreaterThan(1400);
  });

  it("nunca inventa um valor a partir de um trecho ilegível", () => {
    const attributes = parseAttributes("disj. bipolar 4_A");
    expect(attributes.corrente_a).toBeUndefined();
    expect(attributes.polos).toBe(2);
  });

  it("não confunde comprimento de abraçadeira com diâmetro", () => {
    expect(parseAttributes("Abraçadeira nylon 200mm preta").diametro).toBeUndefined();
  });
});

describe("validação de compatibilidade técnica", () => {
  it("NÃO trata 32A como equivalente a 40A", () => {
    const summary = compareAttributes(parseAttributes("disjuntor tripolar 32A curva C"), parseAttributes("Disjuntor DIN Tripolar 40A Curva C 3kA"));
    expect(summary.compatible).toBe(false);
    expect(summary.criticalMismatches.map((entry) => entry.key)).toContain("corrente_a");
    const mismatch = summary.criticalMismatches.find((entry) => entry.key === "corrente_a");
    expect(mismatch?.requested).toContain("32");
    expect(mismatch?.product).toContain("40");
  });

  it("aceita o produto quando os atributos críticos conferem", () => {
    const summary = compareAttributes(parseAttributes("disjuntor tripolar 32A curva C"), parseAttributes("Disjuntor DIN Tripolar 32A Curva C 3kA"));
    expect(summary.compatible).toBe(true);
    expect(summary.matches.map((entry) => entry.key)).toEqual(expect.arrayContaining(["corrente_a", "polos", "curva"]));
  });

  it("diferencia número de polos, seção, tensão e curva", () => {
    expect(verdictOf("disjuntor bipolar 20A", "Disjuntor DIN Tripolar 20A Curva C", "polos")).toBe("MISMATCH");
    expect(verdictOf("cabo flexível 2,5mm²", "Cabo Flexível 4mm² 750V Azul", "secao_mm2")).toBe("MISMATCH");
    expect(verdictOf("contator 18A bobina 380V", "Contator Tripolar 18A Bobina 220Vca", "tensao_v")).toBe("MISMATCH");
    expect(verdictOf("disjuntor 16A curva B", "Disjuntor DIN Monopolar 16A Curva C", "curva")).toBe("MISMATCH");
  });

  it("marca como desconhecido (e não como igual) o que o catálogo não informa", () => {
    const summary = compareAttributes(parseAttributes("tomada 2P+T 20A branca"), parseAttributes("Tomada 2P+T branca"));
    const current = summary.comparisons.find((entry) => entry.key === "corrente_a");
    expect(current?.verdict).toBe("UNKNOWN");
    expect(current?.product).toBeNull();
    expect(summary.compatible).toBe(true); // desconhecido não reprova, mas reduz a pontuação
  });

  it("compara dimensões sem depender da ordem nem da unidade escrita", () => {
    expect(verdictOf("canaleta 30x30", "Canaleta PVC 30x30mm Cinza 2m", "dimensoes")).toBe("MATCH");
    expect(verdictOf("canaleta 50x30", "Canaleta PVC 30x50mm", "dimensoes")).toBe("MATCH");
    expect(verdictOf("canaleta 30x30", "Canaleta PVC 50x50mm", "dimensoes")).toBe("MISMATCH");
  });

  it("aceita a corrente pedida dentro da faixa de ajuste do relé", () => {
    const inside = compareAttributes(parseAttributes("relé térmico 15A"), parseAttributes("Relé Térmico de Sobrecarga 12-18A"));
    expect(inside.compatible).toBe(true);
    const outside = compareAttributes(parseAttributes("relé térmico 30A"), parseAttributes("Relé Térmico de Sobrecarga 12-18A"));
    expect(outside.compatible).toBe(false);
  });
});

describe("saneamento de atributos nas fronteiras (IA, importação, formulário)", () => {
  it("ignora o que não é objeto, chaves desconhecidas e valores ausentes", () => {
    for (const raw of [null, undefined, 32, "32A", [{ corrente_a: 32 }]]) expect(sanitizeAttributes(raw)).toEqual({});
    expect(sanitizeAttributes({ corrente_a: 32, inventado: 1, curva: null, polos: undefined })).toEqual({ corrente_a: 32 });
  });

  it("aceita apenas números positivos e finitos", () => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "32", true, [32]]) {
      expect(sanitizeAttributes({ corrente_a: invalid })).toEqual({});
    }
    expect(sanitizeAttributes({ corrente_a: 2.5 })).toEqual({ corrente_a: 2.5 });
  });

  it("apara textos, põe em minúsculas e limita a 60 caracteres", () => {
    expect(sanitizeAttributes({ curva: "  C " })).toEqual({ curva: "c" });
    expect(sanitizeAttributes({ curva: 5 })).toEqual({ curva: "5" });
    expect(sanitizeAttributes({ rosca: "x".repeat(60) })).toEqual({ rosca: "x".repeat(60) });
    for (const invalid of ["", "   ", "x".repeat(61), ["c"], {}]) expect(sanitizeAttributes({ curva: invalid })).toEqual({});
  });

  it("transforma valor único em conjunto, remove repetidos e ordena", () => {
    expect(sanitizeAttributes({ tensao_v: 220 })).toEqual({ tensao_v: [220] });
    expect(sanitizeAttributes({ tensao_v: [220, 127, 220] })).toEqual({ tensao_v: [127, 220] });
    expect(sanitizeAttributes({ material: "PVC" })).toEqual({ material: ["pvc"] });
    expect(sanitizeAttributes({ material: ["Latão", " aço ", "latão"] })).toEqual({ material: ["aço", "latão"] });
  });

  it("recusa conjuntos vazios, com mais de 8 valores ou com algum valor inválido", () => {
    const nine = Array.from({ length: 9 }, (_, index) => index + 1);
    for (const invalid of [[], nine, [220, 0], [220, "127"]]) expect(sanitizeAttributes({ tensao_v: invalid })).toEqual({});
    for (const invalid of [[], nine.map(String), ["pvc", ""], ["pvc", 3]]) expect(sanitizeAttributes({ material: invalid })).toEqual({});
    expect(sanitizeAttributes({ tensao_v: nine.slice(0, 8) })).toEqual({ tensao_v: nine.slice(0, 8) });
  });
});
