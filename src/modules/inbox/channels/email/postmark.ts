import { z } from "zod";
import { htmlToText } from "@/modules/documents/html";
import type { InboundEmailProvider, ParsedInboundEmail, WebhookRequest } from "@/modules/inbox/channels/email/types";
import { safeEqual } from "@/platform/crypto";
import { env } from "@/platform/env";

/**
 * Postmark Inbound: o webhook envia um JSON com o e-mail já interpretado e os anexos
 * em base64. O Postmark não assina as requisições; a autenticação recomendada é
 * HTTP Basic Auth embutido na URL do webhook (https://usuario:senha@host/...).
 */

const addressSchema = z.object({ Email: z.string(), Name: z.string().optional() });

const postmarkSchema = z.object({
  MessageID: z.string().min(1),
  From: z.string().optional(),
  FromFull: addressSchema.optional(),
  FromName: z.string().optional(),
  To: z.string().optional(),
  ToFull: z.array(addressSchema).optional(),
  CcFull: z.array(addressSchema).optional(),
  OriginalRecipient: z.string().optional(),
  Subject: z.string().optional(),
  TextBody: z.string().optional(),
  HtmlBody: z.string().optional(),
  StrippedTextReply: z.string().optional(),
  Date: z.string().optional(),
  Headers: z.array(z.object({ Name: z.string(), Value: z.string() })).optional(),
  Attachments: z
    .array(
      z.object({
        Name: z.string(),
        Content: z.string(),
        ContentType: z.string().optional(),
        ContentID: z.string().optional(),
      }),
    )
    .optional(),
});

export class PostmarkInboundProvider implements InboundEmailProvider {
  readonly id = "postmark";

  isConfigured(): boolean {
    const config = env();
    return Boolean(config.POSTMARK_WEBHOOK_USER && config.POSTMARK_WEBHOOK_PASSWORD);
  }

  authenticate(request: WebhookRequest): boolean {
    const config = env();
    if (!config.POSTMARK_WEBHOOK_USER || !config.POSTMARK_WEBHOOK_PASSWORD) return false;
    const header = request.headers.get("authorization") ?? "";
    if (!header.toLowerCase().startsWith("basic ")) return false;
    const expected = Buffer.from(`${config.POSTMARK_WEBHOOK_USER}:${config.POSTMARK_WEBHOOK_PASSWORD}`).toString("base64");
    return safeEqual(header.slice(6).trim(), expected);
  }

  parse(request: WebhookRequest): ParsedInboundEmail {
    const payload = postmarkSchema.parse(JSON.parse(request.rawBody.toString("utf8")));

    // O Message-ID original do e-mail é mais estável que o MessageID interno do Postmark.
    const messageIdHeader = payload.Headers?.find((header) => header.Name.toLowerCase() === "message-id")?.Value;
    const fromAddress = payload.FromFull?.Email ?? payload.From ?? "";
    const recipients = [
      ...(payload.ToFull ?? []).map((entry) => entry.Email),
      ...(payload.CcFull ?? []).map((entry) => entry.Email),
      payload.OriginalRecipient ?? "",
      ...(payload.To ?? "").split(","),
    ];
    const date = payload.Date ? new Date(payload.Date) : null;

    return {
      messageId: (messageIdHeader ?? payload.MessageID).replace(/^<|>$/g, ""),
      from: { address: fromAddress, name: payload.FromFull?.Name || payload.FromName || null },
      recipients,
      subject: payload.Subject ?? null,
      text: payload.TextBody?.trim() ? payload.TextBody : payload.HtmlBody ? htmlToText(payload.HtmlBody) : null,
      date: date && !Number.isNaN(date.getTime()) ? date : null,
      attachments: (payload.Attachments ?? []).map((attachment) => ({
        fileName: attachment.Name,
        contentType: attachment.ContentType ?? null,
        data: Buffer.from(attachment.Content, "base64"),
        contentId: attachment.ContentID || null,
      })),
    };
  }
}
