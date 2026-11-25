import os from "node:os";
import path from "node:path";

/**
 * Ambiente dos testes: nenhum serviço externo, provedor de IA mock, fila em linha
 * e storage em disco temporário. Executado antes de cada arquivo de teste.
 */

export const DEFAULT_TEST_DATABASE_URL = "postgresql://cotacao:cotacao@localhost:5432/cotacao_test";

const testEnv: Record<string, string> = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  LOG_LEVEL: "silent",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL,
  QUEUE_DRIVER: "inline",
  AUTH_PROVIDER: "demo",
  SESSION_SECRET: "test-session-secret-0123456789-0123456789",
  DEMO_PASSWORD: "senha-de-teste",
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  STORAGE_DRIVER: "local",
  LOCAL_STORAGE_DIR: path.join(os.tmpdir(), "cotacao-ia-test-storage"),
  AI_PROVIDER: "mock",
  TRANSCRIPTION_PROVIDER: "mock",
  WHATSAPP_APP_SECRET: "test-whatsapp-app-secret",
  WHATSAPP_VERIFY_TOKEN: "test-verify-token",
  EMAIL_INBOUND_DOMAIN: "inbound.test.example",
  EMAIL_WEBHOOK_SECRET: "test-email-webhook-secret",
  POSTMARK_WEBHOOK_USER: "postmark",
  POSTMARK_WEBHOOK_PASSWORD: "test-postmark-password",
};

if (!new URL(testEnv.DATABASE_URL ?? "").pathname.endsWith("_test")) {
  throw new Error('Por segurança, os testes só rodam em um banco cujo nome termina em "_test".');
}

for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] = value;
}
