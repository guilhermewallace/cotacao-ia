import { describe, expect, it } from "vitest";
import { inspectFile, sanitizeFileName } from "@/modules/documents/inspect";
import { canManageRole, PERMISSIONS, roleCan } from "@/modules/identity/permissions";
import { signLocalFileToken, verifyLocalFileToken, type LocalFileToken } from "@/modules/storage/local";
import { assertValidStorageKey } from "@/modules/storage/types";
import { decryptJson, encryptJson, maskSecret, safeEqual } from "@/platform/crypto";
import { DEV_PLACEHOLDER_ENCRYPTION_KEY, DEV_PLACEHOLDER_SESSION_SECRET, EnvValidationError, parseEnv } from "@/platform/env";
import { isUuid, parseId } from "@/platform/ids";

describe("criptografia de credenciais de integração (AES-256-GCM)", () => {
  const context = "integration:org-1:WHATSAPP_CLOUD";

  it("cifra e decifra sem deixar o segredo em texto puro", () => {
    const envelope = encryptJson({ accessToken: "EAAG-token-super-secreto" }, context);
    expect(envelope).not.toContain("EAAG-token-super-secreto");
    expect(envelope.startsWith("v1.")).toBe(true);
    expect(decryptJson<{ accessToken: string }>(envelope, context).accessToken).toBe("EAAG-token-super-secreto");
  });

  it("gera envelopes diferentes para o mesmo valor (IV aleatório)", () => {
    expect(encryptJson({ a: 1 }, context)).not.toBe(encryptJson({ a: 1 }, context));
  });

  it("não decifra com outro contexto (credencial copiada para outra organização) nem se adulterada", () => {
    const envelope = encryptJson({ accessToken: "abc" }, context);
    expect(() => decryptJson(envelope, "integration:org-2:WHATSAPP_CLOUD")).toThrow();
    const parts = envelope.split(".");
    parts[3] = Buffer.from("adulterado").toString("base64url");
    expect(() => decryptJson(parts.join("."), context)).toThrow();
    expect(() => decryptJson("formato-invalido", context)).toThrow();
  });

  it("mascara segredos para exibição e compara em tempo constante", () => {
    expect(maskSecret("EAAG1234567890abcdef")).not.toContain("1234567890");
    expect(maskSecret("EAAG1234567890abcdef").endsWith("cdef")).toBe(true);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("URLs temporárias do storage local", () => {
  const token: LocalFileToken = {
    key: "org/1/inbound/2/3.pdf",
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    fileName: "pedido.pdf",
    contentType: "application/pdf",
    disposition: "inline",
  };

  it("valida a assinatura e recusa parâmetros adulterados ou link expirado", () => {
    const signature = signLocalFileToken(token);
    expect(verifyLocalFileToken(token, signature)).toBe(true);
    expect(verifyLocalFileToken({ ...token, key: "org/9/inbound/2/3.pdf" }, signature)).toBe(false);
    expect(verifyLocalFileToken({ ...token, contentType: "text/html" }, signature)).toBe(false);
    expect(verifyLocalFileToken({ ...token, expiresAt: token.expiresAt + 9999 }, signature)).toBe(false);
    expect(verifyLocalFileToken(token, signature, Date.now() + 301_000)).toBe(false);
    expect(verifyLocalFileToken(token, "")).toBe(false);
  });

  it("recusa chaves com travessia de diretório", () => {
    expect(() => assertValidStorageKey("org/1/arquivo.pdf")).not.toThrow();
    for (const key of ["../etc/passwd", "org/../../segredo", "/absoluto", "org//duplo", "org/1/arq uivo.pdf", ""]) {
      expect(() => assertValidStorageKey(key)).toThrow();
    }
  });
});

describe("validação de arquivos enviados", () => {
  const limit = { maxBytes: 5 * 1024 * 1024 };
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20), Buffer.from("\n%%EOF")]);
  // PNG válido de 1×1 pixel
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

  it("identifica o tipo pelo conteúdo real (assinatura do arquivo)", async () => {
    expect(await inspectFile(pdf, "pedido.pdf", limit)).toMatchObject({ ok: true, kind: "PDF", contentType: "application/pdf" });
    expect(await inspectFile(png, "foto.png", limit)).toMatchObject({ ok: true, kind: "IMAGE", contentType: "image/png" });
    expect(await inspectFile(Buffer.from("descricao;quantidade\ncabo 2,5mm;100\n"), "lista.csv", limit)).toMatchObject({ ok: true, kind: "SPREADSHEET" });
  });

  it("recusa executáveis e formatos não suportados, mesmo renomeados", async () => {
    const executable = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]);
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200)]);
    expect((await inspectFile(executable, "pedido.pdf", limit)).ok).toBe(false);
    expect((await inspectFile(zip, "planilha.xlsx", limit)).ok).toBe(false);
    expect((await inspectFile(Buffer.from("<html><script>alert(1)</script></html>"), "pagina.html", limit)).ok).toBe(false);
    expect((await inspectFile(Buffer.from([0, 1, 2, 3, 0, 0, 255, 254, 0, 9, 0]), "lista.csv", limit)).ok).toBe(false);
  });

  it("o tipo gravado vem do conteúdo, nunca do nome informado pelo remetente", async () => {
    // Um PDF chamado "malware.exe" é tratado (e armazenado) como PDF, com extensão definida por nós.
    expect(await inspectFile(pdf, "malware.exe", limit)).toMatchObject({ ok: true, kind: "PDF", contentType: "application/pdf", extension: "pdf" });
    expect(await inspectFile(png, "planilha.xlsx", limit)).toMatchObject({ ok: true, kind: "IMAGE", extension: "png" });
  });

  it("recusa arquivos vazios ou acima do limite", async () => {
    expect((await inspectFile(Buffer.alloc(0), "vazio.pdf", limit)).ok).toBe(false);
    const result = await inspectFile(pdf, "grande.pdf", { maxBytes: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/tamanho|limite|maior/i);
  });

  it("higieniza nomes de arquivo", () => {
    expect(sanitizeFileName("../../etc/passwd")).not.toContain("/");
    expect(sanitizeFileName("pedido\u0000 <script>.pdf")).not.toMatch(/[\u0000<>]/);
    expect(sanitizeFileName("")).toBe("arquivo");
    expect(sanitizeFileName("Orçamento nº 12.pdf")).toContain("12.pdf");
  });
});

