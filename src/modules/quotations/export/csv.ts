import type { QuotationExportData } from "@/modules/quotations/export/data";
import { formatDate } from "@/platform/dates";

/**
 * CSV no padrão do Excel brasileiro: separador ";", vírgula decimal e UTF-8 com BOM.
 */

/** Neutraliza fórmulas (CSV injection): células iniciadas por = + - @ recebem apóstrofo. */
export function escapeCsvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function decimal(value: string | null, digits = 2): string {
  if (value === null) return "";
  return Number(value).toFixed(digits).replace(".", ",");
}

export function buildQuotationCsv(data: QuotationExportData): Buffer {
  const { quotation } = data;
  const rows: Array<Array<string | number | null>> = [
    ["Cotação", quotation.number],
    ["Cliente", quotation.customerName],
    ["Data", formatDate(quotation.issueDate)],
    ["Validade", formatDate(quotation.validUntil)],
    [],
    ["Item", "Código", "Descrição", "Unidade", "Quantidade", "Preço unitário", "Desconto %", "Total", "Situação"],
    ...quotation.items.map((item) => [
      item.lineNumber,
      item.sku,
      item.description,
      item.unit,
      decimal(item.quantity, 3).replace(/,?0+$/, ""),
      decimal(item.unitPrice, 4).replace(/(,\d{2}\d*?)0+$/, "$1"),
      decimal(item.discountPercent),
      item.available ? decimal(item.lineTotal) : "",
      item.available ? "Disponível" : "Não atendido",
    ]),
    [],
    ["", "", "", "", "", "", "Subtotal", decimal(quotation.subtotal)],
    ["", "", "", "", "", "", `Desconto (${decimal(quotation.discountPercent)}%)`, decimal(quotation.discountTotal)],
    ["", "", "", "", "", "", "Total", decimal(quotation.total)],
  ];
  const body = rows.map((row) => row.map(escapeCsvCell).join(";")).join("\r\n");
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${body}\r\n`, "utf8")]);
}
