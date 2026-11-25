import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertValidStorageKey, type SignedUrlOptions, type StorageProvider } from "@/modules/storage/types";
import { hmacSha256Hex, safeEqual } from "@/platform/crypto";
import { env } from "@/platform/env";

/**
 * Storage em disco para desenvolvimento, testes e demonstração sem um storage S3.
 * As URLs temporárias são assinadas com HMAC e servidas por /api/files/[...key].
 */

export interface LocalFileToken {
  key: string;
  expiresAt: number;
  fileName: string;
  contentType: string;
  disposition: "inline" | "attachment";
}

function signaturePayload(token: LocalFileToken): string {
  return [token.key, token.expiresAt, token.fileName, token.contentType, token.disposition].join("\n");
}

export function signLocalFileToken(token: LocalFileToken): string {
  return hmacSha256Hex(env().SESSION_SECRET, `local-file:v1\n${signaturePayload(token)}`);
}

/** Valida assinatura e validade de uma URL temporária do storage local. */
export function verifyLocalFileToken(token: LocalFileToken, signature: string, now = Date.now()): boolean {
  if (!Number.isFinite(token.expiresAt) || token.expiresAt * 1000 < now) return false;
  return safeEqual(signLocalFileToken(token), signature);
}

export class LocalStorageProvider implements StorageProvider {
  readonly driver = "local" as const;
  private readonly baseDir: string;

  constructor(baseDir: string = env().LOCAL_STORAGE_DIR) {
    this.baseDir = path.resolve(baseDir);
  }

  private resolve(key: string): string {
    assertValidStorageKey(key);
    const resolved = path.resolve(this.baseDir, key);
    if (!resolved.startsWith(this.baseDir + path.sep)) {
      throw new Error("Chave de armazenamento inválida");
    }
    return resolved;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    assertValidStorageKey(key);
    const token: LocalFileToken = {
      key,
      expiresAt: Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? env().SIGNED_URL_TTL_SECONDS),
      fileName: options.fileName ?? path.basename(key),
      contentType: options.contentType ?? "application/octet-stream",
      disposition: options.disposition ?? "attachment",
    };
    const params = new URLSearchParams({
      exp: String(token.expiresAt),
      name: token.fileName,
      type: token.contentType,
      disp: token.disposition,
      sig: signLocalFileToken(token),
    });
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    return `/api/files/${encodedKey}?${params.toString()}`;
  }
}
