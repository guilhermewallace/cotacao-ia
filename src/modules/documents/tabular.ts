import { cellToString, type CellValue, type SheetData } from "@/modules/documents/spreadsheet";
import { stripAccents } from "@/modules/normalization/text";
import { parseQuantity } from "@/modules/normalization/units";

/**
 * Leitura determinística de tabelas de itens (planilhas de pedido de cotação).
 *
 * Quando a planilha tem cabeçalho reconhecível (descrição + quantidade/código, ou uma
 * lista de coluna única com cabeçalho de descrição),
 * os itens são lidos diretamente, sem IA: é mais barato, reprodutível e rastreável
 * (cada item aponta para sua linha). Planilhas sem cabeçalho claro são enviadas
 * ao provedor de IA como texto.
 */

export type TableColumn = "description" | "quantity" | "unit" | "code" | "manufacturer" | "notes";

const HEADER_SYNONYMS: Record<TableColumn, string[]> = {
  description: [
    "descricao", "descricao do produto", "descricao do material", "descricao do item", "produto", "produtos", "material",
    "materiais", "especificacao", "discriminacao", "item descricao", "descricao/especificacao", "nome", "nome do produto",
  ],
  quantity: ["qtd", "qtde", "qtd.", "qtde.", "quant", "quant.", "quantidade", "qte", "qt", "quantidade solicitada"],
  unit: ["un", "un.", "und", "und.", "unid", "unid.", "unidade", "um", "u.m.", "unidade de medida", "medida"],
  code: [
    "codigo", "cod", "cod.", "ref", "ref.", "referencia", "sku", "part number", "pn", "codigo do produto", "codigo fabricante",
    "codigo do fabricante", "cod fabricante", "cod. fabricante", "referencia do fabricante",
  ],
  manufacturer: ["marca", "fabricante", "marca/fabricante"],
  notes: ["obs", "obs.", "observacao", "observacoes", "aplicacao", "nota"],
};

const TOTAL_ROW = /^(sub)?total\b|^valor total\b|^total geral\b/;

function normalizeHeader(value: CellValue | undefined): string {
  return stripAccents(cellToString(value)).toLowerCase().replace(/\s+/g, " ").replace(/[:*]+$/g, "").trim();
}

function matchColumn(header: string): TableColumn | null {
  if (!header) return null;
  for (const [column, synonyms] of Object.entries(HEADER_SYNONYMS) as Array<[TableColumn, string[]]>) {
    if (synonyms.includes(header)) return column;
  }
  return null;
}

export interface TableLayout {
  headerRow: number;
  columns: Partial<Record<TableColumn, number>>;
}

/** Procura a linha de cabeçalho nas primeiras linhas da planilha. */
export function detectTableLayout(rows: CellValue[][]): TableLayout | null {
  const limit = Math.min(rows.length, 40);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const columns: Partial<Record<TableColumn, number>> = {};
    row.forEach((cell, columnIndex) => {
      const column = matchColumn(normalizeHeader(cell));
      if (column && columns[column] === undefined) columns[column] = columnIndex;
    });
    if (columns.description !== undefined && (columns.quantity !== undefined || columns.code !== undefined)) {
      return { headerRow: rowIndex, columns };
    }
    // Lista simples: uma única coluna, com cabeçalho de descrição ("Descrição", "Material"...).
    // As quantidades ficam nulas — o revisor as informa.
    const filled = row.filter((cell) => cellToString(cell).trim() !== "").length;
    if (columns.description !== undefined && filled === 1 && rowIndex === 0) {
      return { headerRow: rowIndex, columns };
    }
  }
  return null;
}

export interface TabularItem {
  sheet: string;
  /** Número da linha na planilha (base 1), como o usuário vê. */
  rowNumber: number;
  description: string;
  quantity: number | null;
  /** Unidade como escrita na planilha. */
  unit: string | null;
  code: string | null;
  manufacturer: string | null;
  notes: string | null;
  /** Linha original, para referência ao documento. */
  excerpt: string;
}

export function extractItemsFromSheet(sheet: SheetData): { layout: TableLayout; items: TabularItem[] } | null {
  const layout = detectTableLayout(sheet.rows);
  if (!layout) return null;

  const cell = (row: CellValue[], column: TableColumn): string => {
    const index = layout.columns[column];
    return index === undefined ? "" : cellToString(row[index]).trim();
  };

  const items: TabularItem[] = [];
  for (let rowIndex = layout.headerRow + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? [];
    const description = cell(row, "description");
    if (!description || description.length < 2) continue;
    if (TOTAL_ROW.test(stripAccents(description).toLowerCase())) continue;

    const quantityIndex = layout.columns.quantity;
    const rawQuantity = quantityIndex === undefined ? null : (row[quantityIndex] ?? null);
    const quantity = typeof rawQuantity === "number" ? parseQuantity(rawQuantity) : parseQuantity(cellToString(rawQuantity));

    items.push({
      sheet: sheet.name,
      rowNumber: rowIndex + 1,
      description,
      quantity,
      unit: cell(row, "unit") || null,
      code: cell(row, "code") || null,
      manufacturer: cell(row, "manufacturer") || null,
      notes: cell(row, "notes") || null,
      excerpt: row.map(cellToString).filter(Boolean).join(" | ").slice(0, 400),
    });
  }
  return { layout, items };
}
