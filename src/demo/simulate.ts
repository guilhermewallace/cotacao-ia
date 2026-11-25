import { randomUUID } from "node:crypto";
import { DEMO_CUSTOMERS, DEMO_ORG, EMAIL_INCOMPLETE_TEXT, WHATSAPP_INCOMPATIBLE_TEXT } from "@/demo/scenarios";
import { assertCan } from "@/modules/identity/permissions";
import { GENERIC_SIGNATURE_HEADER, signGenericEmailPayload, type GenericEmailPayload } from "@/modules/inbox/channels/email/generic";
import { handleInboundEmailWebhook } from "@/modules/inbox/channels/email/handler";
import { handleWhatsAppWebhook } from "@/modules/inbox/channels/whatsapp/handler";
import { signMetaPayload } from "@/modules/inbox/channels/whatsapp/signature";
import { inboundAddress } from "@/modules/integrations/integrations";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { getPrisma } from "@/platform/db";
import { env } from "@/platform/env";
import { AppError, ForbiddenError } from "@/platform/errors";

/**
 * SIMULADOR LOCAL de canais (somente demonstração).
 *
 * Monta notificações no MESMO formato enviado pela Meta (WhatsApp Cloud API) e pelo
 * provedor de e-mail, assina com os segredos locais e entrega aos handlers reais de
 * webhook. Exercita, portanto, todo o caminho de produção — validação de assinatura,
 * roteamento por organização, idempotência e pipeline — sem falar com nenhum serviço externo.
 *
 * Nenhuma mensagem é enviada ou recebida de verdade: os remetentes são clientes fictícios.
 */

export interface SimulatedSample {
  id: string;
  label: string;
  customerKey: string;
  subject?: string;
  text: string;
}

export const WHATSAPP_SAMPLES: SimulatedSample[] = [
  {
    id: "wa-quadro",
    label: "Lista curta para quadro de distribuição",
    customerKey: "luzforca",
    text: "Boa tarde! Pode me passar preço?\n- 6 disjuntor monopolar 20A curva C\n- 2 disjuntor bipolar 40A curva C\n- 1 IDR bipolar 40A 30mA\n- 100m cabo flexível 4mm preto\n- 12 tomada 2P+T 10A branca",
  },
  { id: "wa-incompativel", label: "Pedido com especificações sem equivalente no catálogo", customerKey: "luzforca", text: WHATSAPP_INCOMPATIBLE_TEXT },
  {
    id: "wa-automacao",
    label: "Itens de automação com códigos de fabricante",
    customerKey: "serra",
    text: "Bom dia, preciso de:\n2 inversor de frequência 3CV 380V trifásico\n4 contator 25A bobina 220V\n3 relé térmico 17-25A\n10 botão de emergência",
  },
];

export const EMAIL_SAMPLES: SimulatedSample[] = [
  {
    id: "mail-obra",
    label: "Pedido por e-mail com itens no corpo",
    customerKey: "horizonte",
    subject: "Cotação — reposição de obra",
    text: "Prezados,\n\nFavor cotar os itens abaixo:\n\n30 un Tomada 2P+T 10A 250V branca\n15 un Interruptor simples 10A branco\n200 m Cabo flexível 2,5mm² vermelho\n20 barras Eletroduto PVC rígido roscável 3/4\"\n\nAtenciosamente,\nMarina Duarte\nConstrutora Horizonte Azul",
  },
  { id: "mail-incompleto", label: "Pedido com informações incompletas", customerKey: "valenorte", subject: "Orçamento de materiais", text: EMAIL_INCOMPLETE_TEXT },
];

function customerOf(sample: SimulatedSample) {
  const customer = DEMO_CUSTOMERS.find((entry) => entry.key === sample.customerKey) ?? DEMO_CUSTOMERS[0];
  if (!customer) throw new Error("Clientes de demonstração não definidos");
  return customer;
}

