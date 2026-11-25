import type { AttachmentKind, Channel, Legibility } from "@/generated/prisma/enums";
import type { AiCustomer, AiExtraction } from "@/modules/ai/schema";
import { AiProviderError, type AiProvider, type ExtractionDocument, type TranscriptionProvider } from "@/modules/ai/types";
import { DocumentReadError, extractPdfText, hasUsableText, pdfPagesToText } from "@/modules/documents/pdf";
import { decodeText, readSpreadsheet, sheetToText } from "@/modules/documents/spreadsheet";
import { extractItemsFromSheet } from "@/modules/documents/tabular";
import { normalizeExtractedItem, type NormalizedItem, type SourceReference } from "@/modules/extraction/normalize-item";
import { truncate } from "@/modules/normalization/text";

/**
 * Extração de itens de uma solicitação: decide, por documento, como ler o conteúdo
 * (leitura direta de tabela, texto + IA, visão ou transcrição) e devolve itens
 * normalizados. Não acessa banco nem storage — recebe os bytes e os provedores.
 */

export interface LoadedAttachment {
  id: string;
  fileName: string;
  kind: AttachmentKind;
  contentType: string;
  extension: string;
  data: Buffer;
  sha256: string;
}

export interface ExtractionSource {
  organizationId: string;
  channel: Channel;
  subject?: string | null;
  text?: string | null;
  attachments: LoadedAttachment[];
}

export interface ExtractedRequest {
  items: NormalizedItem[];
  customerHint: AiCustomer | null;
  legibility: Legibility;
  warnings: string[];
  /** Provedor que leu os documentos; "tabular" quando só houve leitura direta de planilha. */
  provider: string;
  model: string | null;
  /** Texto extraído por anexo (texto de PDF, planilha renderizada, transcrição). */
  attachmentTexts: Map<string, string>;
  /** Mensagens das falhas definitivas do provedor de IA (documentos não lidos). */
  providerFailures: string[];
}

export interface ExtractionDeps {
  ai: AiProvider;
  transcription: TranscriptionProvider | null;
}

const LEGIBILITY_RANK: Record<Legibility, number> = { GOOD: 0, PARTIAL: 1, POOR: 2 };
const AI_LEGIBILITY: Record<AiExtraction["legibility"], Legibility> = { good: "GOOD", partial: "PARTIAL", poor: "POOR" };
const MAX_STORED_TEXT = 200_000;

class ExtractionAccumulator {
  items: NormalizedItem[] = [];
  warnings: string[] = [];
  customer: AiCustomer | null = null;
  legibility: Legibility = "GOOD";
  usedAi = false;
  usedTabular = false;
  /** Documentos que o provedor de IA não conseguiu ler por falha definitiva (ex.: credencial inválida). */
  providerFailures: string[] = [];
  attachmentTexts = new Map<string, string>();

  warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  absorb(extraction: AiExtraction, options: { sourceText?: string; attachmentId: string | null; reference: SourceReference; label: string }): void {
    this.usedAi = true;
    if (extraction.documentType !== "other") {
      const legibility = AI_LEGIBILITY[extraction.legibility];
      if (LEGIBILITY_RANK[legibility] > LEGIBILITY_RANK[this.legibility]) this.legibility = legibility;
    }
    for (const warning of extraction.warnings) this.warn(truncate(warning.trim(), 300));
    if (extraction.customer && !this.customer) this.customer = extraction.customer;

    for (const raw of extraction.items) {
      const item = normalizeExtractedItem(raw, {
        sourceText: options.sourceText,
        sourceAttachmentId: options.attachmentId,
        reference: options.reference,
      });
      if (item) this.items.push(item);
    }
    if (extraction.documentType === "unreadable" && extraction.items.length === 0) {
      this.warn(`Não foi possível ler o conteúdo de "${options.label}".`);
    }
  }
}

async function runAi(deps: ExtractionDeps, document: ExtractionDocument, source: ExtractionSource): Promise<AiExtraction | { skipped: string }> {
  try {
    return await deps.ai.extract(document, { channel: source.channel, organizationId: source.organizationId });
  } catch (error) {
    // Falhas transitórias sobem para que o job seja reexecutado; as definitivas viram aviso ao revisor.
    if (error instanceof AiProviderError && !error.retryable) return { skipped: error.message };
    throw error;
  }
}

