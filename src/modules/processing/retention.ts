import { recordAudit } from "@/modules/audit/audit";
import { assertCan } from "@/modules/identity/permissions";
import { storage } from "@/modules/storage";
import { systemContext, type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { getPrisma } from "@/platform/db";
import { NotFoundError } from "@/platform/errors";
import { parseId } from "@/platform/ids";
import { logger, serializeError } from "@/platform/logger";

/**
 * Retenção e exclusão de documentos (LGPD).
 *
 * "Expurgar" um documento significa: apagar o arquivo do storage, apagar o texto
 * extraído e o corpo da mensagem. Os dados estruturados da solicitação (itens,
 * cotação) são registros comerciais e permanecem.
 */

async function purgeAttachments(organizationId: string, where: { inboundMessageId?: string; createdBefore?: Date }): Promise<number> {
  const db = tenantDb(organizationId);
  const attachments = await db.attachment.findMany({
    where: {
      purgedAt: null,
      ...(where.inboundMessageId ? { inboundMessageId: where.inboundMessageId } : {}),
      ...(where.createdBefore ? { createdAt: { lt: where.createdBefore } } : {}),
    },
    select: { id: true, storageKey: true },
    take: 500,
  });

  let purged = 0;
  for (const attachment of attachments) {
    try {
      if (attachment.storageKey) await storage().delete(attachment.storageKey);
      await db.attachment.update({
        where: { id: attachment.id },
        data: { status: "PURGED", storageKey: null, extractedText: null, purgedAt: new Date() },
      });
      purged += 1;
    } catch (error) {
      logger({ organizationId }).error({ err: serializeError(error), attachmentId: attachment.id }, "falha ao expurgar anexo");
    }
  }
  return purged;
}

/** Expurgo automático conforme `document_retention_days` de cada organização. Executado diariamente pelo worker. */
export async function purgeExpiredDocuments(now = new Date()): Promise<{ organizations: number; attachments: number; messages: number }> {
  const organizations = await getPrisma().organization.findMany({
    where: { documentRetentionDays: { not: null } },
    select: { id: true, documentRetentionDays: true },
  });
  const totals = { organizations: 0, attachments: 0, messages: 0 };

  for (const organization of organizations) {
    if (!organization.documentRetentionDays) continue;
    const cutoff = new Date(now.getTime() - organization.documentRetentionDays * 24 * 60 * 60 * 1000);
    const attachments = await purgeAttachments(organization.id, { createdBefore: cutoff });
    const messages = await tenantDb(organization.id).inboundMessage.updateMany({
      where: { receivedAt: { lt: cutoff }, OR: [{ textContent: { not: null } }, { subject: { not: null } }] },
      data: { textContent: null, subject: null },
    });
    if (attachments > 0 || messages.count > 0) {
      totals.organizations += 1;
      totals.attachments += attachments;
      totals.messages += messages.count;
      await recordAudit(systemContext(organization.id), {
        action: "retention.purge",
        entityType: "Organization",
        entityId: organization.id,
        metadata: { attachments, messages: messages.count, retentionDays: organization.documentRetentionDays },
      });
    }
  }
  return totals;
}

/** Exclusão imediata dos documentos de uma solicitação (ex.: pedido de eliminação do titular). */
export async function deleteRequestDocuments(ctx: TenantContext, requestId: string): Promise<{ attachments: number }> {
  assertCan(ctx, "settings:manage");
  const id = parseId(requestId, "Solicitação");
  const db = tenantDb(ctx.organizationId);
  const request = await db.quotationRequest.findUnique({ where: { id }, select: { inboundMessageId: true } });
  if (!request) throw new NotFoundError("Solicitação");

  const attachments = await purgeAttachments(ctx.organizationId, { inboundMessageId: request.inboundMessageId });
  await db.inboundMessage.update({ where: { id: request.inboundMessageId }, data: { textContent: null, subject: null } });
  await recordAudit(ctx, { action: "request.documents_delete", entityType: "QuotationRequest", entityId: id, metadata: { attachments } });
  return { attachments };
}
