import { getAttachmentAccess } from "@/modules/inbox/attachments";
import { errorResponse } from "@/server/http";
import { requireContext } from "@/server/session";

/**
 * Acesso a um anexo: confere sessão, permissão e se o anexo pertence à empresa ativa;
 * só então emite uma URL TEMPORÁRIA do storage privado e redireciona para ela.
 * O arquivo em si nunca é público nem trafega por uma URL permanente.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { ctx } = await requireContext("inbox:read");
    const { id } = await context.params;
    const download = new URL(request.url).searchParams.get("download") === "1";
    const access = await getAttachmentAccess(ctx, id, { download });
    return new Response(null, { status: 302, headers: { Location: access.url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    return errorResponse(error, "api.attachments");
  }
}
