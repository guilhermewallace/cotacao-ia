import { GenericInboundProvider } from "@/modules/inbox/channels/email/generic";
import { PostmarkInboundProvider } from "@/modules/inbox/channels/email/postmark";
import type { InboundEmailProvider, ParsedEmailAttachment, WebhookRequest } from "@/modules/inbox/channels/email/types";
import type { WebhookResponse } from "@/modules/inbox/channels/whatsapp/handler";
import { ingestInboundMessage } from "@/modules/inbox/ingest";
import { findOrganizationByInboundKey, touchIntegration } from "@/modules/integrations/integrations";
import { webhookContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { env } from "@/platform/env";
import { logger } from "@/platform/logger";

/** Provedores de recebimento de e-mail disponíveis. Registre novos adaptadores aqui. */
const PROVIDERS: Record<string, InboundEmailProvider> = {
  postmark: new PostmarkInboundProvider(),
  generic: new GenericInboundProvider(),
};

export function getInboundEmailProvider(id: string): InboundEmailProvider | null {
  return Object.hasOwn(PROVIDERS, id) ? (PROVIDERS[id] ?? null) : null;
}

/** Extrai o endereço de "Nome <endereco@dominio>". */
export function extractAddress(value: string): string | null {
  const match = /<([^<>\s]+@[^<>\s]+)>/.exec(value) ?? /([^\s<>,;"]+@[^\s<>,;"]+)/.exec(value);
  return match?.[1] ? match[1].toLowerCase() : null;
}

/**
 * Identificador de recebimento da organização a partir dos destinatários.
 * Aceita `chave@dominio` e `qualquercoisa+chave@dominio` (plus addressing).
 */
export function findInboundKey(recipients: string[], inboundDomain: string): string | null {
  const domain = inboundDomain.toLowerCase();
  for (const recipient of recipients) {
    const address = extractAddress(recipient);
    if (!address) continue;
    const [local, host] = address.split("@");
    if (!local || host !== domain) continue;
    const key = local.includes("+") ? local.slice(local.lastIndexOf("+") + 1) : local;
    if (/^[a-z0-9][a-z0-9-]{2,60}$/.test(key)) return key;
  }
  return null;
}

const INLINE_IMAGE_MAX_BYTES = 30 * 1024;

/** Imagens pequenas embutidas no corpo são quase sempre assinaturas e logotipos — não são pedidos. */
function isSignatureImage(attachment: ParsedEmailAttachment): boolean {
  const isImage = (attachment.contentType ?? "").toLowerCase().startsWith("image/");
  return isImage && Boolean(attachment.contentId) && attachment.data.length <= INLINE_IMAGE_MAX_BYTES;
}

export async function handleInboundEmailWebhook(providerId: string, request: WebhookRequest): Promise<WebhookResponse> {
  const log = logger({ channel: "EMAIL", provider: providerId });
  const provider = getInboundEmailProvider(providerId);
  if (!provider) return { status: 404, body: { error: "Provedor de e-mail desconhecido." } };
  if (!provider.isConfigured()) return { status: 503, body: { error: "Provedor de e-mail não configurado no servidor." } };

  if (!provider.authenticate(request)) {
    log.warn("webhook recusado: autenticação inválida");
    return { status: 401, body: { error: "Autenticação inválida." } };
  }

  let email;
  try {
    email = provider.parse(request);
  } catch {
    return { status: 400, body: { error: "Payload inválido." } };
  }

  const key = findInboundKey(email.recipients, env().EMAIL_INBOUND_DOMAIN);
  const target = key ? await findOrganizationByInboundKey(key) : null;
  if (!target) {
    // Endereço desconhecido ou recebimento desativado: confirma (para o provedor não reenviar) e descarta.
    log.warn({ hasKey: Boolean(key) }, "e-mail para endereço de recebimento desconhecido ou inativo");
    return { status: 200, body: { status: "ignored" } };
  }

  const senderAddress = extractAddress(email.from.address);
  const result = await ingestInboundMessage(webhookContext(target.organizationId), {
    channel: "EMAIL",
    externalId: email.messageId,
    integrationId: target.integrationId,
    senderName: email.from.name,
    senderAddress,
    subject: email.subject,
    text: email.text,
    receivedAt: email.date ?? new Date(),
    metadata: { provider: provider.id },
    attachments: email.attachments
      .filter((attachment) => !isSignatureImage(attachment))
      .slice(0, 20)
      .map((attachment) => ({ source: "inline" as const, fileName: attachment.fileName, data: attachment.data })),
  });

  await touchIntegration(tenantDb(target.organizationId), target.integrationId);
  log.info({ organizationId: target.organizationId, messageId: result.messageId, status: result.status }, "e-mail processado");
  return { status: 200, body: { status: result.status } };
}
