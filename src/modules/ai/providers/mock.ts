import { extractWithRules } from "@/modules/ai/heuristic-extractor";
import { emptyExtraction, parseAiExtraction, type AiExtraction } from "@/modules/ai/schema";
import { AiProviderError, type AiProvider, type ExtractionDocument, type TranscriptionProvider } from "@/modules/ai/types";
import { sha256Hex } from "@/platform/crypto";

/**
 * Provedor de IA de demonstração: determinístico e sem chamadas externas.
 *
 * 1. Documentos de exemplo (fixtures) são reconhecidos pelo SHA-256 do conteúdo e
 *    recebem uma resposta fixa, como a que um modelo de visão produziria.
 * 2. Qualquer outro TEXTO passa pelo extrator por regras.
 * 3. Imagens e PDFs digitalizados desconhecidos não são lidos — o resultado diz isso
 *    claramente em vez de simular uma leitura.
 */

export interface MockFixtureResolver {
  /** Resposta fixa para um documento de exemplo, pelo hash do conteúdo. */
  extraction(sha256: string): AiExtraction | null;
  /** Transcrição fixa para um áudio de exemplo. */
  transcription(sha256: string): string | null;
}

export const NO_FIXTURES: MockFixtureResolver = { extraction: () => null, transcription: () => null };

export const MOCK_MODEL = "mock-regras-v1";

export class MockAiProvider implements AiProvider {
  readonly name = "mock" as const;
  readonly model = MOCK_MODEL;
  readonly capabilities = { images: true, pdf: true };

  constructor(private readonly fixtures: MockFixtureResolver = NO_FIXTURES) {}

  async extract(document: ExtractionDocument): Promise<AiExtraction> {
    const hashes = [document.sha256, document.text !== undefined ? sha256Hex(document.text.trim()) : undefined];
    for (const hash of hashes) {
      const fixture = hash ? this.fixtures.extraction(hash) : null;
      if (fixture) return parseAiExtraction(structuredClone(fixture));
    }

    if (document.text !== undefined) {
      return parseAiExtraction(extractWithRules(document.text));
    }

    return emptyExtraction({
      documentType: "unreadable",
      legibility: "poor",
      warnings: [
        "Modo demonstração: o provedor de IA mock não lê imagens nem PDFs digitalizados fora dos documentos de exemplo. Configure AI_PROVIDER=anthropic ou AI_PROVIDER=openai para leitura por visão.",
      ],
    });
  }
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = "mock" as const;
  readonly model = "mock-transcricao-v1";

  constructor(private readonly fixtures: MockFixtureResolver = NO_FIXTURES) {}

  async transcribe(audio: { sha256: string }): Promise<{ text: string }> {
    const text = this.fixtures.transcription(audio.sha256);
    if (text === null) {
      throw new AiProviderError("Modo demonstração: transcrição disponível apenas para os áudios de exemplo.", { retryable: false });
    }
    return { text };
  }
}
