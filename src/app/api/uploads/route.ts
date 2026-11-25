import { ingestUpload, MAX_UPLOAD_FILES } from "@/modules/inbox/upload";
import { maxUploadBytes } from "@/platform/env";
import { AppError, ValidationError } from "@/platform/errors";
import { assertRateLimit, assertSameOrigin, errorResponse, readBodyWithLimit } from "@/server/http";
import { requireContext } from "@/server/session";

/**
 * Upload manual de solicitações (multipart/form-data).
 *
 * Fica em um Route Handler — e não em uma Server Action — por causa do tamanho dos arquivos.
 * Defesas: sessão + permissão, mesma origem (CSRF), limite de taxa, limite de tamanho lido
 * de fato (não apenas o Content-Length) e validação do conteúdo real de cada arquivo
 * (assinatura/magic bytes) dentro de `ingestUpload`.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { ctx } = await requireContext("inbox:upload");
    assertRateLimit(`upload:${ctx.userId}`, 30, 60);

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Envie os arquivos como multipart/form-data.");
    }

    // Limite do envio inteiro: até 3 arquivos no tamanho máximo, ou vários menores.
    const body = await readBodyWithLimit(request, maxUploadBytes() * 3 + 1024 * 1024);
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(body), { headers: { "content-type": contentType } }).formData();
    } catch {
      throw new ValidationError("Não foi possível ler os arquivos enviados.");
    }

    const entries = form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
    if (entries.length > MAX_UPLOAD_FILES) throw new ValidationError(`Envie no máximo ${MAX_UPLOAD_FILES} arquivos por vez.`);
    const files = await Promise.all(entries.map(async (file) => ({ name: file.name, data: Buffer.from(await file.arrayBuffer()) })));

    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };

    const result = await ingestUpload(ctx, {
      files,
      note: text("note")?.slice(0, 4000) ?? null,
      customerId: text("customerId"),
      idempotencyKey: text("idempotencyKey"),
    });
    return Response.json({ requestId: result.requestId, status: result.status }, { status: result.status === "created" ? 201 : 200 });
  } catch (error) {
    return errorResponse(error, "api.uploads");
  }
}
