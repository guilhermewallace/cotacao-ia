import { randomUUID } from "node:crypto";
import type { Channel } from "@/generated/prisma/enums";
import { recordAudit } from "@/modules/audit/audit";
import { findCustomerBySender } from "@/modules/customers/customers";
import { inspectFile, sanitizeFileName } from "@/modules/documents/inspect";
import { truncate } from "@/modules/normalization/text";
import { createInboundJob } from "@/modules/processing/jobs";
import { enqueueProcessingJob } from "@/modules/processing/queue";
import { attachmentStorageKey, storage } from "@/modules/storage";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { sha256Hex } from "@/platform/crypto";
import { maxUploadBytes } from "@/platform/env";
import { isUniqueViolation, ValidationError } from "@/platform/errors";
import { logger, serializeError } from "@/platform/logger";

/**
 * Ingestão unificada: TODOS os canais (upload, e-mail, WhatsApp e os que vierem)
 * convertem sua mensagem para `IncomingMessage` e chamam `ingestInboundMessage`.
 *
 * Esta etapa é rápida e idempotente: valida e guarda os anexos, grava a mensagem,
 * a solicitação e o job em uma única transação e enfileira o processamento.
 * Nenhuma leitura de documento ou chamada de IA acontece aqui.
 */

export type IncomingAttachment =
  | { source: "inline"; fileName: string; data: Buffer }
  | { source: "remote"; fileName: string | null; externalMediaId: string; declaredType: string | null };

export interface IncomingMessage {
  channel: Channel;
  /** Identificador da mensagem no canal de origem (wamid, Message-ID, chave de upload). */
  externalId: string;
  integrationId?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  subject?: string | null;
  text?: string | null;
  receivedAt: Date;
  metadata?: Record<string, unknown>;
  uploadedById?: string | null;
  customerId?: string | null;
  attachments: IncomingAttachment[];
}

export interface IngestResult {
  status: "created" | "duplicate";
  messageId: string;
  requestId: string | null;
  rejectedAttachments: Array<{ fileName: string; reason: string }>;
}

const MAX_TEXT_LENGTH = 100_000;
const MAX_ATTACHMENTS = 20;

interface PreparedAttachment {
  id: string;
  fileName: string;
  contentType: string;
  kind: "PDF" | "SPREADSHEET" | "IMAGE" | "AUDIO" | "TEXT" | "OTHER";
  status: "STORED" | "PENDING_DOWNLOAD" | "REJECTED";
  sizeBytes: number | null;
  storageKey: string | null;
  sha256: string | null;
  externalMediaId: string | null;
  error: string | null;
}

function kindFromDeclaredType(declaredType: string | null): PreparedAttachment["kind"] {
  const type = (declaredType ?? "").toLowerCase();
  if (type === "application/pdf") return "PDF";
  if (type.startsWith("image/")) return "IMAGE";
  if (type.startsWith("audio/")) return "AUDIO";
  if (type.includes("spreadsheet") || type.includes("excel") || type === "text/csv") return "SPREADSHEET";
  if (type.startsWith("text/")) return "TEXT";
  return "OTHER";
}

