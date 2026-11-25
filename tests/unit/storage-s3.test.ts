import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { S3StorageProvider } from "@/modules/storage/s3";
import { resetEnvCache } from "@/platform/env";

/**
 * Adaptador S3 sem rede: `S3Client.send` é substituído, e as URLs pré-assinadas são
 * calculadas localmente pelo SDK. O que se verifica aqui é a lógica do adaptador —
 * quando o bucket é criado, o que é repassado e para qual endereço a URL é assinada.
 */

const KEY = "org/0f8fad5b-d9cb-469f-a165-70867728950e/inbound/m1/a1.pdf";

function s3Error(name: string, httpStatusCode?: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
}

function commandName(command: object): string {
  if (command instanceof HeadBucketCommand) return "HeadBucket";
  if (command instanceof CreateBucketCommand) return "CreateBucket";
  if (command instanceof PutObjectCommand) return "PutObject";
  return command.constructor.name;
}

/** Substitui o envio de comandos; `respond` devolve a resposta ou lança o erro de cada chamada. */
function mockS3(respond: (name: string, call: number) => unknown = () => ({})) {
  const calls: string[] = [];
  const spy = vi.spyOn(S3Client.prototype, "send").mockImplementation((async (command: object) => {
    const name = commandName(command);
    calls.push(name);
    return respond(name, calls.filter((entry) => entry === name).length);
  }) as never);
  return { calls, spy };
}

function createProvider(overrides: Record<string, string> = {}): S3StorageProvider {
  const settings: Record<string, string> = {
    STORAGE_DRIVER: "s3",
    S3_ENDPOINT: "http://localhost:9000",
    S3_PUBLIC_ENDPOINT: "",
    S3_REGION: "us-east-1",
    S3_BUCKET: "cotacao-ia",
    S3_ACCESS_KEY_ID: "chave-de-teste",
    S3_SECRET_ACCESS_KEY: "segredo-de-teste",
    S3_FORCE_PATH_STYLE: "true",
    S3_AUTO_CREATE_BUCKET: "false",
    ...overrides,
  };
  for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
  resetEnvCache();
  return new S3StorageProvider();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("storage S3 — criação do bucket", () => {
  it("não cria nada quando o bucket já existe", async () => {
    const { calls } = mockS3();
    await createProvider().ensureBucket();
    expect(calls).toEqual(["HeadBucket"]);
  });

  it("cria o bucket quando ele não existe", async () => {
    const { calls } = mockS3((name) => {
      if (name === "HeadBucket") throw s3Error("NotFound", 404);
      return {};
    });
    await createProvider().ensureBucket();
    expect(calls).toEqual(["HeadBucket", "CreateBucket"]);
  });

  it("não tenta criar quando a conferência falha por outro motivo (acesso negado, storage fora do ar)", async () => {
    const denied = mockS3(() => {
      throw s3Error("Forbidden", 403);
    });
    await expect(createProvider().ensureBucket()).rejects.toThrow("Forbidden");
    expect(denied.calls).toEqual(["HeadBucket"]);
    vi.restoreAllMocks();

    const offline = mockS3(() => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9000"), { code: "ECONNREFUSED" });
    });
    await expect(createProvider().ensureBucket()).rejects.toThrow("ECONNREFUSED");
    expect(offline.calls).toEqual(["HeadBucket"]);
  });

  it("aceita que outro processo tenha criado o bucket no mesmo instante", async () => {
    const { calls } = mockS3((name, call) => {
      if (name === "HeadBucket" && call === 1) throw s3Error("NotFound", 404);
      if (name === "CreateBucket") throw s3Error("BucketAlreadyOwnedByYou", 409);
      return {};
    });
    await createProvider().ensureBucket();
    expect(calls).toEqual(["HeadBucket", "CreateBucket", "HeadBucket"]);
  });

  it("propaga o erro de criação quando o bucket continua inexistente", async () => {
    mockS3((name) => {
      if (name === "HeadBucket") throw s3Error("NotFound", 404);
      throw s3Error("AccessDenied", 403);
    });
    await expect(createProvider().ensureBucket()).rejects.toThrow("AccessDenied");
  });
});

