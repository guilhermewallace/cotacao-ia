import { handleInboundEmailWebhook } from "@/modules/inbox/channels/email/handler";
import { maxUploadBytes } from "@/platform/env";
import { clientIp, errorResponse, rateLimit, readBodyWithLimit } from "@/server/http";

/**
 * Webhook de e-mail de entrada (inbound parse), independente de provedor.
 *
 * `[provider]` seleciona o adaptador (ex.: `postmark`, `generic`). Cada adaptador
 * autentica a chamada do seu jeito (Basic Auth ou assinatura HMAC) ANTES de ler o
 * conteúdo, e a empresa de destino é resolvida pelo endereço exclusivo do destinatário.
 * Endpoint público: não usa sessão.
 */
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  try {
    const limit = rateLimit(`webhook:email:${clientIp(request)}`, 300, 60);
    if (!limit.allowed) return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });

    const { provider } = await context.params;
    // Anexos chegam em base64 dentro do JSON (≈ 4/3 do tamanho original).
    const maxBytes = Math.min(maxUploadBytes() * 3, 60 * 1024 * 1024);
    const rawBody = await readBodyWithLimit(request, maxBytes);
    const result = await handleInboundEmailWebhook(provider, { headers: request.headers, rawBody });
    return typeof result.body === "string"
      ? new Response(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } })
      : Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "api.webhooks.email");
  }
}
