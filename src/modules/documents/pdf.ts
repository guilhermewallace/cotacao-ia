import { extractText, getDocumentProxy } from "unpdf";

export interface PdfText {
  pages: string[];
  pageCount: number;
  /** Caracteres úteis (sem espaços) em todas as páginas lidas. */
  charCount: number;
}

export class DocumentReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DocumentReadError";
  }
}

const MAX_PAGES = 40;

/** Extrai o texto de um PDF, página a página. PDFs digitalizados retornam pouco ou nenhum texto. */
export async function extractPdfText(data: Buffer): Promise<PdfText> {
  try {
    const document = await getDocumentProxy(new Uint8Array(data));
    const { totalPages, text } = await extractText(document, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).slice(0, MAX_PAGES).map((page) => page.replace(/[ \t]+\n/g, "\n").trim());
    const charCount = pages.reduce((sum, page) => sum + page.replace(/\s/g, "").length, 0);
    return { pages, pageCount: totalPages, charCount };
  } catch (error) {
    throw new DocumentReadError("Não foi possível ler o PDF (arquivo corrompido ou protegido por senha).", { cause: error });
  }
}

/** Um PDF "tem texto" quando há conteúdo suficiente para dispensar OCR/visão. */
export function hasUsableText(pdf: PdfText): boolean {
  const pagesRead = Math.max(pdf.pages.length, 1);
  return pdf.charCount / pagesRead >= 40;
}

export function pdfPagesToText(pdf: PdfText): string {
  return pdf.pages.map((page, index) => `--- Página ${index + 1} ---\n${page}`).join("\n\n");
}
