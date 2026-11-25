import { hmacSha256Hex, safeEqual } from "@/platform/crypto";

/**
 * Validação da assinatura das notificações da Meta.
 *
 * A Meta assina o CORPO BRUTO da requisição com HMAC-SHA256 usando o App Secret e
 * envia o resultado em `X-Hub-Signature-256: sha256=<hex>`. A verificação precisa
 * usar os bytes exatamente como recebidos, antes de qualquer parse do JSON.
 */
export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | null | undefined, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [algorithm, signature] = signatureHeader.trim().split("=");
  if (algorithm !== "sha256" || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  return safeEqual(hmacSha256Hex(appSecret, rawBody), signature.toLowerCase());
}

/** Gera o cabeçalho de assinatura — usado por testes e pelo simulador local. */
export function signMetaPayload(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${hmacSha256Hex(appSecret, rawBody)}`;
}
