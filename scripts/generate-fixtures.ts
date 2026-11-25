/**
 * Gera os documentos de exemplo do ambiente de demonstração em demo/fixtures:
 *   - pedido-cotacao-horizonte-azul.pdf   (PDF com texto)
 *   - lista-materiais-serra-verde.xlsx    (planilha com cabeçalho)
 *   - pedido-condominio-acacias.csv       (CSV no padrão do Excel brasileiro: ";" e Windows-1252)
 *
 * A imagem lista-manuscrita-condominio.jpg (foto de lista manuscrita, pouco legível)
 * é um arquivo estático, criado artificialmente, e não é regenerada por este script.
 *
 * Uso: npm run fixtures:generate
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import { CSV_ROWS, DEMO_CUSTOMERS, FIXTURE_FILES, PDF_ORDER_ITEMS, SPREADSHEET_ROWS } from "../src/demo/scenarios";

const outputDir = path.resolve(process.cwd(), "demo", "fixtures");
mkdirSync(outputDir, { recursive: true });

const NOTICE = "DOCUMENTO FICTÍCIO PARA DEMONSTRAÇÃO";

function buildPdf(): Promise<Buffer> {
  const customer = DEMO_CUSTOMERS.find((entry) => entry.key === "horizonte");
  if (!customer) throw new Error("Cliente de demonstração não encontrado");

  // Datas fixas tornam o PDF reprodutível entre execuções.
  const fixedDate = new Date("2026-01-15T12:00:00.000Z");
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: "Pedido de cotação", Author: customer.name, CreationDate: fixedDate, ModDate: fixedDate } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.font("Helvetica-Bold").fontSize(15).text(customer.name);
  doc.font("Helvetica").fontSize(8).fillColor("#b45309").text(NOTICE).fillColor("#111827");
  doc.moveDown(1.2);
  doc.font("Helvetica-Bold").fontSize(12).text("PEDIDO DE COTAÇÃO Nº 0457");
  doc.font("Helvetica").fontSize(10);
  doc.text("Obra: Residencial Jardim das Flores - Torre B");
  doc.text(`Solicitante: ${customer.contactName}`);
  doc.text(`E-mail: ${customer.email}`);
  doc.moveDown(1);

  const columns = [
    { label: "Item", x: 50, width: 35 },
    { label: "Descrição", x: 85, width: 330 },
    { label: "Un.", x: 415, width: 45 },
    { label: "Qtd.", x: 460, width: 80 },
  ];
  let y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9);
  for (const column of columns) doc.text(column.label, column.x, y, { width: column.width });
  y += 16;
  doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor("#9ca3af").stroke();
  doc.font("Helvetica").fontSize(9.5);
  PDF_ORDER_ITEMS.forEach((item, index) => {
    doc.text(String(index + 1), columns[0]?.x ?? 50, y, { width: 35 });
    doc.text(item.description, columns[1]?.x ?? 85, y, { width: 330 });
    doc.text(item.unit, columns[2]?.x ?? 415, y, { width: 45 });
    doc.text(String(item.quantity), columns[3]?.x ?? 460, y, { width: 80 });
    y += 20;
  });
  doc.moveDown(2);
  doc.fontSize(9).text("Favor informar prazo de entrega e condições de pagamento.", 50, y + 14);
  doc.end();
  return done;
}

function buildSpreadsheet(): Buffer {
  const rows: Array<Array<string | number>> = [
    ["Metalúrgica Serra Verde - LISTA DE MATERIAIS (documento fictício para demonstração)"],
    ["Projeto: Retrofit do painel das bombas e esteira 3"],
    [],
    ["Item", "Código", "Descrição do material", "Marca", "Un", "Qtde", "Aplicação"],
    ...SPREADSHEET_ROWS.map((row, index) => [index + 1, row.code, row.description, row.brand, row.unit, row.quantity, row.use]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 6 }, { wch: 14 }, { wch: 48 }, { wch: 14 }, { wch: 6 }, { wch: 8 }, { wch: 22 }];
  const workbook = XLSX.utils.book_new();
  // Propriedades fixas para um arquivo reprodutível.
  workbook.Props = { Title: "Lista de materiais", Author: "Demonstração", CreatedDate: new Date("2026-01-15T12:00:00.000Z") };
  XLSX.utils.book_append_sheet(workbook, sheet, "Materiais");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

function buildCsv(): Buffer {
  const lines = ["Descrição;Quantidade;Unidade", ...CSV_ROWS.map((row) => `${row.description};${row.quantity};${row.unit}`)];
  // Windows-1252, como o Excel brasileiro exporta: exercita a detecção de codificação.
  return Buffer.from(`${lines.join("\r\n")}\r\n`, "latin1");
}

async function main(): Promise<void> {
  const files: Array<[string, Buffer]> = [
    [FIXTURE_FILES.pdfOrder, await buildPdf()],
    [FIXTURE_FILES.spreadsheet, buildSpreadsheet()],
    [FIXTURE_FILES.csv, buildCsv()],
  ];
  for (const [name, data] of files) {
    writeFileSync(path.join(outputDir, name), data);
    console.log(`gerado: demo/fixtures/${name} (${data.length} bytes)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
