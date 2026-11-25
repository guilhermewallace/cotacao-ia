/**
 * Aplica agora a política de retenção de documentos (LGPD) de todas as organizações
 * e remove importações de catálogo abandonadas. O worker já faz isso a cada hora;
 * este script serve para execução manual ou por agendador externo (cron).
 *
 * Uso: npm run retention:purge
 */
import "./lib/load-env";
import { cleanupAbandonedImports } from "../src/modules/catalog/import";
import { purgeExpiredDocuments } from "../src/modules/processing/retention";
import { disconnectPrisma } from "../src/platform/db";

async function main(): Promise<void> {
  const purged = await purgeExpiredDocuments();
  const imports = await cleanupAbandonedImports();
  console.log(`Retenção aplicada: ${purged.organizations} organização(ões) com política ativa, ${purged.attachments} anexo(s) e ${purged.messages} mensagem(ns) expurgados.`);
  console.log(`Importações abandonadas removidas: ${imports}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
