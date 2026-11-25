import { assertCan } from "@/modules/identity/permissions";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb, type TenantDbOrTx } from "@/modules/tenancy/tenant-db";
import { logger, serializeError } from "@/platform/logger";

export interface AuditEntry {
  /** Verbo no formato `entidade.acao`, ex.: `quotation.finalize`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Resumo da operação. Não inclua segredos nem conteúdo de documentos. */
  metadata?: Record<string, unknown>;
}

/**
 * Registra uma operação na trilha de auditoria.
 * Passe a transação (`tx`) para que o registro seja atômico com a operação auditada.
 */
export async function recordAudit(ctx: TenantContext, entry: AuditEntry, tx?: TenantDbOrTx): Promise<void> {
  const db = tx ?? tenantDb(ctx.organizationId);
  await db.auditLog.create({
    data: {
      organizationId: ctx.organizationId,
      actorType: ctx.actorType,
      actorUserId: ctx.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: (entry.metadata ?? {}) as object,
      ipAddress: ctx.request?.ipAddress ?? null,
      userAgent: ctx.request?.userAgent?.slice(0, 500) ?? null,
    },
  });
}

/** Variante que nunca interrompe o fluxo principal (ex.: auditoria de leituras). */
export async function recordAuditSafely(ctx: TenantContext, entry: AuditEntry): Promise<void> {
  try {
    await recordAudit(ctx, entry);
  } catch (error) {
    logger({ organizationId: ctx.organizationId }).error({ err: serializeError(error), action: entry.action }, "falha ao registrar auditoria");
  }
}

export interface AuditLogView {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  actorType: string;
  actorName: string | null;
  metadata: unknown;
}

export async function listAuditLogs(ctx: TenantContext, options: { limit?: number } = {}): Promise<AuditLogView[]> {
  assertCan(ctx, "audit:read");
  const rows = await tenantDb(ctx.organizationId).auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 50, 200),
    include: { actor: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actorType: row.actorType,
    actorName: row.actor?.name ?? null,
    metadata: row.metadata,
  }));
}
