/**
 * SIMULADOR LOCAL — envia ao webhook do aplicativo um e-mail de entrada no formato do
 * adaptador genérico (JSON assinado por HMAC com EMAIL_WEBHOOK_SECRET).
 * Nenhum e-mail real é enviado ou recebido.
 *
 * Requisitos: aplicação no ar (npm run dev), worker (npm run worker) e seed aplicado.
 *
 * Uso:
 *   npm run demo:email
 *   npm run demo:email -- --amostra mail-incompleto
 *   npm run demo:email -- --anexo demo/fixtures/pedido-cotacao-horizonte-azul.pdf
 *   npm run demo:email -- --duplicar   (envia duas vezes: demonstra a idempotência)
 */
import "./lib/load-env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEMO_ORG } from "../src/demo/scenarios";
import { buildEmailSample, EMAIL_SAMPLES } from "../src/demo/simulate";
import { GENERIC_SIGNATURE_HEADER, signGenericEmailPayload } from "../src/modules/inbox/channels/email/generic";
import { env } from "../src/platform/env";
import { readArgs, stringArg } from "./lib/args";

async function main(): Promise<void> {
  const args = readArgs();
  const config = env();
  if (!config.EMAIL_WEBHOOK_SECRET) throw new Error("Defina EMAIL_WEBHOOK_SECRET no .env (qualquer valor local) para assinar o e-mail simulado.");

  const sample = EMAIL_SAMPLES.find((entry) => entry.id === stringArg(args, "amostra")) ?? EMAIL_SAMPLES[0];
  if (!sample) throw new Error("Nenhuma amostra disponível.");
  const to = stringArg(args, "para") ?? `${DEMO_ORG.inboundEmailKey}@${config.EMAIL_INBOUND_DOMAIN}`;

  const attachmentPath = stringArg(args, "anexo");
  const attachments = attachmentPath
    ? [{ fileName: path.basename(attachmentPath), contentBase64: readFileSync(path.resolve(process.cwd(), attachmentPath)).toString("base64") }]
    : [];

  const rawBody = JSON.stringify(buildEmailSample(sample, to, attachments));
  const url = `${stringArg(args, "url") ?? config.APP_URL}/api/webhooks/email/generic`;
  const headers = { "content-type": "application/json", [GENERIC_SIGNATURE_HEADER]: signGenericEmailPayload(rawBody, config.EMAIL_WEBHOOK_SECRET) };

  for (let attempt = 1; attempt <= (args.duplicar ? 2 : 1); attempt += 1) {
    const response = await fetch(url, { method: "POST", headers, body: rawBody });
    console.log(`[simulação] envio ${attempt}: HTTP ${response.status} ${await response.text()}`);
  }
  console.log(`[simulação] amostra "${sample.id}" — ${sample.label} → ${to}${attachmentPath ? ` (anexo: ${attachmentPath})` : ""}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