async function extractFromAttachment(attachment: LoadedAttachment, source: ExtractionSource, deps: ExtractionDeps, acc: ExtractionAccumulator): Promise<void> {
  const reference: SourceReference = { origin: "attachment", fileName: attachment.fileName };
  const label = `Anexo: ${attachment.fileName}`;

  const viaAi = async (document: ExtractionDocument, sourceText: string | undefined, extraReference: Partial<SourceReference> = {}) => {
    const result = await runAi(deps, document, source);
    if ("skipped" in result) {
      acc.providerFailures.push(result.skipped);
      acc.warn(`${attachment.fileName}: ${result.skipped}`);
      return;
    }
    acc.absorb(result, { sourceText, attachmentId: attachment.id, reference: { ...reference, ...extraReference }, label: attachment.fileName });
  };

  switch (attachment.kind) {
    case "SPREADSHEET": {
      let sheets;
      try {
        sheets = readSpreadsheet(attachment.data, attachment.extension, attachment.fileName);
      } catch (error) {
        if (error instanceof DocumentReadError) return acc.warn(`${attachment.fileName}: ${error.message}`);
        throw error;
      }
      if (sheets.length === 0) return acc.warn(`${attachment.fileName}: planilha vazia.`);
      acc.attachmentTexts.set(attachment.id, sheets.map((sheet) => sheetToText(sheet)).join("\n\n").slice(0, MAX_STORED_TEXT));

      for (const sheet of sheets) {
        const table = extractItemsFromSheet(sheet);
        if (table && table.items.length > 0) {
          // Leitura direta: cada item aponta para sua linha na planilha.
          acc.usedTabular = true;
          for (const row of table.items) {
            const item = normalizeExtractedItem(
              {
                originalDescription: row.description,
                normalizedDescription: null,
                quantity: row.quantity,
                unit: row.unit,
                manufacturer: row.manufacturer,
                manufacturerCode: row.code,
                attributes: [],
                page: null,
                sourceExcerpt: row.excerpt,
                confidence: 0.98,
                notes: row.quantity === null ? "Quantidade não informada no documento." : row.notes,
              },
              { sourceAttachmentId: attachment.id, reference: { ...reference, sheet: row.sheet, row: row.rowNumber } },
            );
            if (item) acc.items.push(item);
          }
          continue;
        }
        const text = sheetToText(sheet);
        await viaAi({ label: `${label} (planilha ${sheet.name})`, text, sha256: sheets.length === 1 ? attachment.sha256 : undefined }, text, { sheet: sheet.name });
      }
      return;
    }

    case "PDF": {
      let pdf;
      try {
        pdf = await extractPdfText(attachment.data);
      } catch (error) {
        if (error instanceof DocumentReadError) return acc.warn(`${attachment.fileName}: ${error.message}`);
        throw error;
      }
      if (hasUsableText(pdf)) {
        const text = pdfPagesToText(pdf);
        acc.attachmentTexts.set(attachment.id, text.slice(0, MAX_STORED_TEXT));
        if (pdf.pageCount > pdf.pages.length) acc.warn(`${attachment.fileName}: apenas as ${pdf.pages.length} primeiras páginas foram lidas.`);
        return viaAi({ label, text, sha256: attachment.sha256 }, text);
      }
      if (!deps.ai.capabilities.pdf) return acc.warn(`${attachment.fileName}: PDF digitalizado e o provedor de IA configurado não lê PDFs por visão.`);
      return viaAi({ label, file: { data: attachment.data, contentType: "application/pdf", fileName: attachment.fileName }, sha256: attachment.sha256 }, undefined);
    }

    case "IMAGE": {
      if (!deps.ai.capabilities.images) return acc.warn(`${attachment.fileName}: o provedor de IA configurado não lê imagens.`);
      const contentType = attachment.contentType === "image/png" ? "image/png" : "image/jpeg";
      return viaAi({ label, file: { data: attachment.data, contentType, fileName: attachment.fileName }, sha256: attachment.sha256 }, undefined);
    }

    case "AUDIO": {
      if (!deps.transcription) {
        return acc.warn(`${attachment.fileName}: áudio não transcrito (TRANSCRIPTION_PROVIDER não configurado). Ouça o original.`);
      }
      let transcript: string;
      try {
        transcript = (await deps.transcription.transcribe(attachment)).text;
      } catch (error) {
        if (error instanceof AiProviderError && !error.retryable) return acc.warn(`${attachment.fileName}: ${error.message}`);
        throw error;
      }
      if (!transcript.trim()) return acc.warn(`${attachment.fileName}: a transcrição do áudio ficou vazia.`);
      acc.attachmentTexts.set(attachment.id, transcript.slice(0, MAX_STORED_TEXT));
      return viaAi({ label: `${label} (transcrição de áudio)`, text: transcript }, transcript);
    }

    case "TEXT": {
      const text = decodeText(attachment.data);
      acc.attachmentTexts.set(attachment.id, text.slice(0, MAX_STORED_TEXT));
      return viaAi({ label, text, sha256: attachment.sha256 }, text);
    }

    default:
      acc.warn(`${attachment.fileName}: tipo de arquivo não processado.`);
  }
}

export async function extractRequest(source: ExtractionSource, deps: ExtractionDeps): Promise<ExtractedRequest> {
  const acc = new ExtractionAccumulator();

  const body = [source.subject ? `Assunto: ${source.subject.trim()}` : "", (source.text ?? "").trim()].filter(Boolean).join("\n\n");
  if ((source.text ?? "").trim().length >= 3) {
    const label = source.channel === "EMAIL" ? "Corpo do e-mail" : source.channel === "WHATSAPP" ? "Mensagem de WhatsApp" : "Observação do envio";
    const result = await runAi(deps, { label, text: body }, source);
    if ("skipped" in result) {
      acc.providerFailures.push(result.skipped);
      acc.warn(`${label}: ${result.skipped}`);
    } else acc.absorb(result, { sourceText: body, attachmentId: null, reference: { origin: "message" }, label });
  }

  for (const attachment of source.attachments) {
    await extractFromAttachment(attachment, source, deps, acc);
  }

  const withoutQuantity = acc.items.filter((item) => item.quantity === null).length;
  if (withoutQuantity > 0) {
    acc.warn(`${withoutQuantity} ${withoutQuantity === 1 ? "item sem quantidade informada" : "itens sem quantidade informada"} — confirme com o cliente.`);
  }

  return {
    items: acc.items,
    customerHint: acc.customer,
    legibility: acc.legibility,
    warnings: acc.warnings.slice(0, 30),
    provider: acc.usedAi ? deps.ai.name : acc.usedTabular ? "tabular" : deps.ai.name,
    model: acc.usedAi ? deps.ai.model : null,
    attachmentTexts: acc.attachmentTexts,
    providerFailures: acc.providerFailures,
  };
}
