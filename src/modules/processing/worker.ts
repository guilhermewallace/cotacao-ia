import { UnrecoverableError, Worker, type Job } from "bullmq";
import { JOB_PROCESS_INBOUND, PROCESSING_QUEUE, type ProcessingJobPayload } from "@/modules/processing/queue";
import { runProcessingJob } from "@/modules/processing/runner";
import { logger, serializeError } from "@/platform/logger";
import { createRedisConnection } from "@/platform/redis";

/**
 * Worker BullMQ da fila de processamento. Usado pelo processo `scripts/worker.ts`
 * (e pelos testes de integração com Redis).
 *
 * O estado do job vive no banco (ProcessingJob): a fila apenas agenda a execução.
 *   - "retry"  → lança erro comum: a fila reagenda com backoff exponencial;
 *   - "failed" → lança UnrecoverableError: falha definitiva, sem nova tentativa;
 *   - "succeeded" / "skipped" → conclui.
 */
export function createProcessingWorker(options: { concurrency?: number } = {}): Worker<ProcessingJobPayload> {
  const log = logger({ component: "processing-worker" });

  const worker = new Worker<ProcessingJobPayload>(
    PROCESSING_QUEUE,
    async (job: Job<ProcessingJobPayload>) => {
      if (job.name !== JOB_PROCESS_INBOUND) throw new UnrecoverableError(`Tipo de job desconhecido: ${job.name}`);
      const outcome = await runProcessingJob(job.data);
      if (outcome === "retry") throw new Error("Falha temporária no processamento; nova tentativa agendada.");
      if (outcome === "failed") throw new UnrecoverableError("Falha definitiva no processamento.");
      return outcome;
    },
    {
      connection: createRedisConnection("worker"),
      concurrency: options.concurrency ?? 2,
      // Documentos grandes e chamadas de IA podem levar mais que o padrão de 30 s.
      lockDuration: 120_000,
    },
  );

  worker.on("error", (error) => log.error({ err: serializeError(error) }, "erro no worker"));
  worker.on("stalled", (jobId) => log.warn({ jobId }, "job travado; a fila vai reprocessá-lo"));
  worker.on("failed", (job, error) => {
    if (!(error instanceof UnrecoverableError)) log.debug({ jobId: job?.id, attemptsMade: job?.attemptsMade }, "tentativa falhou");
  });
  return worker;
}
