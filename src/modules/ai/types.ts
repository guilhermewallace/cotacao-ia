import type { Channel } from "@/generated/prisma/enums";
import type { AiExtraction } from "@/modules/ai/schema";

/**
 * Camada de abstração de provedores de IA.
 * O restante do sistema depende apenas destas interfaces; trocar de provedor
 * (Anthropic, OpenAI, mock ou um novo) não altera o pipeline.
 */

export type VisionContentType = "application/pdf" | "image/png" | "image/jpeg";

export interface ExtractionDocument {
  /** Rótulo do documento, ex.: "Corpo do e-mail" ou "Anexo: pedido.pdf". */
  label: string;
  /** Texto já extraído (corpo da mensagem, PDF com texto, planilha, transcrição). */
  text?: string;
  /** Arquivo para leitura por visão (imagem ou PDF digitalizado). */
  file?: { data: Buffer; contentType: VisionContentType; fileName: string };
  /** SHA-256 do conteúdo original — usado pelo provedor mock para respostas determinísticas. */
  sha256?: string;
}

export interface ExtractionContext {
  channel: Channel;
  organizationId: string;
}

export interface AiProvider {
  readonly name: "anthropic" | "openai" | "mock";
  readonly model: string;
  readonly capabilities: { images: boolean; pdf: boolean };
  /** Extrai itens de UM documento. A resposta já vem validada pelo schema. */
  extract(document: ExtractionDocument, context: ExtractionContext): Promise<AiExtraction>;
}

export interface TranscriptionProvider {
  readonly name: "openai" | "mock";
  readonly model: string;
  transcribe(audio: { data: Buffer; fileName: string; contentType: string; sha256: string }): Promise<{ text: string }>;
}

/** Erro de provedor que vale a pena tentar novamente (rede, limite de taxa, 5xx). */
export class AiProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "AiProviderError";
    this.retryable = options.retryable;
  }
}
