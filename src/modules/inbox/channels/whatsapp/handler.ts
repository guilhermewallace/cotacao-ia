import { parseWhatsAppWebhook } from "@/modules/inbox/channels/whatsapp/payload";
import { verifyMetaSignature } from "@/modules/inbox/channels/whatsapp/signature";
import { ingestInboundMessage } from "@/modules/inbox/ingest";
import { findActiveWhatsAppIntegration, touchIntegration } from "@/modules/integrations/integrations";
import { webhookContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { safeEqual } from "@/platform/crypto";
import { env } from "@/platform/env";
import { logger } from "@/platform/logger";

/**
 * Webhook da WhatsApp Business Cloud API (API oficial da Meta).
 *
 * - GET: verificação do endpoint (hub.challenge).
 * - POST: mensagens e status de mensagens, com validação de assinatura.
 *
 * A resposta é rápida: mídias NÃO são baixadas aqui — apenas registradas para o
 * worker. Entregas repetidas da mesma mensagem (a Meta reenvia em caso de falha)
 * são reconhecidas pelo ID da mensagem e ignoradas.
 */

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown> | string;
}

export function handleWhatsAppVerification(params: URLSearchParams): WebhookResponse {
  const expected = env().WHATSAPP_VERIFY_TOKEN;
  if (!expected) return { status: 503, body: { error: "Integração com WhatsApp não configurada no servidor." } };

  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";
  if (mode === "subscribe" && safeEqual(token, expected) && /^[\w.-]{1,200}$/.test(challenge)) {
    return { status: 200, body: challenge };
  }
  return { status: 403, body: { error: "Token de verificação inválido." } };
}

export async function handleWhatsAppWebhook(input: { rawBody: Buffer; signature: string | null }): Promise<WebhookResponse> {
  const log = logger({ channel: "WHATSAPP" });
  const appSecret = env().WHATSAPP_APP_SECRET;
  if (!appSecret) return { status: 503, body: { error: "Integração com WhatsApp não configurada no servidor." } };

  if (!verifyMetaSignature(input.rawBody, input.signature, appSecret)) {
    log.warn("webhook recusado: assinatura inválida");
    return { status: 401, body: { error: "Assinatura inválida." } };
  }

  let parsed;
  try {
    parsed = parseWhatsAppWebhook(JSON.parse(input.rawBody.toString("utf8")));
  } catch {
    return { status: 400, body: { error: "Payload inválido." } };
  }

  const integrations = new Map<string, { id: string; organizationId: string } | null>();
  const integrationFor = async (phoneNumberId: string) => {
    if (!integrations.has(phoneNumberId)) integrations.set(phoneNumberId, await findActiveWhatsAppIntegration(phoneNumberId));
    return integrations.get(phoneNumberId) ?? null;
  };

  const summary = { received: 0, duplicates: 0, statuses: 0, unrouted: 0, ignored: parsed.ignored };

  for (const message of parsed.messages) {
    const integration = await integrationFor(message.phoneNumberId);
    if (!integration) {
      // Número não vinculado a nenhuma organização: confirma o recebimento (para a Meta não reenviar) e descarta.
      summary.unrouted += 1;
      log.warn({ phoneNumberId: message.phoneNumberId }, "mensagem para número não vinculado");
      continue;
    }
    const result = await ingestInboundMessage(webhookContext(integration.organizationId), {
      channel: "WHATSAPP",
      externalId: message.externalId,
      integrationId: integration.id,
      senderName: message.senderName,
      senderAddress: message.from,
      text: message.text,
      receivedAt: message.receivedAt,
      metadata: { messageType: message.type },
      attachments: message.attachments,
    });
    if (result.status === "duplicate") summary.duplicates += 1;
    else summary.received += 1;
  }

  for (const status of parsed.statuses) {
    const integration = await integrationFor(status.phoneNumberId);
    if (!integration) {
      summary.unrouted += 1;
      continue;
    }
    const created = await tenantDb(integration.organizationId).channelEvent.createMany({
      data: [
        {
          organizationId: integration.organizationId,
          integrationId: integration.id,
          channel: "WHATSAPP",
          eventType: `message.${status.status}`,
          externalId: `${status.messageId}:${status.status}`,
          occurredAt: status.occurredAt,
          payload: { recipient: status.recipient, errors: status.errors },
        },
      ],
      skipDuplicates: true,
    });
    // Reentrega do mesmo evento de status: a chave única (organização, canal, id externo) evita duplicar.
    if (created.count === 0) summary.duplicates += 1;
    else summary.statuses += created.count;
  }

  for (const integration of integrations.values()) {
    if (integration) await touchIntegration(tenantDb(integration.organizationId), integration.id);
  }

  log.info(summary, "webhook processado");
  return { status: 200, body: summary };
}
