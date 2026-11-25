import { z } from "zod";
import type { IntegrationStatus, IntegrationType } from "@/generated/prisma/enums";
import { recordAudit } from "@/modules/audit/audit";
import { assertCan } from "@/modules/identity/permissions";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb, type TenantDbOrTx } from "@/modules/tenancy/tenant-db";
import { decryptJson, encryptJson, maskSecret, randomToken } from "@/platform/crypto";
import { getPrisma } from "@/platform/db";
import { env } from "@/platform/env";
import { ConflictError, isUniqueViolation, ValidationError } from "@/platform/errors";

/**
 * Integrações por organização. Credenciais são cifradas (AES-256-GCM) antes de
 * chegar ao banco e nunca retornam à interface — apenas uma máscara.
 */

interface WhatsAppCredentials {
  accessToken: string;
}

function credentialsContext(organizationId: string, type: IntegrationType): string {
  return `integration:${organizationId}:${type}`;
}

// ───────────────────────────── WhatsApp ─────────────────────────────

export const whatsAppIntegrationSchema = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, "O ID do número de telefone (Phone Number ID) deve conter apenas dígitos"),
  displayPhoneNumber: z.string().trim().max(30).optional(),
  businessAccountId: z
    .string()
    .trim()
    .regex(/^\d{0,25}$/, "O ID da conta WhatsApp Business deve conter apenas dígitos")
    .optional(),
  /** Token de acesso (usuário do sistema). Em branco mantém o token já salvo. */
  accessToken: z.string().trim().max(1000).optional(),
});

export interface WhatsAppIntegrationView {
  configured: boolean;
  status: IntegrationStatus | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  businessAccountId: string | null;
  accessTokenMask: string | null;
  lastEventAt: Date | null;
  lastError: string | null;
  /** O servidor tem App Secret e Verify Token configurados? Sem eles, webhooks são recusados. */
  serverReady: boolean;
  webhookUrl: string;
  /** Integração criada pelo seed de demonstração: não há conexão real com a Meta. */
  simulated: boolean;
}

export async function getWhatsAppIntegration(ctx: TenantContext): Promise<WhatsAppIntegrationView> {
  assertCan(ctx, "integrations:manage");
  const config = env();
  const row = await tenantDb(ctx.organizationId).integration.findFirst({ where: { type: "WHATSAPP_CLOUD" } });
  const settings = (row?.config ?? {}) as { displayPhoneNumber?: string; businessAccountId?: string; simulated?: boolean };

  let accessTokenMask: string | null = null;
  if (row?.credentialsEncrypted) {
    try {
      const credentials = decryptJson<WhatsAppCredentials>(row.credentialsEncrypted, credentialsContext(ctx.organizationId, "WHATSAPP_CLOUD"));
      accessTokenMask = maskSecret(credentials.accessToken);
    } catch {
      accessTokenMask = "(não foi possível decifrar — salve o token novamente)";
    }
  }

  return {
    configured: Boolean(row),
    status: row?.status ?? null,
    phoneNumberId: row?.externalAccountId ?? null,
    displayPhoneNumber: settings.displayPhoneNumber ?? null,
    businessAccountId: settings.businessAccountId ?? null,
    accessTokenMask,
    lastEventAt: row?.lastEventAt ?? null,
    lastError: row?.lastError ?? null,
    serverReady: Boolean(config.WHATSAPP_APP_SECRET && config.WHATSAPP_VERIFY_TOKEN),
    webhookUrl: `${config.APP_URL}/api/webhooks/whatsapp`,
    simulated: settings.simulated === true,
  };
}

