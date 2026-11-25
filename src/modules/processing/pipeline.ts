import path from "node:path";
import { getAiProvider, getTranscriptionProvider } from "@/modules/ai";
import { recordAudit } from "@/modules/audit/audit";
import { digitsOnly, normalizeEmail } from "@/modules/customers/customers";
import { extractRequest, type ExtractionDeps, type LoadedAttachment } from "@/modules/extraction/extract";
import { downloadPendingAttachments } from "@/modules/inbox/attachments";
import { matchRequestItems } from "@/modules/matching/engine";
import type { CandidateRetriever } from "@/modules/matching/types";
import { truncate } from "@/modules/normalization/text";
import { storage } from "@/modules/storage";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb, type TenantTx } from "@/modules/tenancy/tenant-db";
import { sha256Hex } from "@/platform/crypto";
import { logger } from "@/platform/logger";

/**
 * Pipeline compartilhado de processamento — o mesmo para todos os canais:
 *
 *   baixar mídias pendentes → ler documentos → extrair itens (IA, validada por schema)
 *   → normalizar → gravar itens → Matching Engine → "Aguardando revisão"
 *
 * É idempotente: reexecutar substitui os itens ainda não revisados e nunca toca em
 * solicitações que uma pessoa já começou a revisar.
 */

/** Erro que não se resolve tentando de novo (ex.: solicitação já revisada). */
export class NonRetryableProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableProcessingError";
  }
}

export interface PipelineResult {
  requestId: string;
  itemsCount: number;
  suggested: number;
  ambiguous: number;
  noMatch: number;
  warnings: number;
}

export interface PipelineDeps extends Partial<ExtractionDeps> {
  retriever?: CandidateRetriever;
}

async function resolveCustomerFromHint(tx: TenantTx, hint: { taxId: string | null; email: string | null } | null): Promise<string | null> {
  if (!hint) return null;
  const taxId = digitsOnly(hint.taxId);
  if (taxId && (taxId.length === 11 || taxId.length === 14)) {
    const byTaxId = await tx.customer.findMany({ where: { taxId, isActive: true }, select: { id: true }, take: 2 });
    if (byTaxId.length === 1 && byTaxId[0]) return byTaxId[0].id;
  }
  const email = normalizeEmail(hint.email);
  if (email) {
    const byEmail = await tx.customer.findMany({ where: { email, isActive: true }, select: { id: true }, take: 2 });
    if (byEmail.length === 1 && byEmail[0]) return byEmail[0].id;
  }
  return null;
}

