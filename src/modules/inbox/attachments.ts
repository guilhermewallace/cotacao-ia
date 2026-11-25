import { inspectFile } from "@/modules/documents/inspect";
import { getWhatsAppMediaClient, MediaDownloadError } from "@/modules/inbox/channels/whatsapp/media";
import { getWhatsAppAccessToken } from "@/modules/integrations/integrations";
import { assertCan } from "@/modules/identity/permissions";
import { attachmentStorageKey, canDisplayInline, storage } from "@/modules/storage";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { sha256Hex } from "@/platform/crypto";
import { maxUploadBytes } from "@/platform/env";
import { NotFoundError } from "@/platform/errors";
import { parseId } from "@/platform/ids";
import { recordAuditSafely } from "@/modules/audit/audit";

/**
 * Baixa e armazena os anexos que chegaram apenas como referência (mídias do WhatsApp).
 * Executado pelo worker. Erros transitórios são relançados para nova tentativa;
 * erros definitivos (mídia expirada, formato recusado) ficam registrados no anexo.
 */
export async function downloadPendingAttachments(ctx: TenantContext, messageId: string): Promise<void> {
  const db = tenantDb(ctx.organizationId);
  const message = await db.inboundMessage.findUnique({
    where: { id: messageId },
    select: { id: true, channel: true, integrationId: true, attachments: { where: { status: "PENDING_DOWNLOAD" } } },
  });
  if (!message || message.attachments.length === 0) return;

  const fail = (attachmentId: string, reason: string) =>
    db.attachment.update({ where: { id: attachmentId }, data: { status: "FAILED", error: reason.slice(0, 500) } });

  if (message.channel !== "WHATSAPP" || !message.integrationId) {
    for (const attachment of message.attachments) await fail(attachment.id, "Canal sem suporte a download de mídia.");
    return;
  }
  const accessToken = await getWhatsAppAccessToken(db, ctx.organizationId, message.integrationId);
  if (!accessToken) {
    for (const attachment of message.attachments) await fail(attachment.id, "Integração com WhatsApp sem token de acesso válido.");
    return;
  }

  for (const attachment of message.attachments) {
    if (!attachment.externalMediaId) {
      await fail(attachment.id, "Anexo sem identificador de mídia.");
      continue;
    }
    let media;
    try {
      media = await getWhatsAppMediaClient().download(attachment.externalMediaId, accessToken);
    } catch (error) {
      if (error instanceof MediaDownloadError && !error.retryable) {
        await fail(attachment.id, error.message);
        continue;
      }
      throw error;
    }

    const inspected = await inspectFile(media.data, attachment.fileName, { maxBytes: maxUploadBytes(), allowAudio: true, allowPlainText: true });
    if (!inspected.ok) {
      await db.attachment.update({
        where: { id: attachment.id },
        data: { status: "REJECTED", error: inspected.reason, sizeBytes: media.data.length },
      });
      continue;
    }
    const storageKey = attachmentStorageKey({
      organizationId: ctx.organizationId,
      messageId: message.id,
      attachmentId: attachment.id,
      extension: inspected.extension,
    });
    await storage().put(storageKey, media.data, { contentType: inspected.contentType });
    await db.attachment.update({
      where: { id: attachment.id },
      data: {
        status: "STORED",
        storageKey,
        contentType: inspected.contentType,
        kind: inspected.kind,
        sizeBytes: media.data.length,
        sha256: sha256Hex(media.data),
        error: null,
      },
    });
  }
}

export interface AttachmentAccess {
  url: string;
  fileName: string;
  contentType: string;
  inline: boolean;
}

/**
 * URL temporária de um anexo. A autorização (organização + permissão) é verificada
 * aqui, a cada emissão; a URL em si expira em poucos minutos.
 */
export async function getAttachmentAccess(ctx: TenantContext, attachmentId: string, options: { download?: boolean } = {}): Promise<AttachmentAccess> {
  assertCan(ctx, "inbox:read");
  const id = parseId(attachmentId, "Anexo");
  const attachment = await tenantDb(ctx.organizationId).attachment.findUnique({
    where: { id },
    select: { id: true, fileName: true, contentType: true, storageKey: true, status: true },
  });
  if (!attachment || attachment.status !== "STORED" || !attachment.storageKey) throw new NotFoundError("Anexo");

  const inline = !options.download && canDisplayInline(attachment.contentType);
  const url = await storage().getSignedUrl(attachment.storageKey, {
    fileName: attachment.fileName,
    contentType: inline ? attachment.contentType : "application/octet-stream",
    disposition: inline ? "inline" : "attachment",
  });
  if (options.download) {
    await recordAuditSafely(ctx, { action: "attachment.download", entityType: "Attachment", entityId: id });
  }
  return { url, fileName: attachment.fileName, contentType: attachment.contentType, inline };
}
