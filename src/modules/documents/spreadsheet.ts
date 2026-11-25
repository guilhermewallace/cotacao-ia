import Papa from "papaparse";
import * as XLSX from "xlsx";
import * as codepages from "xlsx/dist/cpexcel.full.mjs";
import { DocumentReadError } from "@/modules/documents/pdf";

// Tabelas de codificação para planilhas .xls antigas (acentos em Windows-1252 etc.).
XLSX.set_cptable(codepages);

export type CellValue = string | number | null;

export interface SheetData {
  name: string;
  rows: CellValue[][];
}

const MAX_SHEETS = 10;
export const MAX_SHEET_ROWS = 20_000;
const MAX_COLUMNS = 80;

/**
 * Decodifica texto: UTF-8 (com ou sem BOM), UTF-16 com BOM e, se o conteúdo não for
 * UTF-8 válido, Windows-1252 — o padrão dos CSV exportados pelo Excel no Brasil.
 */
export function decodeText(data: Buffer): string {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return data.subarray(3).toString("utf8");
  }
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(data.subarray(2));
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(data.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("windows-1252").decode(data);
  }
}

function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = String(value).replace(/ /g, " ").trim();
  return text.length > 0 ? text : null;
}

function trimRows(rows: CellValue[][]): CellValue[][] {
  const trimmed = rows.map((row) => {
    let end = Math.min(row.length, MAX_COLUMNS);
    while (end > 0 && (row[end - 1] === null || row[end - 1] === undefined)) end -= 1;
    return row.slice(0, end);
  });
  while (trimmed.length > 0 && (trimmed[trimmed.length - 1]?.length ?? 0) === 0) trimmed.pop();
  return trimmed;
}

/** Lê planilhas .xlsx e .xls. Valores vêm crus (sem formatação de exibição do Excel). */
export function readWorkbook(data: Buffer): SheetData[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: "buffer", cellDates: true, cellFormula: false, cellHTML: false, sheetRows: MAX_SHEET_ROWS });
  } catch (error) {
    throw new DocumentReadError("Não foi possível ler a planilha (arquivo corrompido ou protegido por senha).", { cause: error });
  }

  const sheets: SheetData[] = [];
  for (const name of workbook.SheetNames.slice(0, MAX_SHEETS)) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
    const rows = trimRows(matrix.map((row) => (Array.isArray(row) ? row.map(normalizeCell) : [])));
    if (rows.some((row) => row.length > 0)) sheets.push({ name, rows });
  }
  return sheets;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) count += 1;
  }
  return count;
}

/**
 * Detecta o delimitador do CSV: o que aparece, fora de aspas, o mesmo número de vezes em
 * (quase) todas as linhas. Em empate, a ordem de preferência é `;` (padrão do Excel no
 * Brasil), tabulação, `,` e `|`. Funciona também para arquivos de uma ou duas linhas —
 * caso em que a detecção automática da biblioteca falha.
 */
export function detectCsvDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 25);
  let best = { delimiter: ",", score: 0 };
  for (const delimiter of [";", "\t", ",", "|"]) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const header = counts[0] ?? 0;
    if (header === 0) continue;
    const consistency = counts.filter((count) => count === header).length / counts.length;
    const score = consistency * 1000 + header;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

/** Lê CSV com detecção de delimitador (`;`, `,`, tabulação, `|`) e de codificação. Tudo é mantido como texto. */
export function readCsv(data: Buffer, name = "CSV"): SheetData {
  const text = decodeText(data);
  const parsed = Papa.parse<string[]>(text, {
    delimiter: detectCsvDelimiter(text),
    skipEmptyLines: false,
    dynamicTyping: false,
    preview: MAX_SHEET_ROWS,
  });
  const fatal = parsed.errors.find((error) => error.type === "Quotes" && parsed.data.length === 0);
  if (fatal) throw new DocumentReadError("Não foi possível ler o CSV.");
  const rows = trimRows(parsed.data.map((row) => (Array.isArray(row) ? row.map(normalizeCell) : [])));
  return { name, rows };
}

export function readSpreadsheet(data: Buffer, extension: string, fileName = "planilha"): SheetData[] {
  if (extension === "csv") {
    const sheet = readCsv(data, fileName);
    return sheet.rows.length > 0 ? [sheet] : [];
  }
  return readWorkbook(data);
}

export function cellToString(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    // Evita notação científica em códigos numéricos longos.
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }
  return value;
}

/** Representa a planilha como texto numerado, para envio a um modelo de linguagem. */
export function sheetToText(sheet: SheetData, maxRows = 400): string {
  const lines: string[] = [`Planilha: ${sheet.name}`];
  sheet.rows.slice(0, maxRows).forEach((row, index) => {
    if (row.length === 0) return;
    lines.push(`Linha ${index + 1}: ${row.map(cellToString).join(" | ")}`);
  });
  if (sheet.rows.length > maxRows) lines.push(`(${sheet.rows.length - maxRows} linhas adicionais omitidas)`);
  return lines.join("\n");
}
