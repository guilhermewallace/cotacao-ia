import { Queue } from "bullmq";
import { DEFAULT_MAX_ATTEMPTS } from "@/modules/processing/jobs";
import { env } from "@/platform/env";
import { logger, serializeError } from "@/platform/logger";
import { createRedisConnection } from "@/platform/redis";

/**
 * Fila de processamento.
 *
 * - `bullmq` (padrão): Redis + BullMQ; o trabalho é executado pelo processo worker.
 * - `inline`: executa no próprio processo, logo após o enfileiramento. Serve para
 *   testes e para demonstrações sem Redis — não use em produção.
 *
 * O `jobId` da fila é o ID do ProcessingJob: enfileirar duas vezes o mesmo job é inócuo.
 */

export const PROCESSING_QUEUE = "cotacao-processing";
export const JOB_PROCESS_INBOUND = "process-inbound-message";
export const JOB_MAINTENANCE = "maintenance";

export interface ProcessingJobPayload {
  processingJobId: string;
  organizationId: string;
}

export interface JobQueue {
  readonly driver: "bullmq" | "inline";
  enqueue(payload: ProcessingJobPayload): Promise<void>;
  /** Verdadeiro se a fila ainda conhece o job (aguardando, ativo ou atrasado). */
  isPending(processingJobId: string): Promise<boolean>;
  close(): Promise<void>;
}

class BullMqJobQueue implements JobQueue {
  readonly driver = "bullmq" as const;
  readonly queue: Queue;

  constructor() {
    this.queue = new Queue(PROCESSING_QUEUE, {
      connection: createRedisConnection("producer"),
      defaultJobOptions: {
        attempts: DEFAULT_MAX_ATTEMPTS,
        // 5 s, 10 s, 20 s… (encurtado nos testes automatizados)
        backoff: { type: "exponential", delay: env().NODE_ENV === "test" ? 50 : 5_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 3_600, count: 5_000 },
      },
    });
    this.queue.on("error", (error) => logger().error({ err: serializeError(error) }, "erro na conexão da fila"));
  }

  async enqueue(payload: ProcessingJobPayload): Promise<void> {
    // A fila ignora um jobId que ela ainda guarda. Um job já finalizado na fila (mas pendente no
    // banco, ex.: após recuperação) precisa ser removido para poder ser executado de novo.
    const existing = await this.queue.getJob(payload.processingJobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== "completed" && state !== "failed") return;
      await existing.remove();
    }
    await this.queue.add(JOB_PROCESS_INBOUND, payload, { jobId: payload.processingJobId });
  }

  async isPending(processingJobId: string): Promise<boolean> {
    const job = await this.queue.getJob(processingJobId);
    if (!job) return false;
    const state = await job.getState();
    return state === "waiting" || state === "active" || state === "delayed" || state === "prioritized" || state === "waiting-children";
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

class InlineJobQueue implements JobQueue {
  readonly driver = "inline" as const;
  private readonly running = new Map<string, Promise<void>>();

  async enqueue(payload: ProcessingJobPayload): Promise<void> {
    if (this.running.has(payload.processingJobId)) return;
    const task = this.run(payload)
      .catch((error) => logger().error({ err: serializeError(error), jobId: payload.processingJobId }, "falha no processamento em linha"))
      .finally(() => this.running.delete(payload.processingJobId));
    this.running.set(payload.processingJobId, task);
  }

  private async run(payload: ProcessingJobPayload): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    const { runProcessingJob } = await import("@/modules/processing/runner");
    for (let attempt = 0; attempt < DEFAULT_MAX_ATTEMPTS; attempt += 1) {
      const outcome = await runProcessingJob(payload);
      if (outcome !== "retry") return;
      await new Promise((resolve) => setTimeout(resolve, env().NODE_ENV === "test" ? 5 : 1_000 * (attempt + 1)));
    }
  }

  async isPending(processingJobId: string): Promise<boolean> {
    return this.running.has(processingJobId);
  }

  /** Aguarda o término de todos os jobs em execução (usado em testes e no seed). */
  async idle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running.values()]);
    }
  }

  async close(): Promise<void> {
    await this.idle();
  }
}

const globalStore = globalThis as unknown as { __cotacaoQueue?: JobQueue };

export function getJobQueue(): JobQueue {
  globalStore.__cotacaoQueue ??= env().QUEUE_DRIVER === "inline" ? new InlineJobQueue() : new BullMqJobQueue();
  return globalStore.__cotacaoQueue;
}

export async function enqueueProcessingJob(payload: ProcessingJobPayload): Promise<void> {
  await getJobQueue().enqueue(payload);
}

/** Aguarda a fila em linha esvaziar. Sem efeito com BullMQ. */
export async function waitForInlineJobs(): Promise<void> {
  const queue = getJobQueue();
  if (queue instanceof InlineJobQueue) await queue.idle();
}

export async function closeJobQueue(): Promise<void> {
  if (globalStore.__cotacaoQueue) {
    await globalStore.__cotacaoQueue.close();
    globalStore.__cotacaoQueue = undefined;
  }
}

/** Fila BullMQ subjacente, para o worker registrar tarefas agendadas. */
export function getBullQueue(): Queue | null {
  const queue = getJobQueue();
  return queue instanceof BullMqJobQueue ? queue.queue : null;
}
