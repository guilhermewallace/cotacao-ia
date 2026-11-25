import pino, { type Logger } from "pino";

/**
 * Logs estruturados (JSON por linha). Campos sensíveis são removidos na origem.
 * Não registre conteúdo de documentos nem dados pessoais além de identificadores.
 */

const REDACTED_PATHS = [
  "password",
  "token",
  "accessToken",
  "appSecret",
  "verifyToken",
  "credentials",
  "authorization",
  "cookie",
  "*.password",
  "*.token",
  "*.accessToken",
  "*.appSecret",
  "*.verifyToken",
  "*.credentials",
  "*.authorization",
  "*.cookie",
  "headers.authorization",
  "headers.cookie",
  'headers["x-hub-signature-256"]',
];

let root: Logger | undefined;

function rootLogger(): Logger {
  root ??= pino({
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
    base: { service: process.env.SERVICE_NAME ?? "cotacao-ia" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTED_PATHS, censor: "[REMOVIDO]" },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
  return root;
}

export function logger(bindings?: Record<string, unknown>): Logger {
  return bindings ? rootLogger().child(bindings) : rootLogger();
}

/** Serializa um erro sem depender de `instanceof` entre bundles. */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown };
    return { name: error.name, message: error.message, code: withCode.code, stack: error.stack };
  }
  return { message: String(error) };
}
