import { handleWhatsAppVerification, handleWhatsAppWebhook, type WebhookResponse } from "@/modules/inbox/channels/whatsapp/handler";
import { clientIp, errorResponse, rateLimit, readBodyWithLimit } from "@/server/http";

/**
 * Webhook da WhatsApp Business Cloud API (API oficial da Meta).
 *
 *  GET  — verificação do endpoint (hub.challenge), comparando o token configurado.
 *  POST — notificações de mensagens e status. A assinatura X-Hub-Signature-256 é
 *         validada sobre o corpo BRUTO antes de qualquer interpretação do conteúdo.
 *
 * Endpoint público: não usa sessão. A autenticação é a assinatura HMAC da Meta.
 */

const MAX_BODY_BYTES = 3 * 1024 * 1024;

function toResponse(result: WebhookResponse): Response {
  const headers = { "Cache-Control": "no-store" };
  return typeof result.body === "string"
    ? new Response(result.body, { status: result.status, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } })
    : Response.json(result.body, { status: result.status, headers });
}

function limited(request: Request): Response | null {
  const limit = rateLimit(`webhook:whatsapp:${clientIp(request)}`, 600, 60);
  return limit.allowed ? null : new Response("Too Many Requests", { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
}

export async function GET(request: Request): Promise<Response> {
  return limited(request) ?? toResponse(handleWhatsAppVerification(new URL(request.url).searchParams));
}

export async function POST(request: Request): Promise<Response> {
  try {
    const blocked = limited(request);
    if (blocked) return blocked;
    const rawBody = await readBodyWithLimit(request, MAX_BODY_BYTES);
    return toResponse(await handleWhatsAppWebhook({ rawBody, signature: request.headers.get("x-hub-signature-256") }));
  } catch (error) {
    return errorResponse(error, "api.webhooks.whatsapp");
  }
}