export async function ingestInboundMessage(ctx: TenantContext, incoming: IncomingMessage): Promise<IngestResult> {
  const log = logger({ organizationId: ctx.organizationId, channel: incoming.channel });
  const db = tenantDb(ctx.organizationId);

  const externalId = incoming.externalId.trim();
  if (!externalId || externalId.length > 300) throw new ValidationError("Identificador externo da mensagem inválido.");
  if (incoming.attachments.length > MAX_ATTACHMENTS) {
    throw new ValidationError(`Uma mensagem pode ter no máximo ${MAX_ATTACHMENTS} anexos.`);
  }

  // 1. Idempotência: a mesma mensagem externa nunca é registrada nem processada duas vezes.
  const existing = await db.inboundMessage.findFirst({
    where: { channel: incoming.channel, externalId },
    select: { id: true, quotationRequest: { select: { id: true } } },
  });
  if (existing) {
    return { status: "duplicate", messageId: existing.id, requestId: existing.quotationRequest?.id ?? null, rejectedAttachments: [] };
  }

  // 2. Validação e armazenamento dos anexos recebidos junto com a mensagem.
  const messageId = randomUUID();
  const allowMessageFormats = incoming.channel !== "UPLOAD";
  const prepared: PreparedAttachment[] = [];
  const storedKeys: string[] = [];
  const rejected: IngestResult["rejectedAttachments"] = [];

  try {
    for (const attachment of incoming.attachments) {
      const id = randomUUID();
      if (attachment.source === "remote") {
        prepared.push({
          id,
          fileName: sanitizeFileName(attachment.fileName, "anexo"),
          contentType: attachment.declaredType ?? "application/octet-stream",
          kind: kindFromDeclaredType(attachment.declaredType),
          status: "PENDING_DOWNLOAD",
          sizeBytes: null,
          storageKey: null,
          sha256: null,
          externalMediaId: attachment.externalMediaId,
          error: null,
        });
        continue;
      }

      const fileName = sanitizeFileName(attachment.fileName);
      const inspected = await inspectFile(attachment.data, fileName, {
        maxBytes: maxUploadBytes(),
        allowAudio: allowMessageFormats,
        allowPlainText: allowMessageFormats,
      });
      if (!inspected.ok) {
        rejected.push({ fileName, reason: inspected.reason });
        prepared.push({
          id,
          fileName,
          contentType: "application/octet-stream",
          kind: "OTHER",
          status: "REJECTED",
          sizeBytes: attachment.data.length,
          storageKey: null,
          sha256: null,
          externalMediaId: null,
          error: inspected.reason,
        });
        continue;
      }

      const storageKey = attachmentStorageKey({ organizationId: ctx.organizationId, messageId, attachmentId: id, extension: inspected.extension });
      await storage().put(storageKey, attachment.data, { contentType: inspected.contentType });
      storedKeys.push(storageKey);
      prepared.push({
        id,
        fileName,
        contentType: inspected.contentType,
        kind: inspected.kind,
        status: "STORED",
        sizeBytes: attachment.data.length,
        storageKey,
        sha256: sha256Hex(attachment.data),
        externalMediaId: null,
        error: null,
      });
    }

    // 3. Mensagem + anexos + solicitação + job em uma única transação.
    const text = incoming.text ? truncate(incoming.text.replace(/\u0000/g, ""), MAX_TEXT_LENGTH) : null;
    const created = await db.$transaction(async (tx) => {
      const customerId = incoming.customerId ?? (await findCustomerBySender(tx, incoming.senderAddress));

      await tx.inboundMessage.create({
        data: {
          id: messageId,
          organizationId: ctx.organizationId,
          channel: incoming.channel,
          externalId,
          integrationId: incoming.integrationId ?? null,
          customerId,
          uploadedById: incoming.uploadedById ?? null,
          senderName: incoming.senderName ? truncate(incoming.senderName.trim(), 160) : null,
          senderAddress: incoming.senderAddress ? truncate(incoming.senderAddress.trim(), 200) : null,
          subject: incoming.subject ? truncate(incoming.subject.trim(), 300) : null,
          textContent: text,
          metadata: (incoming.metadata ?? {}) as object,
          receivedAt: incoming.receivedAt,
        },
      });
      if (prepared.length > 0) {
        await tx.attachment.createMany({
          data: prepared.map((attachment) => ({ ...attachment, organizationId: ctx.organizationId, inboundMessageId: messageId })),
        });
      }
      const request = await tx.quotationRequest.create({
        data: {
          organizationId: ctx.organizationId,
          inboundMessageId: messageId,
          customerId,
          status: "RECEIVED",
          title: incoming.subject ? truncate(incoming.subject.trim(), 160) : (prepared[0]?.fileName ?? (text ? truncate(text.replace(/\s+/g, " "), 80) : null)),
          receivedAt: incoming.receivedAt,
        },
      });
      const job = await createInboundJob(tx, ctx.organizationId, messageId);
      await recordAudit(
        ctx,
        {
          action: "inbound.received",
          entityType: "InboundMessage",
          entityId: messageId,
          metadata: { channel: incoming.channel, attachments: prepared.length, rejected: rejected.length },
        },
        tx,
      );
      return { requestId: request.id, jobId: job.id };
    });

    // 4. Enfileira. Se o enfileiramento falhar, a rotina de recuperação reencontra o job (status QUEUED).
    try {
      await enqueueProcessingJob({ processingJobId: created.jobId, organizationId: ctx.organizationId });
    } catch (error) {
      log.error({ err: serializeError(error), jobId: created.jobId }, "falha ao enfileirar; o job será recuperado pela rotina de reconciliação");
    }

    log.info({ messageId, requestId: created.requestId, attachments: prepared.length }, "mensagem recebida");
    return { status: "created", messageId, requestId: created.requestId, rejectedAttachments: rejected };
  } catch (error) {
    // Nada foi gravado: remove os arquivos já enviados ao storage.
    await Promise.allSettled(storedKeys.map((key) => storage().delete(key)));

    if (isUniqueViolation(error)) {
      // Corrida entre duas entregas da mesma mensagem: a outra venceu.
      const winner = await db.inboundMessage.findFirst({
        where: { channel: incoming.channel, externalId },
        select: { id: true, quotationRequest: { select: { id: true } } },
      });
      if (winner) {
        return { status: "duplicate", messageId: winner.id, requestId: winner.quotationRequest?.id ?? null, rejectedAttachments: [] };
      }
    }
    throw error;
  }
}
