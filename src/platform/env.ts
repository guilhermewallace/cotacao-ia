import { z } from "zod";

/**
 * Variáveis de ambiente validadas.
 *
 * A validação é preguiçosa (`env()`), para que `next build` e ferramentas que apenas
 * importam módulos não exijam um ambiente completo. Qualquer leitura em tempo de
 * execução passa por aqui — nunca use `process.env` diretamente nos módulos.
 */

/** Valores do `.env.example`: aceitáveis em desenvolvimento, recusados em produção. */
export const DEV_PLACEHOLDER_SESSION_SECRET = "dev-only-session-secret-change-me-0123456789";
export const DEV_PLACEHOLDER_ENCRYPTION_KEY = "ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE=";

/** Prefixo dos segredos de exemplo do `.env.example`. Valores com ele são recusados em produção. */
export const DEV_ONLY_PREFIX = "dev-only-";

export function isDevOnlySecret(value: string | undefined | null): boolean {
  return typeof value === "string" && value.startsWith(DEV_ONLY_PREFIX);
}

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const flag = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? defaultValue : ["1", "true", "yes", "on"].includes(v.trim().toLowerCase())));

const integer = (defaultValue: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? defaultValue : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
    DATABASE_POOL_MAX: integer(10, 1, 200),

    REDIS_URL: z.string().default("redis://localhost:6379"),
    QUEUE_DRIVER: z.enum(["bullmq", "inline"]).default("bullmq"),
    WORKER_CONCURRENCY: integer(4, 1, 64),

    AUTH_PROVIDER: z.enum(["demo", "supabase"]).default("demo"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET deve ter ao menos 32 caracteres"),
    DEMO_PASSWORD: z.string().min(8).default("demo1234"),
    ALLOW_DEMO_AUTH_IN_PRODUCTION: flag(false),
    SUPABASE_URL: optionalString,
    SUPABASE_PUBLISHABLE_KEY: optionalString,

    ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY é obrigatória"),

    STORAGE_DRIVER: z.enum(["s3", "local"]).default("local"),
    LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
    S3_ENDPOINT: optionalString,
    S3_PUBLIC_ENDPOINT: optionalString,
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: flag(true),
    /** Cria o bucket antes da primeira gravação, se faltar. Para desenvolvimento; em produção, deixe desligado. */
    S3_AUTO_CREATE_BUCKET: flag(false),
    SIGNED_URL_TTL_SECONDS: integer(300, 30, 3600),
    MAX_UPLOAD_MB: integer(20, 1, 100),

    AI_PROVIDER: z.enum(["mock", "anthropic", "openai"]).default("mock"),
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
    OPENAI_API_KEY: optionalString,
    OPENAI_MODEL: z.string().default("gpt-6.2-astra"),
    TRANSCRIPTION_PROVIDER: z.enum(["none", "openai", "mock"]).default("none"),
    OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-transcribe"),

    WHATSAPP_APP_SECRET: optionalString,
    WHATSAPP_VERIFY_TOKEN: optionalString,
    WHATSAPP_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v25.0"),

    EMAIL_INBOUND_DOMAIN: z.string().default("inbound.cotacao.localhost"),
    EMAIL_WEBHOOK_SECRET: optionalString,
    POSTMARK_WEBHOOK_USER: optionalString,
    POSTMARK_WEBHOOK_PASSWORD: optionalString,

    /**
     * Página pública ("/"): WhatsApp do contato comercial, com DDI e DDD (ex.: 5511999999999).
     * Sem número, os botões da página levam às demonstrações dela mesma.
     */
    LANDING_WHATSAPP_NUMBER: optionalString,
    /** Mensagem que já vem escrita na conversa aberta pelos botões da página pública. */
    LANDING_WHATSAPP_MESSAGE: z.string().trim().max(300).default("Olá! Vi a página do Cotação IA e quero saber mais."),
  })
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const isProduction = value.NODE_ENV === "production";

    const key = Buffer.from(value.ENCRYPTION_KEY, "base64");
    if (key.length !== 32) {
      issue("ENCRYPTION_KEY", "ENCRYPTION_KEY deve ser uma chave de 32 bytes em base64 (gere com: openssl rand -base64 32)");
    }

    if (value.AUTH_PROVIDER === "supabase") {
      if (!value.SUPABASE_URL) issue("SUPABASE_URL", "SUPABASE_URL é obrigatória quando AUTH_PROVIDER=supabase");
      if (!value.SUPABASE_PUBLISHABLE_KEY) {
        issue("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY é obrigatória quando AUTH_PROVIDER=supabase");
      }
    }
    if (value.AUTH_PROVIDER === "demo" && isProduction && !value.ALLOW_DEMO_AUTH_IN_PRODUCTION) {
      issue(
        "AUTH_PROVIDER",
        "AUTH_PROVIDER=demo não é permitido em produção. Use AUTH_PROVIDER=supabase ou, apenas para ambientes de demonstração, defina ALLOW_DEMO_AUTH_IN_PRODUCTION=true.",
      );
    }

    if (value.STORAGE_DRIVER === "s3") {
      for (const name of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!value[name]) issue(name, `${name} é obrigatória quando STORAGE_DRIVER=s3`);
      }
    }

    if (value.AI_PROVIDER === "anthropic" && !value.ANTHROPIC_API_KEY) {
      issue("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY é obrigatória quando AI_PROVIDER=anthropic");
    }
    if (value.AI_PROVIDER === "openai" && !value.OPENAI_API_KEY) {
      issue("OPENAI_API_KEY", "OPENAI_API_KEY é obrigatória quando AI_PROVIDER=openai");
    }
    if (value.TRANSCRIPTION_PROVIDER === "openai" && !value.OPENAI_API_KEY) {
      issue("OPENAI_API_KEY", "OPENAI_API_KEY é obrigatória quando TRANSCRIPTION_PROVIDER=openai");
    }

    if (value.LANDING_WHATSAPP_NUMBER) {
      const digits = value.LANDING_WHATSAPP_NUMBER.replace(/\D/g, "").replace(/^0+/, "");
      if (digits.length < 10 || digits.length > 15) {
        issue("LANDING_WHATSAPP_NUMBER", "LANDING_WHATSAPP_NUMBER deve ser um telefone com DDI e DDD, só dígitos (ex.: 5511999999999)");
      }
    }

    if (isProduction) {
      // Segredos locais de webhook (usados só pelo simulador) nunca valem em produção.
      for (const name of ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "EMAIL_WEBHOOK_SECRET", "POSTMARK_WEBHOOK_PASSWORD"] as const) {
        if (isDevOnlySecret(value[name])) issue(name, `${name} está com um valor local de desenvolvimento ("${DEV_ONLY_PREFIX}…"); use o segredo real em produção`);
      }
      if (value.SESSION_SECRET === DEV_PLACEHOLDER_SESSION_SECRET) {
        issue("SESSION_SECRET", "SESSION_SECRET está com o valor de exemplo; gere um segredo próprio para produção");
      }
      if (value.ENCRYPTION_KEY === DEV_PLACEHOLDER_ENCRYPTION_KEY) {
        issue("ENCRYPTION_KEY", "ENCRYPTION_KEY está com o valor de exemplo; gere uma chave própria para produção");
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuração de ambiente inválida:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`));
  }
  return result.data;
}

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Apenas para testes: força a releitura de `process.env`. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function maxUploadBytes(): number {
  return env().MAX_UPLOAD_MB * 1024 * 1024;
}

/** Verdadeiro quando o ambiente não usa nenhum serviço externo de IA. */
export function isMockAi(): boolean {
  return env().AI_PROVIDER === "mock";
}
