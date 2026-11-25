import { randomUUID } from "node:crypto";
import { inspectFile, sanitizeFileName, UPLOAD_FORMATS_LABEL } from "@/modules/documents/inspect";
import { assertCan } from "@/modules/identity/permissions";
import { ingestInboundMessage, type IngestResult } from "@/modules/inbox/ingest";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { maxUploadBytes } from "@/platform/env";
import { NotFoundError, ValidationError } from "@/platform/errors";
import { parseId } from "@/platform/ids";

export const MAX_UPLOAD_FILES = 10;

export interface UploadInput {
  files: Array<{ name: string; data: Buffer }>;
  /** Observação opcional de quem enviou (ex.: "pedido recebido no balcão"). */
  note?: string | null;
  customerId?: string | null;
  /** Chave de idempotência do envio: reenviar o mesmo formulário não cria outra solicitação. */
  idempotencyKey?: string | null;
}

/**
 * Canal "upload manual". Todos os arquivos são validados antes de qualquer gravação:
 * um arquivo inválido recusa o envio inteiro, com o motivo de cada recusa.
 */
export async function ingestUpload(ctx: TenantContext, input: UploadInput): Promise<IngestResult> {
  assertCan(ctx, "inbox:upload");
  if (ctx.actorType !== "USER" || !ctx.userId) throw new ValidationError("Envio manual requer um usuário autenticado.");

  if (input.files.length === 0) throw new ValidationError("Selecione ao menos um arquivo.");
  if (input.files.length > MAX_UPLOAD_FILES) throw new ValidationError(`Envie no máximo ${MAX_UPLOAD_FILES} arquivos por vez.`);

  const problems: string[] = [];
  for (const file of input.files) {
    const inspected = await inspectFile(file.data, file.name, { maxBytes: maxUploadBytes() });
    if (!inspected.ok) problems.push(`${sanitizeFileName(file.name)}: ${inspected.reason}`);
  }
  if (problems.length > 0) {
    throw new ValidationError(`Arquivo recusado. Formatos aceitos: ${UPLOAD_FORMATS_LABEL}. ${problems.join(" ")}`, { problems });
  }

  let customerId: string | null = null;
  if (input.customerId) {
    customerId = parseId(input.customerId, "Cliente");
    const customer = await tenantDb(ctx.organizationId).customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundError("Cliente");
  }

  const key = input.idempotencyKey?.trim();
  const externalId = key && /^[\w-]{8,100}$/.test(key) ? `upload:${key}` : `upload:${randomUUID()}`;
  const uploader = await tenantDb(ctx.organizationId).membership.findFirst({
    where: { userId: ctx.userId },
    select: { user: { select: { name: true, email: true } } },
  });

  return ingestInboundMessage(ctx, {
    channel: "UPLOAD",
    externalId,
    senderName: uploader?.user.name ?? null,
    senderAddress: uploader?.user.email ?? null,
    text: input.note?.trim() || null,
    receivedAt: new Date(),
    uploadedById: ctx.userId,
    customerId,
    attachments: input.files.map((file) => ({ source: "inline" as const, fileName: file.name, data: file.data })),
  });
}
