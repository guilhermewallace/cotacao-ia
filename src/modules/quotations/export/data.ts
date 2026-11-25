import { recordAuditSafely } from "@/modules/audit/audit";
import { getQuotation, type QuotationView } from "@/modules/quotations/service";
import type { TenantContext } from "@/modules/tenancy/context";
import { getPrisma } from "@/platform/db";

export interface QuotationExportData {
  organization: { name: string; legalName: string | null; taxId: string | null; isDemo: boolean };
  quotation: QuotationView;
}

export type ExportFormat = "pdf" | "xlsx" | "csv";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
};

/** Carrega a cotação (com verificação de permissão e de organização) e registra a exportação. */
export async function loadQuotationExportData(ctx: TenantContext, quotationId: string, format: ExportFormat): Promise<QuotationExportData> {
  const quotation = await getQuotation(ctx, quotationId);
  const organization = await getPrisma().organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { name: true, legalName: true, taxId: true, isDemo: true },
  });
  await recordAuditSafely(ctx, { action: "quotation.export", entityType: "Quotation", entityId: quotation.id, metadata: { number: quotation.number, format } });
  return { organization, quotation };
}

export function exportFileName(data: QuotationExportData, format: ExportFormat): string {
  return `${data.quotation.number}.${format}`;
}

export function formatMoney(value: string | number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

export function formatDecimal(value: string | number, maximumFractionDigits = 3): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits }).format(Number(value));
}

/** CNPJ/CPF com máscara, quando tiver o tamanho esperado. */
export function formatTaxId(value: string | null): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return value;
}

export const STATUS_LABELS = { DRAFT: "Rascunho", FINALIZED: "Finalizada", CANCELED: "Cancelada" } as const;
