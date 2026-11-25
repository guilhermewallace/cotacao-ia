import { recordAudit } from "@/modules/audit/audit";
import { assertCan } from "@/modules/identity/permissions";
import { createInboundJob, failJobAttempt, findRecoverableJobs, releaseStaleJob, touchJob } from "@/modules/processing/jobs";
import { markProcessingFailed } from "@/modules/processing/pipeline";
import { enqueueProcessingJob, getJobQueue } from "@/modules/processing/queue";
import { systemContext, type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { ConflictError, NotFoundError } from "@/platform/errors";
import { parseId } from "@/platform/ids";
import { logger, serializeError } from "@/platform/logger";

/**
 * Recuperação de jobs interrompidos.
 *
 * Roda na inicialização do worker e periodicamente. Reenfileira:
 *  - jobs QUEUED que a fila não conhece (o envio à fila falhou ou o Redis perdeu dados);
 *  - jobs RUNNING sem heartbeat (o worker caiu no meio do processamento).
 * É seguro rodar em vários workers ao mesmo tempo: a liberação é um UPDATE atômico e
 * a fila ignora o reenvio de um job que ela ainda conhece.
 */
export async function recoverInterruptedJobs(options: { queuedOlderThanSeconds?: number } = {}): Promise<{ requeued: number; failed: number }> {
  const log = logger({ routine: "recovery" });
  const queue = getJobQueue();
  const jobs = await findRecoverableJobs({ queuedOlderThanSeconds: options.queuedOlderThanSeconds ?? 60, limit: 200 });
  const result = { requeued: 0, failed: 0 };

  for (const job of jobs) {
    try {
      // A fila ainda tem o job (aguardando, em execução ou em espera para nova tentativa): nada a fazer.
      if (await queue.isPending(job.id)) continue;
      if (job.status === "RUNNING" && !(await releaseStaleJob(job.organizationId, job.id))) continue;

      if (job.attempts >= job.maxAttempts) {
        const full = await tenantDb(job.organizationId).processingJob.findUnique({ where: { id: job.id }, select: { inboundMessageId: true, type: true } });
        await failJobAttempt(
          { id: job.id, organizationId: job.organizationId, attempts: job.attempts, maxAttempts: job.maxAttempts, type: full?.type ?? "PROCESS_INBOUND_MESSAGE", inboundMessageId: full?.inboundMessageId ?? null },
          "Processamento interrompido repetidas vezes.",
          { retryable: false },
        );
        if (full?.inboundMessageId) {
          await markProcessingFailed(systemContext(job.organizationId), full.inboundMessageId, "Processamento interrompido. Use \"Reprocessar\".");
        }
        result.failed += 1;
        continue;
      }

      await enqueueProcessingJob({ processingJobId: job.id, organizationId: job.organizationId });
      await touchJob(job.organizationId, job.id);
      result.requeued += 1;
    } catch (error) {
      log.error({ err: serializeError(error), jobId: job.id }, "falha ao recuperar job");
    }
  }

  if (result.requeued > 0 || result.failed > 0) log.info(result, "jobs recuperados");
  return result;
}

/**
 * Reprocessa uma solicitação a pedido do usuário (após falha ou para refazer a leitura).
 * Cria um novo ProcessingJob — o histórico de tentativas anteriores é preservado.
 */
export async function reprocessRequest(ctx: TenantContext, requestId: string): Promise<void> {
  assertCan(ctx, "request:review");
  const id = parseId(requestId, "Solicitação");
  const db = tenantDb(ctx.organizationId);

  const jobId = await db.$transaction(async (tx) => {
    const request = await tx.quotationRequest.findUnique({
      where: { id },
      select: { id: true, status: true, inboundMessageId: true, _count: { select: { quotations: true } } },
    });
    if (!request) throw new NotFoundError("Solicitação");
    if (request.status === "PROCESSING" || request.status === "RECEIVED") throw new ConflictError("A solicitação já está em processamento.");
    const reviewed = await tx.requestedItem.count({ where: { quotationRequestId: id, status: { not: "PENDING" } } });
    if (reviewed > 0 || request._count.quotations > 0 || request.status === "QUOTED") {
      throw new ConflictError("A solicitação já foi revisada. Reprocessar descartaria o trabalho feito.");
    }

    const previous = await tx.processingJob.count({ where: { inboundMessageId: request.inboundMessageId } });
    const job = await createInboundJob(tx, ctx.organizationId, request.inboundMessageId, { retry: previous });
    await tx.quotationRequest.update({ where: { id }, data: { status: "RECEIVED", processedAt: null } });
    await tx.inboundMessage.update({ where: { id: request.inboundMessageId }, data: { status: "RECEIVED", error: null } });
    await recordAudit(ctx, { action: "request.reprocess", entityType: "QuotationRequest", entityId: id }, tx);
    return job.id;
  });

  await enqueueProcessingJob({ processingJobId: jobId, organizationId: ctx.organizationId });
}
