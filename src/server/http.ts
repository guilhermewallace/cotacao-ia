import "server-only";
import { z } from "zod";
import { AppError, isAppError } from "@/platform/errors";
import { env } from "@/platform/env";
import { logger, serializeError } from "@/platform/logger";

z.config(z.locales.pt());

/** Resposta JSON de erro padronizada para Route Handlers. */
export function errorResponse(error: unknown, scope: string): Response {
  if (isAppError(error)) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  if (error instanceof z.ZodError) {
    return Response.json({ error: error.issues[0]?.message ?? "Dados inválidos.", code: "VALIDATION" }, { status: 422 });
  }
  logger({ scope }).error({ err: serializeError(error) }, "erro inesperado em route handler");
  return Response.json({ error: "Erro interno. Tente novamente.", code: "INTERNAL" }, { status: 500 });
}

/**
 * Proteção contra CSRF para Route Handlers que alteram estado usando cookies de sessão.
 * (Server Actions já fazem essa verificação nativamente.)
 * Exige que o cabeçalho Origin, quando presente, seja o do próprio aplicativo.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new AppError("FORBIDDEN", "Origem da requisição não permitida.");
  }
  if (!origin) return;
  const allowed = new Set<string>([new URL(env().APP_URL).origin]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }
  if (!allowed.has(origin)) throw new AppError("FORBIDDEN", "Origem da requisição não permitida.");
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip") || "desconhecido").slice(0, 64);
}

/**
 * Limitador de taxa em memória (janela fixa), por instância do processo.
 *
 * É uma proteção básica contra abuso de endpoints públicos (login e webhooks).
 * Em produção com várias instâncias, complemente com o limitador do gateway/CDN.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

export function rateLimit(key: string, limit: number, windowSeconds: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
      if (buckets.size >= MAX_BUCKETS) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}

export function assertRateLimit(key: string, limit: number, windowSeconds: number): void {
  const result = rateLimit(key, limit, windowSeconds);
  if (!result.allowed) {
    throw new AppError("RATE_LIMITED", "Muitas tentativas. Aguarde um instante e tente novamente.", { retryAfterSeconds: result.retryAfterSeconds });
  }
}

/** Lê o corpo bruto respeitando um limite de tamanho (o cabeçalho Content-Length não é confiável sozinho). */
export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "Conteúdo maior que o permitido.");
  if (!request.body) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError("PAYLOAD_TOO_LARGE", "Conteúdo maior que o permitido.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Cabeçalho Content-Disposition seguro para nomes com acentos. */
export function contentDisposition(fileName: string, disposition: "attachment" | "inline" = "attachment"): string {
  const fallback = fileName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\- ]/g, "_");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