describe("papéis e permissões", () => {
  it("leitura não altera nada", () => {
    for (const permission of PERMISSIONS) {
      const allowed = roleCan("VIEWER", permission);
      expect(allowed).toBe(permission.endsWith(":read") && permission !== "audit:read");
    }
  });

  it("vendedor revisa e cota, mas não administra", () => {
    expect(roleCan("SELLER", "request:review")).toBe(true);
    expect(roleCan("SELLER", "quotation:write")).toBe(true);
    expect(roleCan("SELLER", "inbox:upload")).toBe(true);
    for (const permission of ["catalog:write", "catalog:import", "settings:manage", "members:manage", "integrations:manage", "audit:read"] as const) {
      expect(roleCan("SELLER", permission)).toBe(false);
    }
  });

  it("administrador e proprietário têm todas as permissões; atores sem papel, nenhuma", () => {
    for (const permission of PERMISSIONS) {
      expect(roleCan("ADMIN", permission)).toBe(true);
      expect(roleCan("OWNER", permission)).toBe(true);
      expect(roleCan(null, permission)).toBe(false);
    }
  });

  it("apenas proprietários mexem em proprietários", () => {
    expect(canManageRole("ADMIN", "SELLER", "ADMIN")).toBe(true);
    expect(canManageRole("ADMIN", "SELLER", "OWNER")).toBe(false);
    expect(canManageRole("ADMIN", "OWNER", "VIEWER")).toBe(false);
    expect(canManageRole("OWNER", "OWNER", "ADMIN")).toBe(true);
    expect(canManageRole("SELLER", "VIEWER", "SELLER")).toBe(false);
    expect(canManageRole(null, "VIEWER", "SELLER")).toBe(false);
  });
});