describe("storage S3 — gravação", () => {
  const body = Buffer.from("%PDF-1.7");

  it("por padrão grava direto, sem conferir nem criar o bucket", async () => {
    const { calls } = mockS3();
    const provider = createProvider();
    await provider.put(KEY, body, { contentType: "application/pdf" });
    expect(calls).toEqual(["PutObject"]);
  });

  it("com S3_AUTO_CREATE_BUCKET=true, cria o bucket que falta — uma única vez por processo", async () => {
    const { calls } = mockS3((name) => {
      if (name === "HeadBucket") throw s3Error("NotFound", 404);
      return {};
    });
    const provider = createProvider({ S3_AUTO_CREATE_BUCKET: "true" });
    await provider.put(KEY, body, { contentType: "application/pdf" });
    await provider.put(KEY, body, { contentType: "application/pdf" });
    expect(calls).toEqual(["HeadBucket", "CreateBucket", "PutObject", "PutObject"]);
  });

  it("se a conferência do bucket falhar, a gravação falha e a seguinte tenta de novo", async () => {
    let online = false;
    const { calls } = mockS3(() => {
      if (!online) throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9000"), { code: "ECONNREFUSED" });
      return {};
    });
    const provider = createProvider({ S3_AUTO_CREATE_BUCKET: "true" });
    await expect(provider.put(KEY, body, { contentType: "application/pdf" })).rejects.toThrow("ECONNREFUSED");
    online = true;
    await provider.put(KEY, body, { contentType: "application/pdf" });
    expect(calls).toEqual(["HeadBucket", "HeadBucket", "PutObject"]);
  });

  it("envia o tipo definido pelo servidor e só pede criptografia SSE-S3 na AWS (sem endpoint próprio)", async () => {
    const custom = mockS3();
    await createProvider().put(KEY, body, { contentType: "application/pdf" });
    const customInput = (custom.spy.mock.calls[0]?.[0] as PutObjectCommand).input;
    expect(customInput).toMatchObject({ Bucket: "cotacao-ia", Key: KEY, ContentType: "application/pdf" });
    expect(customInput.ServerSideEncryption).toBeUndefined();
    vi.restoreAllMocks();

    const aws = mockS3();
    await createProvider({ S3_ENDPOINT: "", S3_FORCE_PATH_STYLE: "false" }).put(KEY, body, { contentType: "application/pdf" });
    expect((aws.spy.mock.calls[0]?.[0] as PutObjectCommand).input.ServerSideEncryption).toBe("AES256");
  });

  it("recusa chaves que não foram geradas pelo servidor", async () => {
    const { calls } = mockS3();
    const provider = createProvider();
    await expect(provider.put("../segredo.txt", body, { contentType: "text/plain" })).rejects.toThrow("Chave de armazenamento inválida");
    await expect(provider.getSignedUrl("org//x")).rejects.toThrow("Chave de armazenamento inválida");
    expect(calls).toEqual([]);
  });

  it("com endpoint próprio, só envia checksums quando a operação exige (compatibilidade fora da AWS)", async () => {
    const { spy } = mockS3();
    await createProvider().put(KEY, body, { contentType: "application/pdf" });
    const client = spy.mock.contexts[0] as S3Client;
    expect(await client.config.requestChecksumCalculation()).toBe("WHEN_REQUIRED");
    expect(await client.config.responseChecksumValidation()).toBe("WHEN_REQUIRED");
  });
});

describe("storage S3 — URLs temporárias", () => {
  it("assina a URL com validade curta e com o tipo e a forma de exibição definidos pelo servidor", async () => {
    const provider = createProvider();
    const url = new URL(
      await provider.getSignedUrl(KEY, { fileName: "pedido nº 1.pdf", contentType: "application/pdf", disposition: "inline", expiresInSeconds: 120 }),
    );
    expect(url.origin).toBe("http://localhost:9000");
    expect(url.pathname).toBe(`/cotacao-ia/${KEY}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(url.searchParams.get("response-content-disposition")).toMatch(/^inline; filename="pedido n_ 1\.pdf"/);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.has("x-amz-checksum-mode")).toBe(false);
  });

  it("usa a validade padrão e força download quando nada é informado", async () => {
    const url = new URL(await createProvider().getSignedUrl(KEY));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-disposition")).toBe("attachment");
  });

  it("assina para o endereço visto pelo navegador quando ele difere do interno", async () => {
    const provider = createProvider({ S3_ENDPOINT: "http://storage:9000", S3_PUBLIC_ENDPOINT: "http://localhost:9000" });
    const url = new URL(await provider.getSignedUrl(KEY));
    expect(url.origin).toBe("http://localhost:9000");
  });
});
