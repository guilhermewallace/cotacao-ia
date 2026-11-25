import { z } from "zod";
import type { IncomingAttachment } from "@/modules/inbox/ingest";

/**
 * Estrutura das notificações da WhatsApp Business Cloud API (objeto
 * `whatsapp_business_account`, campo `messages`). Apenas os campos usados são
 * validados; o restante é ignorado para tolerar evoluções da API.
 */

const mediaSchema = z.object({
  id: z.string().min(1),
  mime_type: z.string().optional(),
  sha256: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
});

const messageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: mediaSchema.optional(),
  document: mediaSchema.optional(),
  audio: mediaSchema.optional(),
  button: z.object({ text: z.string().optional() }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ title: z.string().optional() }).optional(),
      list_reply: z.object({ title: z.string().optional() }).optional(),
    })
    .optional(),
});

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  timestamp: z.string().optional(),
  recipient_id: z.string().optional(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional(),
});

const changeSchema = z.object({
  field: z.string(),
  value: z
    .object({
      messaging_product: z.string().optional(),
      metadata: z.object({ phone_number_id: z.string().min(1), display_phone_number: z.string().optional() }).optional(),
      contacts: z.array(z.object({ wa_id: z.string().optional(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
      messages: z.array(z.unknown()).optional(),
      statuses: z.array(z.unknown()).optional(),
    })
    .optional(),
});

export const whatsAppWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({ id: z.string().optional(), changes: z.array(changeSchema).optional() })).optional(),
});

export interface WhatsAppInboundMessage {
  phoneNumberId: string;
  externalId: string;
  from: string;
  senderName: string | null;
  receivedAt: Date;
  type: string;
  text: string | null;
  attachments: IncomingAttachment[];
}

export interface WhatsAppStatusEvent {
  phoneNumberId: string;
  /** ID da mensagem enviada a que o status se refere. */
  messageId: string;
  status: string;
  recipient: string | null;
  occurredAt: Date | null;
  errors: Array<{ code?: number; title?: string }>;
}

export interface ParsedWhatsAppWebhook {
  messages: WhatsAppInboundMessage[];
  statuses: WhatsAppStatusEvent[];
  /** Mensagens de tipos não tratados (figurinha, localização, reação...). */
  ignored: number;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "text/csv": "csv",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function fromUnixSeconds(value: string | undefined): Date | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

function baseMime(mimeType: string | undefined): string | null {
  // "audio/ogg; codecs=opus" → "audio/ogg"
  return mimeType ? (mimeType.split(";")[0]?.trim().toLowerCase() ?? null) : null;
}

function mediaAttachment(media: z.infer<typeof mediaSchema>, fallbackName: string): IncomingAttachment {
  const mime = baseMime(media.mime_type);
  const extension = mime ? EXTENSION_BY_MIME[mime] : undefined;
  return {
    source: "remote",
    externalMediaId: media.id,
    declaredType: mime,
    fileName: media.filename ?? (extension ? `${fallbackName}.${extension}` : fallbackName),
  };
}

export function parseWhatsAppWebhook(payload: unknown): ParsedWhatsAppWebhook {
  const parsed = whatsAppWebhookSchema.parse(payload);
  const result: ParsedWhatsAppWebhook = { messages: [], statuses: [], ignored: 0 };
  if (parsed.object !== "whatsapp_business_account") return result;

  for (const entry of parsed.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (change.field !== "messages" || !value || !phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) names.set(contact.wa_id, contact.profile.name);
      }

      for (const rawMessage of value.messages ?? []) {
        const message = messageSchema.safeParse(rawMessage);
        if (!message.success) {
          result.ignored += 1;
          continue;
        }
        const data = message.data;
        const attachments: IncomingAttachment[] = [];
        let text: string | null = null;

        switch (data.type) {
          case "text":
            text = data.text?.body ?? null;
            break;
          case "image":
            if (data.image) {
              attachments.push(mediaAttachment(data.image, "imagem-whatsapp"));
              text = data.image.caption ?? null;
            }
            break;
          case "document":
            if (data.document) {
              attachments.push(mediaAttachment(data.document, "documento-whatsapp"));
              text = data.document.caption ?? null;
            }
            break;
          case "audio":
            if (data.audio) attachments.push(mediaAttachment(data.audio, "audio-whatsapp"));
            break;
          case "button":
            text = data.button?.text ?? null;
            break;
          case "interactive":
            text = data.interactive?.button_reply?.title ?? data.interactive?.list_reply?.title ?? null;
            break;
          default:
            break;
        }

        if (!text?.trim() && attachments.length === 0) {
          result.ignored += 1;
          continue;
        }
        result.messages.push({
          phoneNumberId,
          externalId: data.id,
          from: data.from,
          senderName: names.get(data.from) ?? null,
          receivedAt: fromUnixSeconds(data.timestamp) ?? new Date(),
          type: data.type,
          text: text?.trim() ? text : null,
          attachments,
        });
      }

      for (const rawStatus of value.statuses ?? []) {
        const status = statusSchema.safeParse(rawStatus);
        if (!status.success) continue;
        result.statuses.push({
          phoneNumberId,
          messageId: status.data.id,
          status: status.data.status,
          recipient: status.data.recipient_id ?? null,
          occurredAt: fromUnixSeconds(status.data.timestamp),
          errors: status.data.errors ?? [],
        });
      }
    }
  }
  return result;
}
