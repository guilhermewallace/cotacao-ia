import { Prisma } from "@/generated/prisma/client";
import type { ProcessingJobType } from "@/generated/prisma/enums";
import type { TenantDbOrTx } from "@/modules/tenancy/tenant-db";
import { getPrisma } from "@/platform/db";
import { truncate } from "@/modules/normalization/text";

/**
 * Ciclo de vida de um ProcessingJob (espelho, no banco, do job na fila):
 *
 *   QUEUED ──claim──▶ RUNNING ──┬─ sucesso ─────────────▶ SUCCEEDED
 *      ▲                        ├─ falha, há tentativas ─▶ QUEUED   (a fila reagenda com backoff)
 *      │                        └─ falha definitiva ─────▶ FAILED
 *      └── recuperação: RUNNING sem heartbeat recente volta para QUEUED
 *
 * A reivindicação ("claim") é um UPDATE atômico: dois workers nunca processam o
 * mesmo job ao mesmo tempo, mesmo que ele seja enfileirado mais de uma vez.
 */

export const DEFAULT_MAX_ATTEMPTS = 5;
/** Um job RUNNING sem heartbeat por este intervalo é considerado interrompido. */
export const STALE_HEARTBEAT_SECONDS = 120;

export interface ClaimedJob {
  id: string;
  organizationId: string;
  type: ProcessingJobType;
  inboundMessageId: string | null;
  attempts: number;
  maxAttempts: number;
}

export async function createInboundJob(tx: TenantDbOrTx, organizationId: string, inboundMessageId: string, options: { retry?: number } = {}) {
  const suffix = options.retry ? `:retry:${options.retry}` : "";
  return tx.processingJob.create({
    data: {
      organizationId,
      type: "PROCESS_INBOUND_MESSAGE",
      idempotencyKey: `inbound:${inboundMessageId}${suffix}`,
      inboundMessageId,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
    },
    select: { id: true },
  });
}

/** Reivindica o job para execução. Retorna `null` se outro worker já o detém ou se ele já terminou. */
export async function claimJob(organizationId: string, jobId: string): Promise<ClaimedJob | null> {
  const rows = await getPrisma().$queryRaw<
    Array<{ id: string; organization_id: string; type: ProcessingJobType; inbound_message_id: string | null; attempts: number; max_attempts: number }>
  >(Prisma.sql`
    UPDATE processing_jobs
    SET status = 'RUNNING', attempts = attempts + 1, started_at = now(), heartbeat_at = now(), updated_at = now()
    WHERE id = ${jobId}::uuid
      AND organization_id = ${organizationId}::uuid
      AND (
        status = 'QUEUED'
        OR (status = 'RUNNING' AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => ${STALE_HEARTBEAT_SECONDS})))
      )
    RETURNING id, organization_id, type, inbound_message_id, attempts, max_attempts
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    inboundMessageId: row.inbound_message_id,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

export async function heartbeatJob(organizationId: string, jobId: string): Promise<void> {
  await getPrisma().$executeRaw(Prisma.sql`
    UPDATE processing_jobs SET heartbeat_at = now()
    WHERE id = ${jobId}::uuid AND organization_id = ${organizationId}::uuid AND status = 'RUNNING'
  `);
}

export async function completeJob(organizationId: string, jobId: string, result: Record<string, unknown>): Promise<void> {
  await getPrisma().$executeRaw(Prisma.sql`
    UPDATE processing_jobs
    SET status = 'SUCCEEDED', finished_at = now(), updated_at = now(), last_error = NULL, result = ${JSON.stringify(result)}::jsonb
    WHERE id = ${jobId}::uuid AND organization_id = ${organizationId}::uuid
  `);
}

/**
 * Registra a falha de uma tentativa. Retorna "retry" se o job voltou para a fila
 * ou "failed" se as tentativas se esgotaram (ou o erro não admite nova tentativa).
 */
export async function failJobAttempt(job: ClaimedJob, error: string, options: { retryable: boolean }): Promise<"retry" | "failed"> {
  const final = !options.retryable || job.attempts >= job.maxAttempts;
  await getPrisma().$executeRaw(Prisma.sql`
    UPDATE processing_jobs
    SET status = ${final ? "FAILED" : "QUEUED"}::"ProcessingJobStatus",
        last_error = ${truncate(error, 1000)},
        finished_at = ${final ? Prisma.sql`now()` : Prisma.sql`NULL`},
        heartbeat_at = NULL,
        updated_at = now()
    WHERE id = ${job.id}::uuid AND organization_id = ${job.organizationId}::uuid
  `);
  return final ? "failed" : "retry";
}

export interface RecoverableJob {
  id: string;
  organizationId: string;
  status: "QUEUED" | "RUNNING";
  attempts: number;
  maxAttempts: number;
}

/**
 * Jobs que podem ter se perdido: enfileirados há algum tempo sem início (o envio à
 * fila pode ter falhado) ou em execução sem heartbeat (worker interrompido).
 * Consulta de manutenção, intencionalmente entre organizações.
 */
export async function findRecoverableJobs(options: { queuedOlderThanSeconds: number; limit: number }): Promise<RecoverableJob[]> {
  const rows = await getPrisma().$queryRaw<Array<{ id: string; organization_id: string; status: "QUEUED" | "RUNNING"; attempts: number; max_attempts: number }>>(
    Prisma.sql`
      SELECT id, organization_id, status, attempts, max_attempts
      FROM processing_jobs
      WHERE type = 'PROCESS_INBOUND_MESSAGE'
        AND (
          (status = 'QUEUED' AND updated_at < now() - make_interval(secs => ${options.queuedOlderThanSeconds}))
          OR (status = 'RUNNING' AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => ${STALE_HEARTBEAT_SECONDS})))
        )
      ORDER BY queued_at ASC
      LIMIT ${options.limit}
    `,
  );
  return rows.map((row) => ({ id: row.id, organizationId: row.organization_id, status: row.status, attempts: row.attempts, maxAttempts: row.max_attempts }));
}

/** Devolve à fila um job RUNNING cujo worker desapareceu. */
export async function releaseStaleJob(organizationId: string, jobId: string): Promise<boolean> {
  const updated = await getPrisma().$executeRaw(Prisma.sql`
    UPDATE processing_jobs
    SET status = 'QUEUED', heartbeat_at = NULL, updated_at = now()
    WHERE id = ${jobId}::uuid AND organization_id = ${organizationId}::uuid AND status = 'RUNNING'
      AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => ${STALE_HEARTBEAT_SECONDS}))
  `);
  return updated > 0;
}

/** Marca como recém-tocado, para a recuperação não reenfileirar o mesmo job a cada varredura. */
export async function touchJob(organizationId: string, jobId: string): Promise<void> {
  await getPrisma().$executeRaw(Prisma.sql`
    UPDATE processing_jobs SET updated_at = now() WHERE id = ${jobId}::uuid AND organization_id = ${organizationId}::uuid
  `);
}
