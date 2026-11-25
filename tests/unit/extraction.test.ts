import { describe, expect, it } from "vitest";
import { extractWithRules } from "@/modules/ai/heuristic-extractor";
import { AnthropicProvider, type AnthropicMessagesClient } from "@/modules/ai/providers/anthropic";
import { MockAiProvider } from "@/modules/ai/providers/mock";
import { OpenAIProvider, type OpenAIResponsesClient } from "@/modules/ai/providers/openai";
import { emptyExtraction, parseAiExtraction, type AiExtractedItem, type AiExtraction } from "@/modules/ai/schema";
import { AiProviderError } from "@/modules/ai/types";
import { normalizeExtractedItem } from "@/modules/extraction/normalize-item";

const context = { channel: "UPLOAD" as const, organizationId: "00000000-0000-4000-8000-000000000001" };

function aiItem(overrides: Partial<AiExtractedItem>): AiExtractedItem {
  return {
    originalDescription: "disjuntor tripolar 32A curva C",
    normalizedDescription: null,
    quantity: null,
    unit: null,
    manufacturer: null,
    manufacturerCode: null,
    attributes: [],
    page: null,
    sourceExcerpt: null,
    confidence: null,
    notes: null,
    ...overrides,
  };
}

const validExtraction: AiExtraction = {
  documentType: "quotation_request",
  legibility: "good",
  customer: { name: "Cliente Teste", taxId: null, email: null, phone: null, contactName: null },
  items: [aiItem({ quantity: 10, unit: "pç" })],
  warnings: [],
};

describe("saída estruturada da IA (schema Zod)", () => {
  it("aceita uma extração bem formada", () => {
    expect(parseAiExtraction(structuredClone(validExtraction)).items).toHaveLength(1);
  });

  it("rejeita saídas fora do schema", () => {
    expect(() => parseAiExtraction({ ...validExtraction, legibility: "ótima" })).toThrow();
    expect(() => parseAiExtraction({ ...validExtraction, items: [{ originalDescription: "x" }] })).toThrow();
    expect(() => parseAiExtraction({ items: [] })).toThrow();
    expect(() => parseAiExtraction("texto livre")).toThrow();
  });

  it("representa informação ausente como null, não como valor inventado", () => {
    const parsed = parseAiExtraction(structuredClone(validExtraction));
    expect(parsed.items[0]?.manufacturer).toBeNull();
    expect(parsed.customer?.taxId).toBeNull();
    expect(emptyExtraction().items).toEqual([]);
  });
});

describe("normalização determinística do item extraído", () => {
  const options = { sourceAttachmentId: null, reference: { origin: "message" as const } };

  it("recalcula os atributos por regras, a partir do texto original", () => {
    const item = normalizeExtractedItem(aiItem({ originalDescription: "10 pç disjuntor tripolar 32A curva C", quantity: 10, unit: "pç" }), {
      ...options,
      sourceText: "10 pç disjuntor tripolar 32A curva C",
    });
    expect(item?.quantity).toBe(10);
    expect(item?.unit).toBe("UN"); // "pç" e "un" são a mesma unidade canônica
    expect(item?.attributes.corrente_a).toBe(32);
    expect(item?.attributes.polos).toBe(3);
  });

  it("descarta números propostos pela IA que não existem no documento (anti-alucinação)", () => {
    const source = "disjuntor tripolar curva C";
    const item = normalizeExtractedItem(
      aiItem({
        originalDescription: "disjuntor tripolar curva C",
        normalizedDescription: "disjuntor tripolar 40A curva C", // o modelo "completou" a corrente
        attributes: [{ name: "corrente", value: "40A" }],
        quantity: 5, // o documento não traz quantidade
      }),
      { ...options, sourceText: source },
    );
    expect(item?.attributes.corrente_a).toBeUndefined();
    expect(item?.normalizedDescription).not.toContain("40");
    expect(item?.quantity).toBeNull();
    expect(item?.notes).toMatch(/quantidade/i);
    expect(item?.attributes.polos).toBe(3);
  });

  it("aceita quantidade escrita por extenso ou com separador de milhar", () => {
    const words = normalizeExtractedItem(aiItem({ originalDescription: "duas fontes 24V", quantity: 2 }), { ...options, sourceText: "preciso de duas fontes 24V" });
    expect(words?.quantity).toBe(2);
    const thousands = normalizeExtractedItem(aiItem({ originalDescription: "cabo flexível 2,5mm", quantity: 1500, unit: "m" }), { ...options, sourceText: "1.500 m cabo flexível 2,5mm" });
    expect(thousands?.quantity).toBe(1500);
  });

  it("mantém quantidade nula quando o pedido não informa", () => {
    const item = normalizeExtractedItem(aiItem({ originalDescription: "Fonte 24V" }), { ...options, sourceText: "Fonte 24V" });
    expect(item?.quantity).toBeNull();
    expect(item?.unit).toBeNull();
  });

  it("ignora itens vazios", () => {
    expect(normalizeExtractedItem(aiItem({ originalDescription: "   " }), options)).toBeNull();
  });
});