/** Notificação de mensagem de texto no formato do webhook da WhatsApp Cloud API. */
export function buildWhatsAppTextWebhook(input: {
  phoneNumberId: string;
  displayPhoneNumber: string;
  from: string;
  profileName: string;
  text: string;
  messageId?: string;
  timestamp?: number;
}): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "000000000000000",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: input.displayPhoneNumber.replace(/\D/g, ""), phone_number_id: input.phoneNumberId },
              contacts: [{ profile: { name: input.profileName }, wa_id: input.from }],
              messages: [
                {
                  from: input.from,
                  id: input.messageId ?? `wamid.SIMULADO.${randomUUID()}`,
                  timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: input.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function buildWhatsAppSample(sample: SimulatedSample, target: { phoneNumberId: string; displayPhoneNumber: string }): Record<string, unknown> {
  const customer = customerOf(sample);
  return buildWhatsAppTextWebhook({ ...target, from: customer.phone, profileName: customer.contactName, text: sample.text });
}

/** E-mail de entrada no formato do adaptador genérico (JSON assinado por HMAC). */
export function buildEmailSample(
  sample: SimulatedSample,
  to: string,
  attachments: NonNullable<GenericEmailPayload["attachments"]> = [],
): GenericEmailPayload {
  const customer = customerOf(sample);
  return {
    messageId: `<simulado-${randomUUID()}@cotacao-ia.example>`,
    from: { address: customer.email, name: customer.contactName },
    to: [to],
    subject: sample.subject ?? "Pedido de cotação",
    text: sample.text,
    date: new Date().toISOString(),
    attachments,
  };
}

async function assertDemoOrganization(ctx: TenantContext): Promise<{ inboundEmailKey: string }> {
  assertCan(ctx, "integrations:manage");
  const organization = await getPrisma().organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { isDemo: true, inboundEmailKey: true },
  });
  if (!organization.isDemo) throw new ForbiddenError("O simulador só está disponível em organizações de demonstração.");
  return organization;
}

function pick(samples: SimulatedSample[], sampleId?: string): SimulatedSample {
  const sample = (sampleId ? samples.find((entry) => entry.id === sampleId) : undefined) ?? samples[Math.floor(Math.random() * samples.length)];
  if (!sample) throw new Error("Nenhuma amostra de simulação disponível");
  return sample;
}

export async function simulateWhatsAppMessage(ctx: TenantContext, sampleId?: string): Promise<{ sample: string }> {
  await assertDemoOrganization(ctx);
  const secret = env().WHATSAPP_APP_SECRET;
  if (!secret) throw new AppError("INTEGRATION_NOT_CONFIGURED", "Defina WHATSAPP_APP_SECRET no .env para usar o simulador (qualquer valor local serve).");

  const integration = await tenantDb(ctx.organizationId).integration.findFirst({
    where: { type: "WHATSAPP_CLOUD", status: "ACTIVE" },
    select: { externalAccountId: true, config: true },
  });
  if (!integration?.externalAccountId) throw new AppError("INTEGRATION_NOT_CONFIGURED", "A integração de WhatsApp desta organização não está ativa.");
  if ((integration.config as { simulated?: boolean } | null)?.simulated !== true) {
    throw new ForbiddenError("Esta organização tem uma integração real de WhatsApp configurada; o simulador foi desativado.");
  }

  const sample = pick(WHATSAPP_SAMPLES, sampleId);
  const rawBody = Buffer.from(JSON.stringify(buildWhatsAppSample(sample, { phoneNumberId: integration.externalAccountId, displayPhoneNumber: DEMO_ORG.whatsAppDisplayNumber })));
  const response = await handleWhatsAppWebhook({ rawBody, signature: signMetaPayload(rawBody, secret) });
  if (response.status !== 200) throw new AppError("INTERNAL", "O webhook simulado foi recusado.");
  return { sample: sample.label };
}

export async function simulateInboundEmail(ctx: TenantContext, sampleId?: string): Promise<{ sample: string }> {
  const organization = await assertDemoOrganization(ctx);
  const secret = env().EMAIL_WEBHOOK_SECRET;
  if (!secret) throw new AppError("INTEGRATION_NOT_CONFIGURED", "Defina EMAIL_WEBHOOK_SECRET no .env para usar o simulador (qualquer valor local serve).");

  const sample = pick(EMAIL_SAMPLES, sampleId);
  const rawBody = Buffer.from(JSON.stringify(buildEmailSample(sample, inboundAddress(organization.inboundEmailKey))));
  const headers = new Headers({ "content-type": "application/json", [GENERIC_SIGNATURE_HEADER]: signGenericEmailPayload(rawBody, secret) });
  const response = await handleInboundEmailWebhook("generic", { headers, rawBody });
  if (response.status !== 200) throw new AppError("INTERNAL", "O webhook simulado foi recusado.");
  if (typeof response.body === "object" && response.body.status === "ignored") {
    throw new AppError("CONFLICT", "O recebimento por e-mail está desativado nesta organização. Ative-o para simular.");
  }
  return { sample: sample.label };
}
