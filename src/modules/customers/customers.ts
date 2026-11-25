import { z } from "zod";
import { recordAudit } from "@/modules/audit/audit";
import { assertCan } from "@/modules/identity/permissions";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb, type TenantDbOrTx } from "@/modules/tenancy/tenant-db";
import { ConflictError, isForeignKeyViolation, isUniqueViolation, NotFoundError, ValidationError } from "@/platform/errors";
import { idSchema, parseId } from "@/platform/ids";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/** Mantém apenas dígitos (CNPJ/CPF, telefone). */
export function digitsOnly(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** Telefone em dígitos com DDI. Números brasileiros sem DDI recebem 55. */
export function normalizePhone(value: string | null | undefined): string | null {
  const digits = digitsOnly(value);
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const email = (value ?? "").trim().toLowerCase();
  return email.length > 0 ? email : null;
}

export const customerInputSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cliente").max(160),
  legalName: optionalText(200),
  taxId: optionalText(20).transform((value) => digitsOnly(value)),
  email: optionalText(200).pipe(z.email("E-mail inválido").nullable()),
  phone: optionalText(30).transform((value) => normalizePhone(value)),
  contactName: optionalText(120),
  notes: optionalText(1000),
  priceListId: idSchema.nullish().transform((value) => value ?? null),
});

export type CustomerInput = z.input<typeof customerInputSchema>;

export interface CustomerView {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  notes: string | null;
  priceListId: string | null;
  priceListName: string | null;
  isActive: boolean;
}

function validateTaxId(taxId: string | null): void {
  if (taxId && taxId.length !== 11 && taxId.length !== 14) {
    throw new ValidationError("CNPJ deve ter 14 dígitos (ou CPF, 11 dígitos).");
  }
}

export async function listCustomers(ctx: TenantContext, options: { query?: string; includeInactive?: boolean; limit?: number } = {}): Promise<CustomerView[]> {
  assertCan(ctx, "customer:read");
  const query = options.query?.trim();
  const rows = await tenantDb(ctx.organizationId).customer.findMany({
    where: {
      ...(options.includeInactive ? {} : { isActive: true }),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { legalName: { contains: query, mode: "insensitive" } },
              { email: { contains: query.toLowerCase() } },
              ...(digitsOnly(query) ? [{ taxId: { contains: digitsOnly(query) ?? "" } }, { phone: { contains: digitsOnly(query) ?? "" } }] : []),
            ],
          }
        : {}),
    },
    include: { priceList: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: Math.min(options.limit ?? 200, 500),
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    taxId: row.taxId,
    email: row.email,
    phone: row.phone,
    contactName: row.contactName,
    notes: row.notes,
    priceListId: row.priceListId,
    priceListName: row.priceList?.name ?? null,
    isActive: row.isActive,
  }));
}

export async function createCustomer(ctx: TenantContext, input: CustomerInput): Promise<{ id: string }> {
  assertCan(ctx, "customer:write");
  const data = customerInputSchema.parse(input);
  validateTaxId(data.taxId);
  try {
    return await tenantDb(ctx.organizationId).$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: { organizationId: ctx.organizationId, ...data, email: normalizeEmail(data.email) },
      });
      await recordAudit(ctx, { action: "customer.create", entityType: "Customer", entityId: created.id }, tx);
      return { id: created.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Já existe um cliente com este CNPJ/CPF.");
    if (isForeignKeyViolation(error)) throw new NotFoundError("Lista de preços");
    throw error;
  }
}

export async function updateCustomer(ctx: TenantContext, customerId: string, input: CustomerInput): Promise<void> {
  assertCan(ctx, "customer:write");
  const id = parseId(customerId, "Cliente");
  const data = customerInputSchema.parse(input);
  validateTaxId(data.taxId);
  try {
    await tenantDb(ctx.organizationId).$transaction(async (tx) => {
      const result = await tx.customer.updateMany({ where: { id }, data: { ...data, email: normalizeEmail(data.email) } });
      if (result.count === 0) throw new NotFoundError("Cliente");
      await recordAudit(ctx, { action: "customer.update", entityType: "Customer", entityId: id }, tx);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Já existe um cliente com este CNPJ/CPF.");
    if (isForeignKeyViolation(error)) throw new NotFoundError("Lista de preços");
    throw error;
  }
}

/**
 * Identifica o cliente pelo remetente de uma mensagem (e-mail ou telefone).
 * Só retorna quando há correspondência única — nunca "adivinha" entre vários.
 */
export async function findCustomerBySender(db: TenantDbOrTx, senderAddress: string | null | undefined): Promise<string | null> {
  if (!senderAddress) return null;
  const email = senderAddress.includes("@") ? normalizeEmail(senderAddress) : null;
  const phone = email ? null : normalizePhone(senderAddress);
  if (!email && !phone) return null;

  const matches = await db.customer.findMany({
    where: { isActive: true, ...(email ? { email } : { phone: phone ?? undefined }) },
    select: { id: true },
    take: 2,
  });
  return matches.length === 1 && matches[0] ? matches[0].id : null;
}
