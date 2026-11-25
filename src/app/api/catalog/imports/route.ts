import { previewImport, type ImportTarget } from "@/modules/catalog/import";
import { maxUploadBytes } from "@/platform/env";
import { AppError, ValidationError } from "@/platform/errors";
import { assertRateLimit, assertSameOrigin, errorResponse, readBodyWithLimit } from "@/server/http";
import { requireContext } from "@/server/session";

/**
 * Primeira etapa da importação de catálogo/lista de preços: recebe a planilha,
 * guarda-a temporariamente no storage privado e devolve colunas, amostra e análise.
 * Nada é gravado no catálogo aqui — a aplicação acontece depois, por Server Action.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { ctx } = await requireContext("catalog:import");
    assertRateLimit(`import:${ctx.userId}`, 20, 60);

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Envie o arquivo como multipart/form-data.");
    }
    const body = await readBodyWithLimit(request, maxUploadBytes() + 1024 * 1024);
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(body), { headers: { "content-type": contentType } }).formData();
    } catch {
      throw new ValidationError("Não foi possível ler o arquivo enviado.");
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Selecione um arquivo CSV ou Excel.");
    const target: ImportTarget = form.get("target") === "price_list" ? "price_list" : "products";

    const preview = await previewImport(ctx, { target, fileName: file.name, data: Buffer.from(await file.arrayBuffer()) });
    return Response.json(preview);
  } catch (error) {
    return errorResponse(error, "api.catalog.imports");
  }
}
