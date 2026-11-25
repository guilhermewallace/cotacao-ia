/**
 * Worker de processamento — processo independente do servidor web.
 *
 *   npm run worker        (produção/desenvolvimento)
 *   npm run worker:dev    (reinicia ao alterar o código)
 *
 * Consome a fila BullMQ `cotacao-processing` (Redis) e executa o pipeline de documentos:
 * download de mídias, extração, normalização e matching. Além disso:
 *   - na inicialização e a cada minuto, recupera jobs interrompidos (worker que caiu,
 *     envio à fila que falhou, Redis reiniciado);
 *   - a cada hora, aplica a política de retenção de documentos e limpa importações abandonadas;
 *   - no encerramento (SIGTERM/SIGINT), termina os jobs em andamento antes de sair.
 *
 * Pode-se rodar vários workers em paralelo: cada job é reivindicado atomicamente no banco.
 */
import "./lib/load-env";
import { cleanupAbandonedImports } from "../src/modules/catalog/import";
import { closeJobQueue, PROCESSING_QUEUE } from "../src/modules/processing/queue";
import { recoverInterruptedJobs } from "../src/modules/processing/recovery";
import { purgeExpiredDocuments } from "../src/modules/processing/retention";
import { createProcessingWorker } from "../src/modules/processing/worker";
import { ensureStorageReady } from "../src/modules/storage";
import { disconnectPrisma } from "../src/platform/db";
import { env } from "../src/platform/env";
import { logger, serializeError } from "../src/platform/logger";

const RECOVERY_INTERVAL_MS = 60_000;
const MAINTENANCE_INTERVAL_MS = 60 * 60_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

const log = logger({ process: "worker" });

async function main(): Promise<void> {
  const config = env();
  if (config.QUEUE_DRIVER !== "bullmq") {
    log.warn("QUEUE_DRIVER=inline: o processamento acontece no servidor web e o worker não é necessário. Encerrando.");
    return;
  }

  await ensureStorageReady().catch((error: unknown) => log.warn({ err: serializeError(error) }, "não foi possível verificar o storage na inicialização"));

  const worker = createProcessingWorker({ concurrency: config.WORKER_CONCURRENCY });

  const recover = () => recoverInterruptedJobs().catch((error: unknown) => log.error({ err: serializeError(error) }, "falha na rotina de recuperação"));
  const maintain = async () => {
    try {
      const purged = await purgeExpiredDocuments();
      const imports = await cleanupAbandonedImports();
      if (purged.attachments > 0 || purged.messages > 0 || imports > 0) log.info({ ...purged, abandonedImports: imports }, "manutenção concluída");
    } catch (error) {
      log.error({ err: serializeError(error) }, "falha na rotina de manutenção");
    }
  };

  await worker.waitUntilReady();
  log.info({ queue: PROCESSING_QUEUE, concurrency: config.WORKER_CONCURRENCY, aiProvider: config.AI_PROVIDER }, "worker pronto");

  // Recupera imediatamente o que ficou pendente enquanto nenhum worker estava no ar.
  await recoverInterruptedJobs({ queuedOlderThanSeconds: 5 }).catch((error: unknown) => log.error({ err: serializeError(error) }, "falha na recuperação inicial"));
  const recoveryTimer = setInterval(recover, RECOVERY_INTERVAL_MS);
  const maintenanceTimer = setInterval(maintain, MAINTENANCE_INTERVAL_MS);
  void maintain();

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "encerrando: aguardando os jobs em andamento");
    clearInterval(recoveryTimer);
    clearInterval(maintenanceTimer);
    const force = setTimeout(() => {
      log.error("tempo de encerramento esgotado; saindo. Os jobs interrompidos serão recuperados pelo próximo worker.");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    try {
      await worker.close();
      await closeJobQueue();
      await disconnectPrisma();
    } finally {
      process.exit(0);
    }
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  log.fatal({ err: serializeError(error) }, "o worker não pôde iniciar");
  process.exit(1);
});
