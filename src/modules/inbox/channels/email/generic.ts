import { z } from "zod";
import { htmlToText } from "@/modules/documents/html";
import type { InboundEmailProvider, ParsedInboundEmail, WebhookRequest } from "@/modules/inbox/channels/email/types";
import { hmacSha256Hex, safeEqual } from "@/platform/crypto";
import { env } from "@/platform/env";

/**
 * Webhook genérico de e-mail, com assinatura HMAC.
 *
 * Serve para qualquer origem capaz de enviar um POST JSON: um encaminhador próprio,
 * um Cloudflare Email Worker, uma automação (n8n, Make) ou outro provedor adaptado.
 *
 * Cabeçalho:  X-Cotacao-Signature: t=<unix em segundos>,v1=<hex>
 * Assinatura: HMAC-SHA256(EMAIL_WEBHOOK_SECRET, "<t>.<corpo bruto>")
 * Requisições com mais de 5 minutos são recusadas (proteção contra repetição).
 */

export const GENERIC_SIGNATURE_HEADER = "x-cotacao-signature";
const TOLERANCE_SECONDS = 300;

const genericSchema = z.object({
  messageId: z.string().min(1).max(300),
  from: z.object({ address: z.string().min(3), name: z.string().nullish() }),
  to: z.array(z.string()).min(1),
  subject: z.string().nullish(),
  text: z.string().nullish(),
  html: z.string().nullish(),
  date: z.string().nullish(),
  attachments: z
    .array(
      z.object({
        fileName: z.string().min(1),
        contentType: z.string().nullish(),
        contentBase64: z.string(),
        contentId: z.string().nullish(),
      }),
    )
    .optional(),
});

export type GenericEmailPayload = z.input<typeof genericSchema>;

export function signGenericEmailPayload(rawBody: string | Buffer, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = hmacSha256Hex(secret, Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.from(rawBody)]));
  return `t=${timestamp},v1=${signature}`;
}

export function verifyGenericEmailSignature(rawBody: Buffer, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key ?? "", rest.join("=")];
    }),
  ) as Record<string, string | undefined>;
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isInteger(timestamp) || !signature) return false;
  if (Math.abs(now / 1000 - timestamp) > TOLERANCE_SECONDS) return false;
  const expected = hmacSha256Hex(secret, Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]));
  return safeEqual(expected, signature.toLowerCase());
}

export class GenericInboundProvider implements InboundEmailProvider {
  readonly id = "generic";

  isConfigured(): boolean {
    return Boolean(env().EMAIL_WEBHOOK_SECRET);
  }

  authenticate(request: WebhookRequest): boolean {
    const secret = env().EMAIL_WEBHOOK_SECRET;
    if (!secret) return false;
    return verifyGenericEmailSignature(request.rawBody, request.headers.get(GENERIC_SIGNATURE_HEADER), secret);
  }

  parse(request: WebhookRequest): ParsedInboundEmail {
    const payload = genericSchema.parse(JSON.parse(request.rawBody.toString("utf8")));
    const date = payload.date ? new Date(payload.date) : null;
    return {
      messageId: payload.messageId.replace(/^<|>$/g, ""),
      from: { address: payload.from.address, name: payload.from.name ?? null },
      recipients: payload.to,
      subject: payload.subject ?? null,
      text: payload.text?.trim() ? payload.text : payload.html ? htmlToText(payload.html) : null,
      date: date && !Number.isNaN(date.getTime()) ? date : null,
      attachments: (payload.attachments ?? []).map((attachment) => ({
        fileName: attachment.fileName,
        contentType: attachment.contentType ?? null,
        data: Buffer.from(attachment.contentBase64, "base64"),
        contentId: attachment.contentId ?? null,
      })),
    };
  }
}
