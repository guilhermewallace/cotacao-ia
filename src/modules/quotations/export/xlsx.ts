import * as XLSX from "xlsx";
import { formatTaxId, STATUS_LABELS, type QuotationExportData } from "@/modules/quotations/export/data";
import { formatDate } from "@/platform/dates";

type Cell = string | number | null;

/**
 * Planilha Excel da cotação. Os textos são gravados como células de texto — o conteúdo
 * nunca é interpretado como fórmula, mesmo que comece com "=".
 */
export function buildQuotationXlsx(data: QuotationExportData): Buffer {
  const { quotation, organization } = data;

  const header: Cell[][] = [
    [organization.name],
    [organization.isDemo ? "DOCUMENTO DE DEMONSTRAÇÃO — DADOS FICTÍCIOS" : null],
    ["Cotação", quotation.number, null, "Situação", STATUS_LABELS[quotation.status]],
    ["Data", formatDate(quotation.issueDate), null, "Validade", formatDate(quotation.validUntil)],
    ["Cliente", quotation.customerName, null, "CNPJ/CPF", formatTaxId(quotation.customerTaxId)],
    ["Contato", quotation.customerContact, null, "E-mail", quotation.customerEmail],
    [],
  ];
  const tableHeader: Cell[] = ["Item", "Código", "Descrição", "Un.", "Quantidade", "Preço unitário", "Desconto %", "Total", "Situação"];
  const lines: Cell[][] = quotation.items.map((item) => [
    item.lineNumber,
    item.sku,
    item.description,
    item.unit,
    Number(item.quantity),
    item.unitPrice === null ? null : Number(item.unitPrice),
    Number(item.discountPercent),
    item.available ? Number(item.lineTotal) : null,
    item.available ? "Disponível" : "Não atendido",
  ]);
  const footer: Cell[][] = [
    [],
    [null, null, null, null, null, null, "Subtotal", Number(quotation.subtotal)],
    [null, null, null, null, null, null, `Desconto (${Number(quotation.discountPercent)}%)`, Number(quotation.discountTotal)],
    [null, null, null, null, null, null, "Total", Number(quotation.total)],
    [],
    ["Condições de pagamento", quotation.paymentTerms],
    ["Prazo de entrega", quotation.deliveryTerms],
    ["Observações", quotation.notes],
  ];

  const rows = [...header, tableHeader, ...lines, ...footer];
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: false });
  sheet["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 58 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 14 }];

  // Formatos numéricos das colunas de quantidade, preço, desconto e total.
  const firstLine = header.length + 1;
  const lastRow = rows.length;
  for (let row = firstLine; row < lastRow; row += 1) {
    for (const [column, format] of [[4, "#,##0.###"], [5, "#,##0.00##"], [6, "0.00"], [7, "#,##0.00"]] as Array<[number, string]>) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
      if (cell && cell.t === "n") cell.z = format;
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Cotação");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}
