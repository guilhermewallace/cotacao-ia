import { demoFixtureResolver } from "@/demo/mock-fixtures";
import { AnthropicProvider } from "@/modules/ai/providers/anthropic";
import { MockAiProvider, MockTranscriptionProvider } from "@/modules/ai/providers/mock";
import { OpenAIProvider, OpenAITranscriptionProvider } from "@/modules/ai/providers/openai";
import type { AiProvider, TranscriptionProvider } from "@/modules/ai/types";
import { env } from "@/platform/env";

export type { AiProvider, ExtractionContext, ExtractionDocument, TranscriptionProvider } from "@/modules/ai/types";
export { AiProviderError } from "@/modules/ai/types";

let aiProvider: AiProvider | undefined;
let transcriptionProvider: TranscriptionProvider | null | undefined;

/** Provedor de extração configurado em AI_PROVIDER (anthropic | openai | mock). */
export function getAiProvider(): AiProvider {
  if (aiProvider) return aiProvider;
  const config = env();
  switch (config.AI_PROVIDER) {
    case "anthropic":
      aiProvider = new AnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL });
      break;
    case "openai":
      aiProvider = new OpenAIProvider({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL });
      break;
    case "mock":
      aiProvider = new MockAiProvider(demoFixtureResolver());
      break;
  }
  return aiProvider;
}

/** Provedor de transcrição de áudio, ou `null` quando TRANSCRIPTION_PROVIDER=none. */
export function getTranscriptionProvider(): TranscriptionProvider | null {
  if (transcriptionProvider !== undefined) return transcriptionProvider;
  const config = env();
  switch (config.TRANSCRIPTION_PROVIDER) {
    case "openai":
      transcriptionProvider = new OpenAITranscriptionProvider({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_TRANSCRIPTION_MODEL });
      break;
    case "mock":
      transcriptionProvider = new MockTranscriptionProvider(demoFixtureResolver());
      break;
    case "none":
      transcriptionProvider = null;
      break;
  }
  return transcriptionProvider;
}

/** Apenas para testes: substitui os provedores. */
export function setAiProvidersForTests(providers: { ai?: AiProvider; transcription?: TranscriptionProvider | null }): void {
  aiProvider = providers.ai;
  transcriptionProvider = providers.transcription;
}

export interface AiStatus {
  provider: AiProvider["name"];
  model: string;
  isMock: boolean;
  transcription: "none" | "openai" | "mock";
}

export function getAiStatus(): AiStatus {
  const config = env();
  const model =
    config.AI_PROVIDER === "anthropic" ? config.ANTHROPIC_MODEL : config.AI_PROVIDER === "openai" ? config.OPENAI_MODEL : "mock-regras-v1";
  return { provider: config.AI_PROVIDER, model, isMock: config.AI_PROVIDER === "mock", transcription: config.TRANSCRIPTION_PROVIDER };
}
