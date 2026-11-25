import PDFDocument from "pdfkit";
import { formatDecimal, formatMoney, formatTaxId, type QuotationExportData } from "@/modules/quotations/export/data";
import { formatDate } from "@/platform/dates";

/**
 * PDF da cotação comercial (A4), gerado no servidor com PDFKit.
 * Usa as fontes padrão do PDF (Helvetica), que cobrem o alfabeto português.
 */

const PAGE = { width: 595.28, height: 841.89, margin: 40 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const COLORS = { text: "#111827", muted: "#6b7280", line: "#e5e7eb", header: "#f3f4f6", accent: "#1d4ed8", warning: "#b45309" };

const REPLACEMENTS: Record<string, string> = { "“": '"', "”": '"', "‘": "'", "’": "'", "–": "-", "—": "-", "…": "...", "•": "-", "≥": ">=", "≤": "<=", " ": " " };

/** As fontes padrão do PDF só cobrem Latin-1: caracteres fora dele são substituídos. */
export function pdfSafeText(value: string | null | undefined): string {
  if (!value) return "";
  return [...value].map((char) => REPLACEMENTS[char] ?? ((char.codePointAt(0) ?? 0) <= 0xff ? char : "?")).join("");
}

interface Column {
  label: string;
  width: number;
  align: "left" | "right" | "center";
}

const COLUMNS: Column[] = [
  { label: "#", width: 22, align: "center" },
  { label: "Código", width: 72, align: "left" },
  { label: "Descrição", width: 199.28, align: "left" },
  { label: "Un.", width: 30, align: "center" },
  { label: "Qtd.", width: 46, align: "right" },
  { label: "Preço unit.", width: 62, align: "right" },
  { label: "Desc.%", width: 34, align: "right" },
  { label: "Total", width: 50, align: "right" },
];

export async function buildQuotationPdf(data: QuotationExportData): Promise<Buffer> {
  const { quotation, organization } = data;
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE.margin,
    bufferPages: true,
    info: { Title: `Cotação ${quotation.number}`, Author: pdfSafeText(organization.name), Creator: "Cotação IA" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const bottomLimit = PAGE.height - PAGE.margin - 30;
  const ensureSpace = (height: number, onNewPage?: () => void) => {
    if (doc.y + height > bottomLimit) {
      doc.addPage();
      onNewPage?.();
    }
  };

  // ── Cabeçalho ────────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(16).fillColor(COLORS.text).text(pdfSafeText(organization.name), PAGE.margin, PAGE.margin, { width: CONTENT_WIDTH * 0.6 });
  doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted);
  if (organization.legalName) doc.text(pdfSafeText(organization.legalName), { width: CONTENT_WIDTH * 0.6 });
  if (organization.taxId) doc.text(`CNPJ ${formatTaxId(organization.taxId)}`);
  const leftBottom = doc.y;

  const rightX = PAGE.margin + CONTENT_WIDTH * 0.62;
  const rightWidth = CONTENT_WIDTH * 0.38;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.muted).text("COTAÇÃO", rightX, PAGE.margin, { width: rightWidth, align: "right" });
  doc.font("Helvetica-Bold").fontSize(15).fillColor(COLORS.text).text(quotation.number, rightX, doc.y, { width: rightWidth, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.text);
  doc.text(`Data: ${formatDate(quotation.issueDate)}`, rightX, doc.y + 2, { width: rightWidth, align: "right" });
  doc.text(`Válida até: ${formatDate(quotation.validUntil)}`, rightX, doc.y, { width: rightWidth, align: "right" });
  if (quotation.status !== "FINALIZED") {
    doc.font("Helvetica-Bold").fillColor(COLORS.warning).text(quotation.status === "DRAFT" ? "RASCUNHO" : "CANCELADA", rightX, doc.y + 2, { width: rightWidth, align: "right" });
  }
  doc.y = Math.max(leftBottom, doc.y) + 10;

  if (organization.isDemo) {
    const y = doc.y;
    doc.rect(PAGE.margin, y, CONTENT_WIDTH, 16).fill("#fef3c7");
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.warning).text("DOCUMENTO DE DEMONSTRAÇÃO — EMPRESA, CLIENTE, PRODUTOS E PREÇOS FICTÍCIOS", PAGE.margin, y + 4.5, { width: CONTENT_WIDTH, align: "center" });
    doc.y = y + 24;
  }

  // ── Cliente ──────────────────────────────────────────────────────────────
  doc.moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + CONTENT_WIDTH, doc.y).strokeColor(COLORS.line).lineWidth(1).stroke();
  doc.y += 8;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.muted).text("CLIENTE", PAGE.margin, doc.y);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.text).text(pdfSafeText(quotation.customerName), PAGE.margin, doc.y + 2, { width: CONTENT_WIDTH });
  const customerLines = [
    quotation.customerTaxId ? `CNPJ/CPF: ${formatTaxId(quotation.customerTaxId)}` : null,
    quotation.customerContact ? `Contato: ${quotation.customerContact}` : null,
    quotation.customerEmail ? `E-mail: ${quotation.customerEmail}` : null,
    quotation.customerPhone ? `Telefone: ${quotation.customerPhone}` : null,
  ].filter((line): line is string => Boolean(line));
  if (customerLines.length > 0) {
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.text).text(pdfSafeText(customerLines.join("   |   ")), PAGE.margin, doc.y + 2, { width: CONTENT_WIDTH });
  }
  doc.y += 12;

  // ── Tabela de itens ──────────────────────────────────────────────────────
  const drawTableHeader = () => {
    const y = doc.y;
    doc.rect(PAGE.margin, y, CONTENT_WIDTH, 18).fill(COLORS.header);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.text);
    let x = PAGE.margin;
    for (const column of COLUMNS) {
      doc.text(column.label, x + 3, y + 5.5, { width: column.width - 6, align: column.align, lineBreak: false });
      x += column.width;
    }
    doc.y = y + 18;
  };

  const drawRow = (cells: string[], options: { muted?: boolean } = {}) => {
    doc.font("Helvetica").fontSize(8.5);
    const heights = cells.map((cell, index) => doc.heightOfString(cell, { width: (COLUMNS[index]?.width ?? 50) - 6 }));
    const rowHeight = Math.max(...heights, 10) + 8;
    ensureSpace(rowHeight, drawTableHeader);
    const y = doc.y;
    doc.fillColor(options.muted ? COLORS.muted : COLORS.text);
    let x = PAGE.margin;
    cells.forEach((cell, index) => {
      const column = COLUMNS[index];
      if (!column) return;
      doc.text(cell, x + 3, y + 4, { width: column.width - 6, align: column.align });
      x += column.width;
    });
    doc.moveTo(PAGE.margin, y + rowHeight).lineTo(PAGE.margin + CONTENT_WIDTH, y + rowHeight).strokeColor(COLORS.line).lineWidth(0.5).stroke();
    doc.y = y + rowHeight;
  };

  const available = quotation.items.filter((item) => item.available);
  const unavailable = quotation.items.filter((item) => !item.available);

  drawTableHeader();
  available.forEach((item, index) => {
    drawRow([
      String(index + 1),
      pdfSafeText(item.sku ?? ""),
      pdfSafeText(item.notes ? `${item.description}\n${item.notes}` : item.description),
      pdfSafeText(item.unit ?? ""),
      formatDecimal(item.quantity),
      item.unitPrice === null ? "a informar" : formatMoney(item.unitPrice).replace("R$", "").trim(),
      Number(item.discountPercent) > 0 ? formatDecimal(item.discountPercent, 2) : "",
      item.unitPrice === null ? "" : formatMoney(item.lineTotal).replace("R$", "").trim(),
    ]);
  });
  if (available.length === 0) drawRow(["", "", "Nenhum item disponível.", "", "", "", "", ""], { muted: true });

  // ── Totais ───────────────────────────────────────────────────────────────
  ensureSpace(70);
  doc.y += 8;
  const totalsX = PAGE.margin + CONTENT_WIDTH - 210;
  const totalLine = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor(COLORS.text);
    doc.text(label, totalsX, y, { width: 110, align: "right", lineBreak: false });
    doc.text(value, totalsX + 115, y, { width: 95, align: "right", lineBreak: false });
    doc.y = y + (bold ? 17 : 14);
  };
  totalLine("Subtotal", formatMoney(quotation.subtotal));
  if (Number(quotation.discountTotal) > 0) totalLine(`Desconto (${formatDecimal(quotation.discountPercent, 2)}%)`, `- ${formatMoney(quotation.discountTotal)}`);
  doc.moveTo(totalsX + 20, doc.y).lineTo(PAGE.margin + CONTENT_WIDTH, doc.y).strokeColor(COLORS.line).lineWidth(1).stroke();
  doc.y += 5;
  totalLine("Total", formatMoney(quotation.total), true);

  // ── Itens não atendidos ──────────────────────────────────────────────────
  const section = (title: string) => {
    ensureSpace(40);
    doc.y += 10;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.muted).text(title.toUpperCase(), PAGE.margin, doc.y);
    doc.y += 3;
  };
  if (unavailable.length > 0) {
    section("Itens solicitados não atendidos");
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.text);
    for (const item of unavailable) {
      ensureSpace(14);
      doc.text(pdfSafeText(`- ${item.description} (${formatDecimal(item.quantity)}${item.unit ? ` ${item.unit}` : ""})`), PAGE.margin, doc.y, { width: CONTENT_WIDTH });
    }
  }

  // ── Condições e observações ──────────────────────────────────────────────
  for (const [title, value] of [
    ["Condições de pagamento", quotation.paymentTerms],
    ["Prazo de entrega", quotation.deliveryTerms],
    ["Observações", quotation.notes],
  ] as Array<[string, string | null]>) {
    if (!value) continue;
    section(title);
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.text).text(pdfSafeText(value), PAGE.margin, doc.y, { width: CONTENT_WIDTH });
  }

  // ── Rodapé com numeração ─────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    // Sem margem inferior, escrever no rodapé não dispara a criação de uma nova página.
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(COLORS.muted);
    doc.text(
      pdfSafeText(`Cotação ${quotation.number} · ${organization.name} · Página ${index + 1} de ${range.count}`),
      PAGE.margin,
      PAGE.height - PAGE.margin - 8,
      { width: CONTENT_WIDTH, align: "center", lineBreak: false },
    );
  }

  doc.end();
  return finished;
}
