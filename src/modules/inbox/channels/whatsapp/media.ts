import { env, maxUploadBytes } from "@/platform/env";

/**
 * Recuperação de mídias enviadas por clientes (WhatsApp Business Cloud API):
 *
 *   1. GET https://graph.facebook.com/{versão}/{media-id}   → URL temporária + metadados
 *   2. GET {url} com o mesmo token                          → bytes do arquivo
 *
 * A URL devolvida pela Meta expira em poucos minutos; por isso o download é feito
 * pelo worker logo após o recebimento e o arquivo é guardado no nosso storage.
 */

export class MediaDownloadError extends Error {
  readonly retryable: boolean;
  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "MediaDownloadError";
    this.retryable = options.retryable;
  }
}

export interface DownloadedMedia {
  data: Buffer;
  mimeType: string | null;
}

export interface WhatsAppMediaClient {
  download(mediaId: string, accessToken: string): Promise<DownloadedMedia>;
}

/** Hosts de onde a Meta serve mídias. Qualquer outro destino é recusado (proteção contra SSRF). */
const ALLOWED_MEDIA_HOSTS = [/(^|\.)fbsbx\.com$/, /(^|\.)fbcdn\.net$/, /(^|\.)facebook\.com$/, /(^|\.)whatsapp\.net$/];

export function isAllowedMediaUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && ALLOWED_MEDIA_HOSTS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new MediaDownloadError("Mídia excede o tamanho máximo permitido.", { retryable: false });
  if (!response.body) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new MediaDownloadError("Mídia excede o tamanho máximo permitido.", { retryable: false });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export class GraphApiMediaClient implements WhatsAppMediaClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://graph.facebook.com",
  ) {}

  private async request(url: string, accessToken: string, redirectsLeft = 2): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        // Redirecionamentos são seguidos manualmente, um a um, e só para hosts da Meta.
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new MediaDownloadError("Falha de rede ao consultar a API da Meta.", { retryable: true, cause: error });
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectsLeft <= 0 || !isAllowedMediaUrl(new URL(location, url).toString())) {
        throw new MediaDownloadError("Redirecionamento inesperado ao recuperar a mídia.", { retryable: false });
      }
      return this.request(new URL(location, url).toString(), accessToken, redirectsLeft - 1);
    }
    if (!response.ok) {
      // 401/403: token inválido ou sem permissão; 404: mídia expirada. Não adianta repetir.
      const retryable = response.status === 429 || response.status >= 500;
      throw new MediaDownloadError(`A API da Meta respondeu HTTP ${response.status} ao recuperar a mídia.`, { retryable });
    }
    return response;
  }

  async download(mediaId: string, accessToken: string): Promise<DownloadedMedia> {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(mediaId)) throw new MediaDownloadError("Identificador de mídia inválido.", { retryable: false });
    const version = env().WHATSAPP_GRAPH_API_VERSION;

    const infoResponse = await this.request(`${this.baseUrl}/${version}/${mediaId}`, accessToken);
    const info = (await infoResponse.json()) as { url?: unknown; mime_type?: unknown; file_size?: unknown };
    if (typeof info.url !== "string" || !isAllowedMediaUrl(info.url)) {
      throw new MediaDownloadError("A API da Meta retornou uma URL de mídia inesperada.", { retryable: false });
    }
    if (typeof info.file_size === "number" && info.file_size > maxUploadBytes()) {
      throw new MediaDownloadError("Mídia excede o tamanho máximo permitido.", { retryable: false });
    }

    const mediaResponse = await this.request(info.url, accessToken);
    const data = await readLimited(mediaResponse, maxUploadBytes());
    return { data, mimeType: typeof info.mime_type === "string" ? info.mime_type : null };
  }
}

let mediaClient: WhatsAppMediaClient | undefined;

export function getWhatsAppMediaClient(): WhatsAppMediaClient {
  mediaClient ??= new GraphApiMediaClient();
  return mediaClient;
}

/** Apenas para testes. */
export function setWhatsAppMediaClientForTests(client: WhatsAppMediaClient | undefined): void {
  mediaClient = client;
}