export async function saveWhatsAppIntegration(ctx: TenantContext, input: z.input<typeof whatsAppIntegrationSchema>): Promise<void> {
  assertCan(ctx, "integrations:manage");
  const data = whatsAppIntegrationSchema.parse(input);
  const context = credentialsContext(ctx.organizationId, "WHATSAPP_CLOUD");

  try {
    await tenantDb(ctx.organizationId).$transaction(async (tx) => {
      const existing = await tx.integration.findFirst({ where: { type: "WHATSAPP_CLOUD" } });
      if (!existing && !data.accessToken) throw new ValidationError("Informe o token de acesso.");

      const credentialsEncrypted = data.accessToken
        ? encryptJson({ accessToken: data.accessToken } satisfies WhatsAppCredentials, context)
        : (existing?.credentialsEncrypted ?? null);
      const values = {
        status: "ACTIVE" as const,
        externalAccountId: data.phoneNumberId,
        displayName: data.displayPhoneNumber || null,
        config: { displayPhoneNumber: data.displayPhoneNumber || null, businessAccountId: data.businessAccountId || null },
        credentialsEncrypted,
        lastError: null,
      };

      if (existing) await tx.integration.update({ where: { id: existing.id }, data: values });
      else await tx.integration.create({ data: { organizationId: ctx.organizationId, type: "WHATSAPP_CLOUD", ...values } });

      await recordAudit(
        ctx,
        {
          action: data.accessToken ? "integration.credentials_update" : "integration.update",
          entityType: "Integration",
          entityId: existing?.id ?? null,
          metadata: { type: "WHATSAPP_CLOUD", phoneNumberId: data.phoneNumberId },
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Este número do WhatsApp já está vinculado a outra organização.");
    throw error;
  }
}

export async function disconnectWhatsAppIntegration(ctx: TenantContext): Promise<void> {
  assertCan(ctx, "integrations:manage");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    await tx.integration.updateMany({
      where: { type: "WHATSAPP_CLOUD" },
      data: { status: "INACTIVE", credentialsEncrypted: null, externalAccountId: null },
    });
    await recordAudit(ctx, { action: "integration.disconnect", entityType: "Integration", metadata: { type: "WHATSAPP_CLOUD" } }, tx);
  });
}

/** Token de acesso decifrado, para uso exclusivo do worker ao baixar mídias. */
export async function getWhatsAppAccessToken(db: TenantDbOrTx, organizationId: string, integrationId: string): Promise<string | null> {
  const row = await db.integration.findUnique({ where: { id: integrationId }, select: { credentialsEncrypted: true, type: true } });
  if (!row?.credentialsEncrypted || row.type !== "WHATSAPP_CLOUD") return null;
  try {
    return decryptJson<WhatsAppCredentials>(row.credentialsEncrypted, credentialsContext(organizationId, "WHATSAPP_CLOUD")).accessToken;
  } catch {
    return null;
  }
}

/**
 * Roteamento de webhooks: descobre a organização dona de um número do WhatsApp.
 * É a única consulta entre organizações do módulo — o remetente já foi autenticado
 * pela assinatura da Meta antes de chegar aqui.
 */
export async function findActiveWhatsAppIntegration(phoneNumberId: string): Promise<{ id: string; organizationId: string } | null> {
  return getPrisma().integration.findFirst({
    where: { type: "WHATSAPP_CLOUD", externalAccountId: phoneNumberId, status: "ACTIVE" },
    select: { id: true, organizationId: true },
  });
}

export async function touchIntegration(db: TenantDbOrTx, integrationId: string, error?: string | null): Promise<void> {
  await db.integration.updateMany({
    where: { id: integrationId },
    data: error ? { lastError: error.slice(0, 500), status: "ERROR" } : { lastEventAt: new Date(), lastError: null, status: "ACTIVE" },
  });
}

// ───────────────────────────── E-mail ─────────────────────────────

export interface EmailIntegrationView {
  enabled: boolean;
  address: string;
  lastEventAt: Date | null;
  providers: Array<{ id: string; label: string; configured: boolean; webhookUrl: string }>;
  /** Integração criada pelo seed de demonstração: nenhum provedor de e-mail real está ligado. */
  simulated: boolean;
}

export function inboundAddress(inboundEmailKey: string): string {
  return `${inboundEmailKey}@${env().EMAIL_INBOUND_DOMAIN}`;
}

export function newInboundEmailKey(slug: string): string {
  const base = slug.replace(/[^a-z0-9]/g, "").slice(0, 20) || "cotacoes";
  return `${base}-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

export async function getEmailIntegration(ctx: TenantContext): Promise<EmailIntegrationView> {
  assertCan(ctx, "integrations:manage");
  const config = env();
  const [organization, row] = await Promise.all([
    getPrisma().organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { inboundEmailKey: true } }),
    tenantDb(ctx.organizationId).integration.findFirst({ where: { type: "EMAIL_INBOUND" } }),
  ]);
  return {
    enabled: row?.status === "ACTIVE",
    address: inboundAddress(organization.inboundEmailKey),
    lastEventAt: row?.lastEventAt ?? null,
    simulated: (row?.config as { simulated?: boolean } | null)?.simulated === true,
    providers: [
      {
        id: "postmark",
        label: "Postmark Inbound",
        configured: Boolean(config.POSTMARK_WEBHOOK_USER && config.POSTMARK_WEBHOOK_PASSWORD),
        webhookUrl: `${config.APP_URL}/api/webhooks/email/postmark`,
      },
      {
        id: "generic",
        label: "Webhook genérico assinado (HMAC)",
        configured: Boolean(config.EMAIL_WEBHOOK_SECRET),
        webhookUrl: `${config.APP_URL}/api/webhooks/email/generic`,
      },
    ],
  };
}

export async function setEmailIntegrationEnabled(ctx: TenantContext, enabled: boolean): Promise<void> {
  assertCan(ctx, "integrations:manage");
  await tenantDb(ctx.organizationId).$transaction(async (tx) => {
    const existing = await tx.integration.findFirst({ where: { type: "EMAIL_INBOUND" } });
    const status = enabled ? ("ACTIVE" as const) : ("INACTIVE" as const);
    if (existing) await tx.integration.update({ where: { id: existing.id }, data: { status, lastError: null } });
    else await tx.integration.create({ data: { organizationId: ctx.organizationId, type: "EMAIL_INBOUND", status } });
    await recordAudit(ctx, { action: enabled ? "integration.enable" : "integration.disable", entityType: "Integration", metadata: { type: "EMAIL_INBOUND" } }, tx);
  });
}

/** Gera um novo endereço de recebimento; o anterior deixa de funcionar imediatamente. */
export async function rotateInboundEmailKey(ctx: TenantContext): Promise<string> {
  assertCan(ctx, "integrations:manage");
  const organization = await getPrisma().organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { slug: true } });
  const key = newInboundEmailKey(organization.slug);
  await getPrisma().organization.update({ where: { id: ctx.organizationId }, data: { inboundEmailKey: key } });
  await recordAudit(ctx, { action: "integration.email_address_rotate", entityType: "Organization", entityId: ctx.organizationId });
  return inboundAddress(key);
}

/** Roteamento de e-mails: organização com recebimento ativo para a chave do endereço. */
export async function findOrganizationByInboundKey(key: string): Promise<{ organizationId: string; integrationId: string } | null> {
  const organization = await getPrisma().organization.findUnique({
    where: { inboundEmailKey: key.toLowerCase() },
    select: { id: true, integrations: { where: { type: "EMAIL_INBOUND", status: "ACTIVE" }, select: { id: true } } },
  });
  const integration = organization?.integrations[0];
  return organization && integration ? { organizationId: organization.id, integrationId: integration.id } : null;
}
