import { AiProviderError } from "@/modules/ai/types";
import { MediaDownloadError } from "@/modules/inbox/channels/whatsapp/media";
import { claimJob, completeJob, failJobAttempt, heartbeatJob } from "@/modules/processing/jobs";
import { markProcessingFailed, NonRetryableProcessingError, processInboundMessage } from "@/modules/processing/pipeline";
import type { ProcessingJobPayload } from "@/modules/processing/queue";
import { systemContext } from "@/modules/tenancy/context";
import { errorMessage, isAppError } from "@/platform/errors";
import { logger, serializeError } from "@/platform/logger";

export type JobOutcome = "succeeded" | "retry" | "failed" | "skipped";

const HEARTBEAT_INTERVAL_MS = 15_000;

function isRetryable(error: unknown): boolean {
  if (error instanceof NonRetryableProcessingError) return false;
  if (error instanceof AiProviderError || error instanceof MediaDownloadError) return error.retryable;
  // Erros de regra de negócio não mudam com uma nova tentativa; o restante (rede, banco) pode ser transitório.
  return !isAppError(error);
}

/** Mensagem exibida ao usuário: nunca inclui detalhes internos de erros inesperados. */
function publicMessage(error: unknown): string {
  if (error instanceof NonRetryableProcessingError || error instanceof AiProviderError || error instanceof MediaDownloadError || isAppError(error)) {
    return error.message;
  }
  return "Erro inesperado no processamento. Tente reprocessar; se persistir, consulte os logs.";
}

/**
 * Executa um ProcessingJob. Chamado pelo worker BullMQ e pela fila em linha.
 *
 * - "skipped": outro worker detém o job ou ele já terminou (idempotência).
 * - "retry": falhou, mas ainda há tentativas — a fila reagenda.
 * - "failed": falha definitiva, registrada na mensagem e na solicitação.
 */
export async function runProcessingJob(payload: ProcessingJobPayload): Promise<JobOutcome> {
  const log = logger({ jobId: payload.processingJobId, organizationId: payload.organizationId });

  const job = await claimJob(payload.organizationId, payload.processingJobId);
  if (!job) {
    log.debug("job não reivindicado (em execução por outro worker ou já concluído)");
    return "skipped";
  }

  const ctx = systemContext(job.organizationId);
  const heartbeat = setInterval(() => {
    heartbeatJob(job.organizationId, job.id).catch((error) => log.warn({ err: serializeError(error) }, "falha ao registrar heartbeat"));
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  try {
    if (job.type !== "PROCESS_INBOUND_MESSAGE" || !job.inboundMessageId) {
      throw new NonRetryableProcessingError(`Tipo de job não suportado: ${job.type}`);
    }
    const result = await processInboundMessage(ctx, job.inboundMessageId);
    await completeJob(job.organizationId, job.id, { ...result });
    log.info({ attempt: job.attempts, ...result }, "job concluído");
    return "succeeded";
  } catch (error) {
    const outcome = await failJobAttempt(job, errorMessage(error), { retryable: isRetryable(error) });
    if (outcome === "failed" && job.inboundMessageId) {
      await markProcessingFailed(ctx, job.inboundMessageId, publicMessage(error));
    }
    log.error({ err: serializeError(error), attempt: job.attempts, maxAttempts: job.maxAttempts, outcome }, "falha ao executar job");
    return outcome;
  } finally {
    clearInterval(heartbeat);
  }
}