export async function processInboundMessage(ctx: TenantContext, messageId: string, deps: PipelineDeps = {}): Promise<PipelineResult> {
  const db = tenantDb(ctx.organizationId);
  const log = logger({ organizationId: ctx.organizationId, messageId });

  const message = await db.inboundMessage.findUnique({
    where: { id: messageId },
    include: { quotationRequest: { include: { _count: { select: { quotations: true } } } } },
  });
  if (!message) throw new NonRetryableProcessingError("Mensagem não encontrada.");
  const request = message.quotationRequest;
  if (!request) throw new NonRetryableProcessingError("Mensagem sem solicitação associada.");

  // Nunca sobrescreve trabalho humano.
  const reviewedItems = await db.requestedItem.count({ where: { quotationRequestId: request.id, status: { not: "PENDING" } } });
  if (reviewedItems > 0 || request._count.quotations > 0 || request.status === "QUOTED" || request.status === "DISCARDED") {
    throw new NonRetryableProcessingError("A solicitação já foi revisada e não pode ser reprocessada.");
  }

  const startedAt = new Date();
  await db.$transaction([
    db.inboundMessage.update({ where: { id: message.id }, data: { status: "PROCESSING", error: null } }),
    db.quotationRequest.update({ where: { id: request.id }, data: { status: "PROCESSING", processingStartedAt: startedAt } }),
  ]);

  // 1. Mídias recebidas por referência (WhatsApp).
  await downloadPendingAttachments(ctx, message.id);

  // 2. Bytes dos anexos armazenados.
  const stored = await db.attachment.findMany({
    where: { inboundMessageId: message.id, status: "STORED", purgedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const attachments: LoadedAttachment[] = [];
  for (const attachment of stored) {
    if (!attachment.storageKey) continue;
    const data = await storage().get(attachment.storageKey);
    attachments.push({
      id: attachment.id,
      fileName: attachment.fileName,
      kind: attachment.kind,
      contentType: attachment.contentType,
      extension: path.extname(attachment.storageKey).slice(1).toLowerCase(),
      data,
      sha256: attachment.sha256 ?? sha256Hex(data),
    });
  }
  const problemAttachments = await db.attachment.findMany({
    where: { inboundMessageId: message.id, status: { in: ["FAILED", "REJECTED"] } },
    select: { fileName: true, error: true },
  });

  // 3. Extração + normalização (sem banco).
  const extraction = await extractRequest(
    { organizationId: ctx.organizationId, channel: message.channel, subject: message.subject, text: message.textContent, attachments },
    { ai: deps.ai ?? getAiProvider(), transcription: deps.transcription === undefined ? getTranscriptionProvider() : deps.transcription },
  );
  // Nada foi extraído E o provedor de IA falhou de forma definitiva: é uma falha de processamento
  // (ex.: chave de API inválida), não um "documento sem itens". O usuário poderá reprocessar.
  if (extraction.items.length === 0 && extraction.providerFailures.length > 0) {
    throw new NonRetryableProcessingError(extraction.providerFailures[0] ?? "Falha no provedor de IA.");
  }

  const warnings = [
    ...problemAttachments.map((attachment) => `${attachment.fileName}: ${attachment.error ?? "anexo não processado"}`),
    ...extraction.warnings,
  ].map((warning) => truncate(warning, 300));

  // 4. Persistência dos itens + matching + mudança de status, de forma atômica.
  const summary = await db.$transaction(
    async (tx) => {
      await tx.requestedItem.deleteMany({ where: { quotationRequestId: request.id } });
      if (extraction.items.length > 0) {
        await tx.requestedItem.createMany({
          data: extraction.items.map((item, index) => ({
            organizationId: ctx.organizationId,
            quotationRequestId: request.id,
            lineNumber: index + 1,
            originalDescription: item.originalDescription,
            normalizedDescription: item.normalizedDescription,
            quantity: item.quantity,
            extractedQuantity: item.quantity,
            unit: item.unit,
            manufacturer: item.manufacturer,
            manufacturerCode: item.manufacturerCode,
            attributes: item.attributes as object,
            sourceAttachmentId: item.sourceAttachmentId,
            sourceReference: item.sourceReference as object,
            confidence: item.confidence,
            notes: item.notes,
          })),
        });
      }
      for (const [attachmentId, text] of extraction.attachmentTexts) {
        await tx.attachment.updateMany({ where: { id: attachmentId }, data: { extractedText: text.replace(/\u0000/g, "") } });
      }

      const matching = await matchRequestItems(tx, ctx.organizationId, request.id, deps.retriever);

      // Mensagens de texto sem assunto ganham um título descritivo a partir dos itens.
      const firstItem = extraction.items[0];
      const others = extraction.items.length - 1;
      const title =
        !message.subject && attachments.length === 0 && firstItem
          ? truncate(`${firstItem.originalDescription}${others > 0 ? ` e mais ${others} ${others === 1 ? "item" : "itens"}` : ""}`, 160)
          : undefined;
      const customerId = request.customerId ?? (await resolveCustomerFromHint(tx, extraction.customerHint));
      const processedAt = new Date();

      await tx.quotationRequest.update({
        where: { id: request.id },
        data: {
          status: "AWAITING_REVIEW",
          ...(title ? { title } : {}),
          customerId,
          customerHint: extraction.customerHint ? (extraction.customerHint as object) : undefined,
          extractionProvider: extraction.provider,
          extractionModel: extraction.model,
          legibility: extraction.legibility,
          warnings,
          itemsCount: matching.itemsCount,
          identifiedCount: matching.suggested,
          processedAt,
        },
      });
      await tx.inboundMessage.update({ where: { id: message.id }, data: { status: "PROCESSED", error: null, customerId: message.customerId ?? customerId } });
      await recordAudit(
        ctx,
        {
          action: "request.processed",
          entityType: "QuotationRequest",
          entityId: request.id,
          metadata: {
            provider: extraction.provider,
            items: matching.itemsCount,
            suggested: matching.suggested,
            ambiguous: matching.ambiguous,
            noMatch: matching.noMatch,
            durationMs: processedAt.getTime() - startedAt.getTime(),
          },
        },
        tx,
      );
      return matching;
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  log.info({ requestId: request.id, ...summary }, "solicitação processada");
  return { requestId: request.id, ...summary, warnings: warnings.length };
}

/** Marca mensagem e solicitação como falhas definitivas (visíveis na caixa de entrada, com opção de reprocessar). */
export async function markProcessingFailed(ctx: TenantContext, messageId: string, error: string): Promise<void> {
  const db = tenantDb(ctx.organizationId);
  await db.$transaction([
    db.inboundMessage.updateMany({ where: { id: messageId }, data: { status: "FAILED", error: truncate(error, 500) } }),
    db.quotationRequest.updateMany({ where: { inboundMessageId: messageId, status: { in: ["RECEIVED", "PROCESSING"] } }, data: { status: "FAILED" } }),
  ]);
}
