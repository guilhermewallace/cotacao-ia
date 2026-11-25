import { storage } from "@/modules/storage";
import { verifyLocalFileToken, type LocalFileToken } from "@/modules/storage/local";
import { canDisplayInline, contentDisposition } from "@/modules/storage/types";
import { env } from "@/platform/env";
import { logger } from "@/platform/logger";

/**
 * Serve arquivos do storage LOCAL por URL temporária assinada (HMAC + validade).
 *
 * Equivale às URLs pré-assinadas do S3: quem tem a URL acessa o arquivo até ela expirar,
 * e a URL só é emitida depois da verificação de autorização (ver getAttachmentAccess).
 * Nome, tipo e disposição fazem parte da assinatura — não podem ser adulterados.
 * Com STORAGE_DRIVER=s3 esta rota não existe (404).
 */
export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }): Promise<Response> {
  const notFound = () => new Response("Arquivo não encontrado ou link expirado.", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (env().STORAGE_DRIVER !== "local") return notFound();

  const { key: segments } = await context.params;
  const url = new URL(request.url);
  const disposition = url.searchParams.get("disp") === "inline" ? "inline" : "attachment";
  const token: LocalFileToken = {
    key: segments.join("/"),
    expiresAt: Number(url.searchParams.get("exp")),
    fileName: url.searchParams.get("name") ?? "",
    contentType: url.searchParams.get("type") ?? "",
    disposition,
  };
  if (!verifyLocalFileToken(token, url.searchParams.get("sig") ?? "")) return notFound();
  // Defesa em profundidade: só PDF e imagens podem abrir no navegador.
  if (disposition === "inline" && !canDisplayInline(token.contentType)) return notFound();

  try {
    const data = await storage().get(token.key);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": token.contentType,
        "Content-Length": String(data.byteLength),
        "Content-Disposition": contentDisposition(disposition, token.fileName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Só a própria aplicação pode embutir o arquivo. (Uma CSP mais restritiva na resposta de um
        // PDF impediria o leitor de PDF do navegador de renderizá-lo.)
        "Content-Security-Policy": "frame-ancestors 'self'",
      },
    });
  } catch {
    logger({ scope: "api.files" }).warn({ key: token.key }, "arquivo assinado não encontrado no storage local");
    return notFound();
  }
}
