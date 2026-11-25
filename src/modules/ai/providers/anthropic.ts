import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildUserInstruction, clampDocumentText, EXTRACTION_SYSTEM_PROMPT } from "@/modules/ai/prompt";
import { aiExtractionSchema, parseAiExtraction, type AiExtraction } from "@/modules/ai/schema";
import { AiProviderError, type AiProvider, type ExtractionContext, type ExtractionDocument } from "@/modules/ai/types";

type ContentBlock = Anthropic.Messages.ContentBlockParam;

/** Parte do cliente da Anthropic usada pelo adaptador — permite injetar um dublê nos testes. */
export interface AnthropicMessagesClient {
  messages: {
    parse(params: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<{
      parsed_output: unknown;
      stop_reason: string | null;
    }>;
  };
}

export interface AnthropicProviderOptions {
  apiKey?: string;
  model: string;
  client?: AnthropicMessagesClient;
  maxTokens?: number;
}

/**
 * Adaptador da API de Mensagens da Anthropic com saída estruturada (JSON Schema).
 * PDFs e imagens são enviados como blocos de documento/imagem (leitura por visão).
 */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  readonly capabilities = { images: true, pdf: true };
  private readonly client: AnthropicMessagesClient;
  private readonly maxTokens: number;

  constructor(options: AnthropicProviderOptions) {
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 16_000;
    this.client =
      options.client ?? (new Anthropic({ apiKey: options.apiKey, maxRetries: 2, timeout: 120_000 }) as unknown as AnthropicMessagesClient);
  }

  private buildContent(document: ExtractionDocument, context: ExtractionContext): ContentBlock[] {
    if (document.text !== undefined) {
      const { text } = clampDocumentText(document.text);
      return [{ type: "text", text: buildUserInstruction({ ...document, text }, context) }];
    }
    if (!document.file) throw new AiProviderError("Documento sem conteúdo.", { retryable: false });

    const data = document.file.data.toString("base64");
    const fileBlock: ContentBlock =
      document.file.contentType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: document.file.contentType, data } };
    return [fileBlock, { type: "text", text: buildUserInstruction(document, context) }];
  }

  async extract(document: ExtractionDocument, context: ExtractionContext): Promise<AiExtraction> {
    let response: Awaited<ReturnType<AnthropicMessagesClient["messages"]["parse"]>>;
    try {
      response = await this.client.messages.parse({
        model: this.model,
        max_tokens: this.maxTokens,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: this.buildContent(document, context) }],
        output_config: { format: zodOutputFormat(aiExtractionSchema) },
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      const retryable = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
      throw new AiProviderError(`Falha na chamada à Anthropic${status ? ` (HTTP ${status})` : ""}.`, { retryable, cause: error });
    }

    if (response.stop_reason === "max_tokens") {
      throw new AiProviderError("A resposta do modelo foi truncada (documento muito extenso).", { retryable: false });
    }
    if (response.stop_reason === "refusal" || response.parsed_output === null || response.parsed_output === undefined) {
      throw new AiProviderError("O modelo não retornou uma extração válida.", { retryable: false });
    }
    try {
      return parseAiExtraction(response.parsed_output);
    } catch (error) {
      throw new AiProviderError("A resposta do modelo não segue o schema de extração.", { retryable: true, cause: error });
    }
  }
}
