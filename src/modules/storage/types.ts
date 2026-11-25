export interface SignedUrlOptions {
  /** Validade em segundos. Padrão: SIGNED_URL_TTL_SECONDS. */
  expiresInSeconds?: number;
  /** Nome sugerido para download. */
  fileName?: string;
  /** Tipo de conteúdo com que o arquivo será servido (definido por nós, nunca pelo remetente). */
  contentType?: string;
  /** `inline` para visualização no navegador (apenas PDF e imagens); padrão `attachment`. */
  disposition?: "inline" | "attachment";
}

/**
 * Object storage privado. Os arquivos nunca são públicos: o acesso se dá por
 * URLs temporárias assinadas, emitidas após a verificação de autorização.
 */
export interface StorageProvider {
  readonly driver: "s3" | "local";
  put(key: string, body: Buffer, options: { contentType: string }): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
}

const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,500}$/;

/** Chaves são sempre geradas pelo servidor; esta validação é defesa em profundidade. */
export function assertValidStorageKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("Chave de armazenamento inválida");
  }
}

/** Tipos que podem ser exibidos no navegador; os demais são sempre baixados. */
const INLINE_SAFE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

export function canDisplayInline(contentType: string): boolean {
  return INLINE_SAFE_TYPES.has(contentType.toLowerCase());
}

export function contentDisposition(disposition: "inline" | "attachment", fileName?: string): string {
  if (!fileName) return disposition;
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
