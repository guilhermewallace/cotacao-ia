import { z } from "zod";
import { recordAudit } from "@/modules/audit/audit";
import { assertCan } from "@/modules/identity/permissions";
import { newInboundEmailKey } from "@/modules/integrations/integrations";
import { digitsOnly } from "@/modules/customers/customers";
import type { TenantContext } from "@/modules/tenancy/context";
import { getPrisma } from "@/platform/db";
import { ConflictError, isUniqueViolation, ValidationError } from "@/platform/errors";

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  taxId: string | null;
  defaultQuotationValidityDays: number;
  documentRetentionDays: number | null;
  isDemo: boolean;
}

const select = {
  id: true,
  name: true,
  slug: true,
  legalName: true,
  taxId: true,
  defaultQuotationValidityDays: true,
  documentRetentionDays: true,
  isDemo: true,
} as const;

export async function getOrganization(ctx: TenantContext): Promise<OrganizationView> {
  return getPrisma().organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select });
}

export const organizationSettingsSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da empresa").max(160),
  legalName: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((value) => (value ? value : null)),
  taxId: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((value) => digitsOnly(value)),
  defaultQuotationValidityDays: z.number().int().min(1, "Mínimo de 1 dia").max(365),
  /** Nulo = manter os documentos indefinidamente. */
  documentRetentionDays: z.number().int().min(1, "Mínimo de 1 dia").max(3650).nullable(),
});

export async function updateOrganizationSettings(ctx: TenantContext, input: z.input<typeof organizationSettingsSchema>): Promise<void> {
  assertCan(ctx, "settings:manage");
  const data = organizationSettingsSchema.parse(input);
  if (data.taxId && data.taxId.length !== 14) throw new ValidationError("O CNPJ deve ter 14 dígitos.");

  const before = await getOrganization(ctx);
  await getPrisma().organization.update({ where: { id: ctx.organizationId }, data });
  await recordAudit(ctx, {
    action: "organization.update",
    entityType: "Organization",
    entityId: ctx.organizationId,
    metadata: {
      ...(before.documentRetentionDays !== data.documentRetentionDays
        ? { retentionBefore: before.documentRetentionDays, retentionAfter: data.documentRetentionDays }
        : {}),
    },
  });
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Provisiona uma organização com seu proprietário. Usado pelo script
 * `npm run org:create` e pelo seed — não há autocadastro nesta versão.
 */
export async function createOrganization(input: {
  name: string;
  slug?: string;
  legalName?: string | null;
  ownerEmail: string;
  ownerName: string;
  isDemo?: boolean;
  inboundEmailKey?: string;
}): Promise<{ organizationId: string; ownerId: string }> {
  const slug = slugify(input.slug ?? input.name);
  if (slug.length < 3) throw new ValidationError("Nome de organização inválido.");
  const email = z.email().parse(input.ownerEmail.trim().toLowerCase());
  const prisma = getPrisma();

  try {
    return await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.name.trim(),
          slug,
          legalName: input.legalName ?? null,
          isDemo: input.isDemo ?? false,
          inboundEmailKey: input.inboundEmailKey ?? newInboundEmailKey(slug),
        },
      });
      const owner = (await tx.user.findUnique({ where: { email } })) ?? (await tx.user.create({ data: { email, name: input.ownerName.trim() } }));
      await tx.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorType: "SYSTEM",
          action: "organization.create",
          entityType: "Organization",
          entityId: organization.id,
          metadata: { ownerEmail: email },
        },
      });
      return { organizationId: organization.id, ownerId: owner.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Já existe uma organização com este identificador.");
    throw error;
  }
}
