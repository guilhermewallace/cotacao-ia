import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  assertValidStorageKey,
  contentDisposition,
  type SignedUrlOptions,
  type StorageProvider,
} from "@/modules/storage/types";
import { env } from "@/platform/env";

/** O SDK informa o código do erro S3 em `name` e o status HTTP em `$metadata`. */
function isMissingBucket(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  const name = typeof candidate?.name === "string" ? candidate.name : "";
  return candidate?.$metadata?.httpStatusCode === 404 || name === "NotFound" || name === "NoSuchBucket";
}

/**
 * Storage compatível com S3 (AWS S3, Cloudflare R2, Supabase Storage S3, RustFS e similares).
 * O bucket deve ser PRIVADO; o acesso é sempre por URL pré-assinada de curta duração.
 */
export class S3StorageProvider implements StorageProvider {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  /** Cliente usado apenas para assinar URLs acessadas pelo navegador. */
  private readonly presignClient: S3Client;
  private readonly bucket: string;
  private readonly autoCreateBucket: boolean;
  /** Conferência do bucket em andamento ou concluída (uma por processo). */
  private bucketCheck: Promise<void> | undefined;

  constructor() {
    const config = env();
    if (!config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
      throw new Error("Configuração S3 incompleta (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)");
    }
    this.bucket = config.S3_BUCKET;
    this.autoCreateBucket = config.S3_AUTO_CREATE_BUCKET;
    const base = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
      // Com endpoint próprio (storages compatíveis com S3), o SDK só envia checksums quando a operação
      // exige. O padrão atual — CRC32 em toda requisição — nem sempre é aceito fora da AWS.
      ...(config.S3_ENDPOINT
        ? { requestChecksumCalculation: "WHEN_REQUIRED" as const, responseChecksumValidation: "WHEN_REQUIRED" as const }
        : {}),
    };
    this.client = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    this.presignClient = config.S3_PUBLIC_ENDPOINT
      ? new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT })
      : this.client;
  }

  private async bucketExists(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (error) {
      if (isMissingBucket(error)) return false;
      throw error;
    }
  }

  /**
   * Cria o bucket se ele ainda não existir. Um bucket recém-criado é privado.
   * Usado pelo seed e, com `S3_AUTO_CREATE_BUCKET=true`, antes da primeira gravação.
   */
  async ensureBucket(): Promise<void> {
    if (await this.bucketExists()) return;
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      // Web e worker podem tentar criar ao mesmo tempo: se o bucket já existe, está tudo certo.
      const createdMeanwhile = await this.bucketExists().catch(() => false);
      if (!createdMeanwhile) throw error;
    }
  }

  /** Com `S3_AUTO_CREATE_BUCKET=true`, confere o bucket uma única vez por processo. */
  private async ensureBucketOnce(): Promise<void> {
    if (!this.autoCreateBucket) return;
    this.bucketCheck ??= this.ensureBucket();
    try {
      await this.bucketCheck;
    } catch (error) {
      this.bucketCheck = undefined; // a próxima gravação tenta de novo
      throw error;
    }
  }

  async put(key: string, body: Buffer, options: { contentType: string }): Promise<void> {
    assertValidStorageKey(key);
    await this.ensureBucketOnce();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ServerSideEncryption: env().S3_ENDPOINT ? undefined : "AES256",
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertValidStorageKey(key);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error("Objeto vazio no storage");
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    assertValidStorageKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    assertValidStorageKey(key);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: options.contentType,
      ResponseContentDisposition: contentDisposition(options.disposition ?? "attachment", options.fileName),
    });
    return getSignedUrl(this.presignClient, command, {
      expiresIn: options.expiresInSeconds ?? env().SIGNED_URL_TTL_SECONDS,
    });
  }
}