describe("extrator por regras (provedor mock)", () => {
  it("lê lista enviada por mensagem, com quantidades e unidades", () => {
    const result = extractWithRules("Bom dia! Preciso de cotação:\n- 10 disjuntores tripolares 32A curva C\n- 200m de cabo flexível 2,5mm azul\n- 20 un tomada 2P+T 20A branca\nObrigado");
    expect(result.documentType).toBe("quotation_request");
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({ quantity: 10 });
    expect(result.items[0]?.originalDescription).toMatch(/disjuntores tripolares 32A curva C/);
    expect(result.items[1]).toMatchObject({ quantity: 200, unit: "m" });
    expect(result.items[2]).toMatchObject({ quantity: 20 });
  });

  it("não transforma medida em quantidade nem inventa quantidade ausente", () => {
    const result = extractWithRules("Preciso de preço para:\nCabo flexível 4mm\n2,5mm² cabo flexível vermelho\nDisjuntor bipolar\nFonte 24V");
    expect(result.items.length).toBeGreaterThanOrEqual(3);
    for (const item of result.items) expect(item.quantity).toBeNull();
  });

  it("ignora saudações e frases que não são itens", () => {
    const result = extractWithRules("Olá, tudo bem?\nEstou montando um painel e gostaria de um orçamento.\nAbs,\nDiego");
    expect(result.items).toHaveLength(0);
    expect(result.documentType).toBe("other");
  });

  it("é determinístico", () => {
    const text = "5 contator 25A bobina 220V\n3 relé térmico 17-25A";
    expect(extractWithRules(text)).toEqual(extractWithRules(text));
  });
});

describe("provedores de IA (clientes simulados — nenhuma chamada externa)", () => {
  const document = { label: "mensagem", text: "10 disjuntores tripolares 32A curva C" };

  it("mock: usa a resposta preparada do documento de exemplo, pelo hash", async () => {
    const provider = new MockAiProvider({ extraction: (hash) => (hash === "abc" ? validExtraction : null), transcription: () => null });
    const fromFixture = await provider.extract({ label: "arquivo", sha256: "abc" });
    expect(fromFixture.customer?.name).toBe("Cliente Teste");
  });

  it("mock: não finge ler imagem desconhecida", async () => {
    const result = await new MockAiProvider().extract({ label: "foto", file: { data: Buffer.from([1, 2, 3]), contentType: "image/jpeg", fileName: "foto.jpg" }, sha256: "desconhecido" });
    expect(result.documentType).toBe("unreadable");
    expect(result.items).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/demonstração/i);
  });

  it("anthropic: envia schema estruturado e valida a resposta", async () => {
    const calls: unknown[] = [];
    const client: AnthropicMessagesClient = {
      messages: {
        parse: async (params) => {
          calls.push(params);
          return { parsed_output: structuredClone(validExtraction), stop_reason: "end_turn" };
        },
      },
    };
    const provider = new AnthropicProvider({ model: "modelo-teste", client });
    const result = await provider.extract(document, context);
    expect(result.items[0]?.quantity).toBe(10);
    const params = calls[0] as { model: string; output_config?: { format?: unknown }; system?: string };
    expect(params.model).toBe("modelo-teste");
    expect(params.output_config?.format).toBeDefined();
    expect(params.system).toMatch(/null/i); // a instrução de não inventar dados faz parte do prompt
  });

  it("anthropic: resposta fora do schema vira erro (com nova tentativa), nunca dado inválido", async () => {
    const client: AnthropicMessagesClient = { messages: { parse: async () => ({ parsed_output: { items: "nenhum" }, stop_reason: "end_turn" }) } };
    const error = await new AnthropicProvider({ model: "m", client }).extract(document, context).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).retryable).toBe(true);
  });

  it("anthropic: distingue falhas temporárias (429/5xx) de definitivas (4xx)", async () => {
    const failing = (status: number): AnthropicMessagesClient => ({
      messages: {
        parse: async () => {
          throw Object.assign(new Error("falha"), { status });
        },
      },
    });
    const rateLimited = await new AnthropicProvider({ model: "m", client: failing(429) }).extract(document, context).catch((caught: unknown) => caught);
    const unauthorized = await new AnthropicProvider({ model: "m", client: failing(401) }).extract(document, context).catch((caught: unknown) => caught);
    expect((rateLimited as AiProviderError).retryable).toBe(true);
    expect((unauthorized as AiProviderError).retryable).toBe(false);
    expect((unauthorized as AiProviderError).message).not.toMatch(/falha$/); // não vaza a mensagem interna
  });

  it("openai: valida a resposta estruturada e trata resposta incompleta", async () => {
    const ok: OpenAIResponsesClient = { responses: { parse: async () => ({ output_parsed: structuredClone(validExtraction), status: "completed" }) } };
    expect((await new OpenAIProvider({ model: "m", client: ok }).extract(document, context)).items).toHaveLength(1);

    const incomplete: OpenAIResponsesClient = { responses: { parse: async () => ({ output_parsed: null, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }) } };
    const error = await new OpenAIProvider({ model: "m", client: incomplete }).extract(document, context).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiProviderError);
  });
});
