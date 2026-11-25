import { z } from "zod";

/**
 * Contrato de saída da extração por IA.
 *
 * Este schema é enviado aos provedores como "structured output" e a resposta é
 * validada novamente por ele antes de qualquer uso. Regras que valem para todos
 * os provedores (inclusive o mock):
 *  - nunca inventar: informação ausente é `null`;
 *  - a descrição original é copiada literalmente do documento;
 *  - preços NÃO fazem parte da extração — vêm sempre do catálogo.
 *
 * O schema evita restrições numéricas e chaves dinâmicas para ser compatível com os
 * modos de saída estruturada da Anthropic e da OpenAI.
 */

export const aiExtractedItemSchema = z.object({
  originalDescription: z.string().describe("Texto do item exatamente como aparece no documento, sem a quantidade."),
  normalizedDescription: z
    .string()
    .nullable()
    .describe("Descrição com abreviações expandidas e erros de digitação corrigidos. Não acrescente especificações ausentes no documento. null se não houver ganho."),
  quantity: z.number().nullable().describe("Quantidade solicitada. null se o documento não informar."),
  unit: z.string().nullable().describe("Unidade de medida como escrita (un, pç, m, rolo, cx...). null se ausente."),
  manufacturer: z.string().nullable().describe("Fabricante ou marca, somente se citado."),
  manufacturerCode: z.string().nullable().describe("Código/part number do fabricante ou referência, somente se citado."),
  attributes: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .describe("Atributos técnicos citados (tensão, corrente, polos, bitola, diâmetro, material, rosca...). Valor com unidade, como no documento."),
  page: z.number().int().nullable().describe("Página do documento em que o item aparece, se aplicável."),
  sourceExcerpt: z.string().nullable().describe("Trecho literal do documento (linha) de onde o item foi lido."),
  confidence: z.number().nullable().describe("Confiança da leitura, de 0 a 1."),
  notes: z.string().nullable().describe("Observações: trecho ilegível, ambiguidade, informação faltante."),
});

export const aiCustomerSchema = z.object({
  name: z.string().nullable(),
  taxId: z.string().nullable().describe("CNPJ ou CPF, somente se constar no documento."),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  contactName: z.string().nullable(),
});

export const aiExtractionSchema = z.object({
  documentType: z
    .enum(["quotation_request", "other", "unreadable"])
    .describe("quotation_request: contém itens a cotar. other: sem itens (saudação, assunto diverso). unreadable: ilegível."),
  legibility: z.enum(["good", "partial", "poor"]),
  customer: aiCustomerSchema.nullable().describe("Dados do solicitante que constem no documento. null se ausentes."),
  items: z.array(aiExtractedItemSchema),
  warnings: z.array(z.string()).describe("Avisos ao revisor humano, em português."),
});

export type AiExtractedItem = z.infer<typeof aiExtractedItemSchema>;
export type AiCustomer = z.infer<typeof aiCustomerSchema>;
export type AiExtraction = z.infer<typeof aiExtractionSchema>;

export const MAX_ITEMS_PER_DOCUMENT = 400;

/** Valida a resposta de um provedor. Lança `ZodError` se a estrutura for inválida. */
export function parseAiExtraction(raw: unknown): AiExtraction {
  const parsed = aiExtractionSchema.parse(raw);
  return { ...parsed, items: parsed.items.slice(0, MAX_ITEMS_PER_DOCUMENT) };
}

export { emptyExtraction } from "@/modules/ai/empty-extraction";