describe("identificadores", () => {
  it("IDs malformados viram 'não encontrado' antes de chegar ao banco", () => {
    expect(isUuid("3f2c1d6e-8a4b-4c1d-9e2f-0a1b2c3d4e5f")).toBe(true);
    for (const value of ["1", "abc", "3f2c1d6e-8a4b-4c1d-9e2f-0a1b2c3d4e5f' OR 1=1", "", null, undefined, 42]) {
      expect(isUuid(value)).toBe(false);
      expect(() => parseId(value)).toThrow(/não encontrad/i);
    }
  });
});

describe("validação da configuração de ambiente", () => {
  const base = {
    NODE_ENV: "development",
    APP_URL: "http://localhost:3000",
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    SESSION_SECRET: DEV_PLACEHOLDER_SESSION_SECRET,
    ENCRYPTION_KEY: DEV_PLACEHOLDER_ENCRYPTION_KEY,
    AUTH_PROVIDER: "demo",
    DEMO_PASSWORD: "demo1234",
    STORAGE_DRIVER: "local",
    AI_PROVIDER: "mock",
    QUEUE_DRIVER: "inline",
  };
  const issuesOf = (source: Record<string, string | undefined>): string => {
    try {
      parseEnv(source);
      return "";
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      return (error as EnvValidationError).issues.join("\n");
    }
  };

  it("aceita a configuração local de demonstração", () => {
    expect(parseEnv(base).AI_PROVIDER).toBe("mock");
  });

  it("em produção, recusa segredos de exemplo e autenticação de demonstração", () => {
    const issues = issuesOf({ ...base, NODE_ENV: "production" });
    expect(issues).toMatch(/SESSION_SECRET/);
    expect(issues).toMatch(/ENCRYPTION_KEY/);
    expect(issues).toMatch(/AUTH_PROVIDER/);
  });

  it("exige as credenciais do provedor escolhido — nunca assume que estão configuradas", () => {
    expect(issuesOf({ ...base, AI_PROVIDER: "anthropic" })).toMatch(/ANTHROPIC_API_KEY/);
    expect(issuesOf({ ...base, AI_PROVIDER: "openai" })).toMatch(/OPENAI_API_KEY/);
    expect(issuesOf({ ...base, AUTH_PROVIDER: "supabase" })).toMatch(/SUPABASE_URL/);
    expect(issuesOf({ ...base, STORAGE_DRIVER: "s3" })).toMatch(/S3_BUCKET/);
    expect(issuesOf({ ...base, ENCRYPTION_KEY: "curta" })).toMatch(/ENCRYPTION_KEY/);
    expect(issuesOf({ ...base, DATABASE_URL: undefined })).toMatch(/DATABASE_URL/);
  });
});

describe("segredos locais de desenvolvimento", () => {
  it("os valores 'dev-only-…' do .env.example são recusados em produção", async () => {
    const { parseEnv, isDevOnlySecret } = await import("@/platform/env");
    const production = {
      NODE_ENV: "production",
      APP_URL: "https://app.exemplo.com.br",
      DATABASE_URL: "postgresql://u:p@db:5432/app",
      SESSION_SECRET: "x".repeat(48),
      ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      AUTH_PROVIDER: "supabase",
      SUPABASE_URL: "https://projeto.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_exemplo",
      STORAGE_DRIVER: "local",
      AI_PROVIDER: "mock",
    };
    expect(parseEnv(production).NODE_ENV).toBe("production");
    expect(() => parseEnv({ ...production, WHATSAPP_APP_SECRET: "dev-only-whatsapp-app-secret" })).toThrow(/WHATSAPP_APP_SECRET/);
    expect(() => parseEnv({ ...production, EMAIL_WEBHOOK_SECRET: "dev-only-email-webhook-secret" })).toThrow(/EMAIL_WEBHOOK_SECRET/);
    expect(parseEnv({ ...production, WHATSAPP_APP_SECRET: "chave-real-do-aplicativo" }).WHATSAPP_APP_SECRET).toBe("chave-real-do-aplicativo");
    expect(isDevOnlySecret("dev-only-x")).toBe(true);
    expect(isDevOnlySecret("segredo")).toBe(false);
    expect(isDevOnlySecret(undefined)).toBe(false);
  });
});
