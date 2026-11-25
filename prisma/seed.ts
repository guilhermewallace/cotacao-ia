/**
 * Seed do ambiente de demonstração: `npm run db:seed`.
 *
 * Recria as organizações fictícias (Elétrica Central e Volt Sul), o catálogo, os
 * clientes e as solicitações de exemplo. Organizações que não são de demonstração
 * não são tocadas.
 */
import "../scripts/lib/load-env";

// O seed processa as solicitações no próprio processo, sem depender de Redis ou de IA externa.
process.env.QUEUE_DRIVER = "inline";
process.env.AI_PROVIDER = "mock";
process.env.LOG_LEVEL = process.env.SEED_LOG_LEVEL ?? "warn";

async function main(): Promise<void> {
  const { seedDemo } = await import("../src/demo/seed");
  const { disconnectPrisma } = await import("../src/platform/db");
  const { env } = await import("../src/platform/env");

  const started = Date.now();
  const summary = await seedDemo();
  await disconnectPrisma();

  console.log("\nAmbiente de demonstração pronto (dados fictícios):");
  console.log(`  Organização : ${summary.organization}`);
  console.log(`  Produtos    : ${summary.products}`);
  console.log(`  Clientes    : ${summary.customers}`);
  console.log(`  Solicitações: ${summary.requests}`);
  console.log(`  Cotações    : ${summary.quotations}`);
  console.log(`  Tempo       : ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (env().AUTH_PROVIDER === "demo") {
    console.log("\nAcesso (AUTH_PROVIDER=demo) — senha única definida em DEMO_PASSWORD:");
    for (const user of summary.users) console.log(`  ${user}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
