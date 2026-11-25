import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { buildUserInstruction, clampDocumentText, EXTRACTION_SYSTEM_PROMPT } from "@/modules/ai/prompt";
import { aiExtractionSchema, parseAiExtraction, type AiExtraction } from "@/modules/ai/schema";
import {
  AiProviderError,
  type AiProvider,
  type ExtractionContext,
  type ExtractionDocument,
  type TranscriptionProvider,
} from "@/modules/ai/types";

type InputContent = OpenAI.Responses.ResponseInputContent;

/** Parte do cliente da OpenAI usada pelos adaptadores — permite injetar um dublê nos testes. */
export interface OpenAIResponsesClient {
  responses: {
    parse(params: OpenAI.Responses.ResponseCreateParamsNonStreaming): Promise<{
      output_parsed: unknown;
      status?: string | null;
      incomplete_details?: { reason?: string | null } | null;
    }>;
  };
}

export interface OpenAITranscriptionClient {
  audio: {
    transcriptions: {
      create(params: { file: File; model: string; language?: string }): Promise<{ text: string }>;
    };
  };
}

function classifyError(error: unknown): { retryable: boolean; status?: number } {
  const status = (error as { status?: number }).status;
  return { status, retryable: status === undefined || status === 408 || status === 409 || status === 429 || status >= 500 };
}

/** Adaptador da Responses API da OpenAI com saída estruturada (JSON Schema estrito). */
export class OpenAIProvider implements AiProvider {
  readonly name = "openai" as const;
  readonly model: string;
  readonly capabilities = { images: true, pdf: true };
  private readonly client: OpenAIResponsesClient;

  constructor(options: { apiKey?: string; model: string; client?: OpenAIResponsesClient }) {
    this.model = options.model;
    this.client = options.client ?? (new OpenAI({ apiKey: options.apiKey, maxRetries: 2, timeout: 120_000 }) as unknown as OpenAIResponsesClient);
  }

  private buildContent(document: ExtractionDocument, context: ExtractionContext): InputContent[] {
    if (document.text !== undefined) {
      const { text } = clampDocumentText(document.text);
      return [{ type: "input_text", text: buildUserInstruction({ ...document, text }, context) }];
    }
    if (!document.file) throw new AiProviderError("Documento sem conteúdo.", { retryable: false });

    const dataUrl = `data:${document.file.contentType};base64,${document.file.data.toString("base64")}`;
    const fileContent: InputContent =
      document.file.contentType === "application/pdf"
        ? { type: "input_file", filename: document.file.fileName, file_data: dataUrl }
        : { type: "input_image", image_url: dataUrl, detail: "high" };
    return [fileContent, { type: "input_text", text: buildUserInstruction(document, context) }];
  }

  async extract(document: ExtractionDocument, context: ExtractionContext): Promise<AiExtraction> {
    let response: Awaited<ReturnType<OpenAIResponsesClient["responses"]["parse"]>>;
    try {
      response = await this.client.responses.parse({
        model: this.model,
        instructions: EXTRACTION_SYSTEM_PROMPT,
        input: [{ role: "user", content: this.buildContent(document, context) }],
        text: { format: zodTextFormat(aiExtractionSchema, "extracao_de_cotacao") },
        store: false,
      });
    } catch (error) {
      const { retryable, status } = classifyError(error);
      throw new AiProviderError(`Falha na chamada à OpenAI${status ? ` (HTTP ${status})` : ""}.`, { retryable, cause: error });
    }

    if (response.status === "incomplete") {
      throw new AiProviderError(`A resposta do modelo ficou incompleta (${response.incomplete_details?.reason ?? "motivo desconhecido"}).`, {
        retryable: false,
      });
    }
    if (response.output_parsed === null || response.output_parsed === undefined) {
      throw new AiProviderError("O modelo não retornou uma extração válida.", { retryable: false });
    }
    try {
      return parseAiExtraction(response.output_parsed);
    } catch (error) {
      throw new AiProviderError("A resposta do modelo não segue o schema de extração.", { retryable: true, cause: error });
    }
  }
}

/** Transcrição de áudio (ex.: mensagens de voz do WhatsApp) pela API de áudio da OpenAI. */
export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly name = "openai" as const;
  readonly model: string;
  private readonly client: OpenAITranscriptionClient;

  constructor(options: { apiKey?: string; model: string; client?: OpenAITranscriptionClient }) {
    this.model = options.model;
    this.client = options.client ?? (new OpenAI({ apiKey: options.apiKey, maxRetries: 2, timeout: 120_000 }) as unknown as OpenAITranscriptionClient);
  }

  async transcribe(audio: { data: Buffer; fileName: string; contentType: string }): Promise<{ text: string }> {
    try {
      const file = await toFile(audio.data, audio.fileName, { type: audio.contentType });
      const result = await this.client.audio.transcriptions.create({ file, model: this.model, language: "pt" });
      return { text: result.text.trim() };
    } catch (error) {
      const { retryable, status } = classifyError(error);
      throw new AiProviderError(`Falha na transcrição de áudio${status ? ` (HTTP ${status})` : ""}.`, { retryable, cause: error });
    }
  }
}
