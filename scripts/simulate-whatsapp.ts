/**
 * SIMULADOR LOCAL — envia ao webhook do aplicativo uma notificação no formato da
 * WhatsApp Business Cloud API, assinada com WHATSAPP_APP_SECRET, como a Meta faria.
 * Nada é enviado à Meta e nenhuma mensagem real de WhatsApp é recebida.
 *
 * Requisitos: aplicação no ar (npm run dev), worker (npm run worker) e seed aplicado.
 *
 * Uso:
 *   npm run demo:whatsapp
 *   npm run demo:whatsapp -- --amostra wa-incompativel
 *   npm run demo:whatsapp -- --texto "5 disjuntor bipolar 32A curva C"
 *   npm run demo:whatsapp -- --duplicar            (envia duas vezes: demonstra a idempotência)
 *   npm run demo:whatsapp -- --assinatura-invalida (deve ser recusado com 401)
 */
import "./lib/load-env";
import { DEMO_ORG } from "../src/demo/scenarios";
import { buildWhatsAppSample, buildWhatsAppTextWebhook, WHATSAPP_SAMPLES } from "../src/demo/simulate";
import { signMetaPayload } from "../src/modules/inbox/channels/whatsapp/signature";
import { env } from "../src/platform/env";
import { readArgs, stringArg } from "./lib/args";

async function main(): Promise<void> {
  const args = readArgs();
  const config = env();
  if (!config.WHATSAPP_APP_SECRET) throw new Error("Defina WHATSAPP_APP_SECRET no .env (qualquer valor local) para assinar a notificação simulada.");

  const target = { phoneNumberId: stringArg(args, "phone-number-id") ?? DEMO_ORG.whatsAppPhoneNumberId, displayPhoneNumber: DEMO_ORG.whatsAppDisplayNumber };
  const text = stringArg(args, "texto");
  const sample = WHATSAPP_SAMPLES.find((entry) => entry.id === stringArg(args, "amostra")) ?? WHATSAPP_SAMPLES[0];
  if (!sample) throw new Error("Nenhuma amostra disponível.");
  const payload = text
    ? buildWhatsAppTextWebhook({ ...target, from: "5511900000505", profileName: "Cliente de demonstração", text })
    : buildWhatsAppSample(sample, target);

  const rawBody = JSON.stringify(payload);
  const signature = args["assinatura-invalida"] ? "sha256=" + "0".repeat(64) : signMetaPayload(rawBody, config.WHATSAPP_APP_SECRET);
  const url = `${stringArg(args, "url") ?? config.APP_URL}/api/webhooks/whatsapp`;

  for (let attempt = 1; attempt <= (args.duplicar ? 2 : 1); attempt += 1) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body: rawBody });
    console.log(`[simulação] envio ${attempt}: HTTP ${response.status} ${await response.text()}`);
  }
  console.log(`[simulação] ${text ? "texto livre" : `amostra "${sample.id}" — ${sample.label}`} → ${url}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
