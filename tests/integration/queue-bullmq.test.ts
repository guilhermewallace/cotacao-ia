import { Redis } from "ioredis";
import type { Worker } from "bullmq";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readDemoFixture } from "@/demo/mock-fixtures";
import { FIXTURE_FILES } from "@/demo/scenarios";
import { setAiProvidersForTests } from "@/modules/ai";
import { parseAiExtraction } from "@/modules/ai/schema";
import { AiProviderError, type AiProvider } from "@/modules/ai/types";
import { ingestUpload } from "@/modules/inbox/upload";
import { closeJobQueue, getBullQueue, getJobQueue } from "@/modules/processing/queue";
import { recoverInterruptedJobs } from "@/modules/processing/recovery";
import { createProcessingWorker } from "@/modules/processing/worker";
import { getRequestDetail } from "@/modules/requests/queries";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { getPrisma } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { createTestOrganization, type TestOrganization } from "../helpers/factory";

/**
 * FILA REAL (Redis + BullMQ) com um worker em execução, como em produção.
 * Usa um banco Redis separado (índice 15) para não interferir em um worker de desenvolvimento.
 * Sem Redis acessível, os testes deste arquivo são ignorados (os demais usam a fila em linha).
 */

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";

async function redisAvailable(): Promise<boolean> {
  const client = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 1500, maxRetriesPerRequest: 0, retryStrategy: () => null });
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.flushdb();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

const available = await redisAvailable();

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error("Tempo esgotado aguardando o processamento pela fila.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe.skipIf(!available)("processamento com Redis + BullMQ", () => {
  let org: TestOrganization;
  let worker: Worker;
  const csv = () => ({ name: FIXTURE_FILES.csv, data: readDemoFixture(FIXTURE_FILES.csv) });

  beforeAll(async () => {
    process.env.QUEUE_DRIVER = "bullmq";
    process.env.REDIS_URL = REDIS_URL;
    resetEnvCache();
    await closeJobQueue();
    org = await createTestOrganization("fila", { withDemoCatalog: true });
    worker = createProcessingWorker({ concurrency: 2 });
    await worker.waitUntilReady();
  });

  afterEach(() => setAiProvidersForTests({}));

  afterAll(async () => {
    await worker?.close();
    await closeJobQueue();
    process.env.QUEUE_DRIVER = "inline";
    resetEnvCache();
  });

  it("o upload apenas enfileira; o worker processa e a solicitação fica pronta para revisão", async () => {
    expect(getJobQueue().driver).toBe("bullmq");
    const result = await ingestUpload(org.seller, { files: [csv()] });

    const detail = await waitFor(
      () => getRequestDetail(org.seller, result.requestId!),
      (request) => request.status === "AWAITING_REVIEW" || request.status === "FAILED",
    );
    expect(detail.status).toBe("AWAITING_REVIEW");
    expect(detail.items).toHaveLength(5);

    const job = await tenantDb(org.id).processingJob.findFirstOrThrow({ where: { inboundMessageId: result.messageId } });
    expect(job).toMatchObject({ status: "SUCCEEDED", attempts: 1 });
    const queued = await waitFor(
      async () => (await getBullQueue()!.getJob(job.id))?.getState(),
      (state) => state === "completed",
    );
    expect(queued).toBe("completed");
  });

  it("falha temporária: a fila reagenda com backoff e o job termina com sucesso", async () => {
    let calls = 0;
    const flaky: AiProvider = {
      name: "mock",
      model: "instavel",
      capabilities: { images: true, pdf: true },
      extract: async () => {
        calls += 1;
        if (calls <= 2) throw new AiProviderError("Falha na chamada à IA (HTTP 503).", { retryable: true });
        return parseAiExtraction({
          documentType: "quotation_request",
          legibility: "good",
          customer: null,
          items: [{ originalDescription: "Disjuntor DIN tripolar 32A curva C", normalizedDescription: null, quantity: null, unit: null, manufacturer: null, manufacturerCode: null, attributes: [], page: null, sourceExcerpt: null, confidence: 0.9, notes: null }],
          warnings: [],
        });
      },
    };
    setAiProvidersForTests({ ai: flaky });
    const result = await ingestUpload(org.seller, { files: [{ name: FIXTURE_FILES.pdfOrder, data: readDemoFixture(FIXTURE_FILES.pdfOrder) }] });

    const detail = await waitFor(
      () => getRequestDetail(org.seller, result.requestId!),
      (request) => request.status === "AWAITING_REVIEW" || request.status === "FAILED",
    );
    expect(detail.status).toBe("AWAITING_REVIEW");
    expect(calls).toBe(3);
    const job = await tenantDb(org.id).processingJob.findFirstOrThrow({ where: { inboundMessageId: result.messageId } });
    expect(job).toMatchObject({ status: "SUCCEEDED", attempts: 3 });
  });

  it("recupera um job que ficou no banco mas não chegou à fila (ex.: Redis indisponível no momento do envio)", async () => {
    const result = await ingestUpload(org.seller, { files: [csv()] });
    await waitFor(
      () => getRequestDetail(org.seller, result.requestId!),
      (request) => request.status === "AWAITING_REVIEW",
    );
    const db = tenantDb(org.id);
    const job = await db.processingJob.findFirstOrThrow({ where: { inboundMessageId: result.messageId } });

    // estado de "enfileiramento perdido": job QUEUED antigo no banco e inexistente na fila
    await (await getBullQueue()!.getJob(job.id))?.remove();
    const old = new Date(Date.now() - 5 * 60_000);
    await getPrisma().processingJob.update({ where: { id: job.id }, data: { status: "QUEUED", attempts: 0, finishedAt: null, heartbeatAt: null, createdAt: old, updatedAt: old } });
    await db.quotationRequest.update({ where: { id: result.requestId! }, data: { status: "RECEIVED" } });
    expect(await getJobQueue().isPending(job.id)).toBe(false);

    const recovered = await recoverInterruptedJobs({ queuedOlderThanSeconds: 60 });
    expect(recovered.requeued).toBeGreaterThanOrEqual(1);
    const detail = await waitFor(
      () => getRequestDetail(org.seller, result.requestId!),
      (request) => request.status === "AWAITING_REVIEW",
    );
    expect(detail.items).toHaveLength(5);
    expect((await db.processingJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SUCCEEDED");
  });
});
