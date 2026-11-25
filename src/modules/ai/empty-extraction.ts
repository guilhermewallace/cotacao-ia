import type { AiExtraction } from "@/modules/ai/schema";

/**
 * Extração vazia: ponto de partida do extrator por regras e do provedor mock.
 *
 * Fica fora de `schema.ts` para poder ser usada sem carregar o Zod — o extrator por regras
 * também roda no navegador, no motor de demonstração da página pública.
 */
export function emptyExtraction(overrides: Partial<AiExtraction> = {}): AiExtraction {
  return { documentType: "other", legibility: "good", customer: null, items: [], warnings: [], ...overrides };
}
