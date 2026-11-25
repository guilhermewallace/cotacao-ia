import { describe, expect, it } from "vitest";
import { extractCodeCandidates, normalizeCode, normalizeText, significantTokens } from "@/modules/normalization/text";
import { normalizeUnit, parseMoney, parseQuantity } from "@/modules/normalization/units";

describe("normalização de texto", () => {
  it("remove acentos, caixa e pontuação supérflua", () => {
    expect(normalizeText("  Disjuntor  40A — Curva C ")).toBe("disjuntor 40a curva c");
    // grafias equivalentes convergem para a mesma forma canônica
    expect(normalizeText("Disjuntor TRIPOLAR 40A")).toBe(normalizeText("disjuntor 3P 40 A"));
    expect(normalizeText("Cabo flexível 2,5mm²")).toBe("cabo flexivel 2.5mm2");
    expect(normalizeText(null)).toBe("");
  });

  it("mantém marcadores de trecho ilegível colados ao termo (não vira um valor)", () => {
    // "4_A" veio de uma foto em que o segundo dígito está borrado: não pode virar "4a".
    expect(normalizeText("disj. bipolar 4_A")).toContain("4_a");
    expect(normalizeText("disj. bipolar 4_A")).not.toMatch(/\b4a\b/);
  });

  it("extrai tokens significativos, sem palavras vazias e no singular", () => {
    const tokens = significantTokens(normalizeText("10 disjuntores tripolares de 32A para o quadro"));
    expect(tokens).toContain("disjuntor");
    expect(tokens).toContain("3p"); // "tripolares" → forma canônica
    expect(tokens).toContain("32a");
    expect(tokens).not.toContain("de");
    expect(tokens).not.toContain("para");
  });

  it("normaliza códigos de fabricante ignorando separadores", () => {
    expect(normalizeCode("ZTK-M3C32")).toBe(normalizeCode("ztk m3c32"));
    expect(normalizeCode("5SL1 132-7")).toBe(normalizeCode("5sl11327"));
    expect(normalizeCode(null)).toBe("");
  });

  it("encontra candidatos a código no meio da descrição", () => {
    const codes = extractCodeCandidates("Disjuntor DIN tripolar 32A curva C (ref. ZTK-M3C32)");
    expect(codes.map(normalizeCode)).toContain(normalizeCode("ZTK-M3C32"));
    // código escrito com espaço no meio
    expect(extractCodeCandidates("Contator (cód. AMP K18M)")).toContain(normalizeCode("AMP-K18M"));
    expect(extractCodeCandidates("disjuntor 5SL1 132-7 siemens")).toContain(normalizeCode("5SL1132-7"));
    // medidas não são códigos
    expect(extractCodeCandidates("disjuntor tripolar 32A 220V 6kA curva C")).toEqual([]);
    expect(extractCodeCandidates("cabo 2,5mm 100m").map(normalizeCode)).not.toContain("100m");
  });
});

describe("unidades, quantidades e valores (formato brasileiro)", () => {
  it("unifica sinônimos de unidade", () => {
    expect(normalizeUnit("pç")).toBe(normalizeUnit("peças"));
    expect(normalizeUnit("un")).toBe(normalizeUnit("UNID."));
    expect(normalizeUnit("metros")).toBe("M");
    expect(normalizeUnit("")).toBeNull();
    expect(normalizeUnit(null)).toBeNull();
  });

  it("interpreta quantidades com vírgula decimal e separador de milhar", () => {
    expect(parseQuantity("12")).toBe(12);
    expect(parseQuantity("2,5")).toBe(2.5);
    expect(parseQuantity("1.500")).toBe(1500);
    expect(parseQuantity("1.234,5")).toBe(1234.5);
    expect(parseQuantity(7)).toBe(7);
  });

  it("devolve null (e não zero) quando a quantidade é ausente ou inválida", () => {
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity(null)).toBeNull();
    expect(parseQuantity("a combinar")).toBeNull();
    expect(parseQuantity("-3")).toBeNull();
    expect(parseQuantity("0")).toBeNull();
  });

  it("interpreta valores monetários", () => {
    expect(parseMoney("R$ 1.234,56")).toBe(1234.56);
    expect(parseMoney("58,9")).toBe(58.9);
    expect(parseMoney("12.50")).toBe(12.5);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("sob consulta")).toBeNull();
  });
});

describe("leitura de CSV", () => {
  it("detecta o delimitador mesmo em arquivos mínimos", async () => {
    const { detectCsvDelimiter, readCsv } = await import("@/modules/documents/spreadsheet");
    expect(detectCsvDelimiter("descricao;quantidade\nFita isolante;1\n")).toBe(";");
    expect(detectCsvDelimiter("sku,descricao\nA-1,Cabo\n")).toBe(",");
    expect(detectCsvDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    // vírgula decimal não confunde um arquivo separado por ponto e vírgula
    expect(detectCsvDelimiter("codigo;preco\nA-1;12,50\nA-2;7,90\nA-3;1.234,00")).toBe(";");
    // vírgulas dentro de aspas não contam
    expect(detectCsvDelimiter('sku,descricao\nB-1,"Cabo flexível 2,5mm, azul"')).toBe(",");
    expect(detectCsvDelimiter("coluna unica\nvalor")).toBe(",");

    const sheet = readCsv(Buffer.from("descricao;quantidade\nFita isolante preta 19mm x 20m;1\n"));
    expect(sheet.rows).toEqual([
      ["descricao", "quantidade"],
      ["Fita isolante preta 19mm x 20m", "1"],
    ]);
  });
});
