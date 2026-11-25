import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/platform/env";

/**
 * Criptografia de credenciais de integração (AES-256-GCM) e utilitários de assinatura.
 *
 * Formato do envelope: `v1.<iv b64url>.<tag b64url>.<ciphertext b64url>`.
 * O contexto (AAD) amarra o valor cifrado à organização e ao tipo de integração:
 * um envelope copiado para outro registro não pode ser decifrado.
 */

const ENVELOPE_VERSION = "v1";

function encryptionKey(): Buffer {
  return Buffer.from(env().ENCRYPTION_KEY, "base64");
}

export function encryptJson(value: unknown, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptJson<T>(envelope: string, context: string): T {
  const [version, ivPart, tagPart, dataPart] = envelope.split(".");
  if (version !== ENVELOPE_VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error("Envelope de credenciais inválido");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacSha256Hex(secret: string, data: Buffer | string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Comparação em tempo constante de duas strings (evita ataques de temporização). */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right) && a.length === b.length;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** Mascara um segredo para exibição: mantém apenas os 4 últimos caracteres. */
export function maskSecret(value: string): string {
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}
