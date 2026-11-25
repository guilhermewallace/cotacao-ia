import { z } from "zod";
import { NotFoundError } from "@/platform/errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Identificadores vindos de URL ou formulário: um valor malformado é tratado como
 * "não encontrado", nunca chega ao banco e não gera erro 500.
 */
export function parseId(value: unknown, resource = "Registro"): string {
  if (!isUuid(value)) throw new NotFoundError(resource);
  return value.toLowerCase();
}

export const idSchema = z.string().regex(UUID_PATTERN, "Identificador inválido");
