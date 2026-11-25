import { randomUUID } from "node:crypto";
import { LocalStorageProvider } from "@/modules/storage/local";
import { S3StorageProvider } from "@/modules/storage/s3";
import type { StorageProvider } from "@/modules/storage/types";
import { env } from "@/platform/env";

export type { SignedUrlOptions, StorageProvider } from "@/modules/storage/types";
export { canDisplayInline } from "@/modules/storage/types";

const globalStore = globalThis as unknown as { __cotacaoStorage?: StorageProvider };

export function storage(): StorageProvider {
  globalStore.__cotacaoStorage ??= env().STORAGE_DRIVER === "s3" ? new S3StorageProvider() : new LocalStorageProvider();
  return globalStore.__cotacaoStorage;
}

/** Apenas para testes. */
export function setStorageForTests(provider: StorageProvider | undefined): void {
  globalStore.__cotacaoStorage = provider;
}

/** Garante que o destino existe (cria o bucket no storage S3, se ele ainda não existir). */
export async function ensureStorageReady(): Promise<void> {
  const provider = storage();
  if (provider instanceof S3StorageProvider) await provider.ensureBucket();
}

function safeExtension(extension: string): string {
  const cleaned = extension.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned ? `.${cleaned.slice(0, 8)}` : "";
}

/**
 * Chaves são compostas apenas por identificadores gerados pelo servidor —
 * nunca pelo nome original do arquivo.
 */
export function attachmentStorageKey(input: { organizationId: string; messageId: string; attachmentId: string; extension: string }): string {
  return `org/${input.organizationId}/inbound/${input.messageId}/${input.attachmentId}${safeExtension(input.extension)}`;
}

export function importStorageKey(input: { organizationId: string; extension: string }): string {
  return `org/${input.organizationId}/imports/${randomUUID()}${safeExtension(input.extension)}`;
}
