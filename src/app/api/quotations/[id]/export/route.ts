import { buildQuotationCsv } from "@/modules/quotations/export/csv";
import { EXPORT_CONTENT_TYPES, exportFileName, loadQuotationExportData, type ExportFormat } from "@/modules/quotations/export/data";
import { buildQuotationPdf } from "@/modules/quotations/export/pdf";
import { buildQuotationXlsx } from "@/modules/quotations/export/xlsx";
import { ValidationError } from "@/platform/errors";
import { contentDisposition, errorResponse } from "@/server/http";
import { requireContext } from "@/server/session";

const FORMATS: readonly ExportFormat[] = ["pdf", "xlsx", "csv"];

/** Exporta a cotação em PDF, Excel ou CSV. A posse da cotação é verificada em `getQuotation`. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requireContext("quotation:read");
    const { id } = await context.params;
    const format = new URL(request.url).searchParams.get("format") as ExportFormat | null;
    if (!format || !FORMATS.includes(format)) throw new ValidationError("Formato de exportação inválido. Use pdf, xlsx ou csv.");

    const data = await loadQuotationExportData(ctx, id, format);
    const file = format === "pdf" ? await buildQuotationPdf(data) : format === "xlsx" ? buildQuotationXlsx(data) : buildQuotationCsv(data);

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": EXPORT_CONTENT_TYPES[format],
        "Content-Length": String(file.byteLength),
        "Content-Disposition": contentDisposition(exportFileName(data, format)),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, "api.quotations.export");
  }
}
