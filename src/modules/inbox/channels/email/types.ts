/**
 * Abstração do provedor de recebimento de e-mails.
 *
 * Cada provedor (Postmark, SendGrid, Mailgun, SES, um encaminhador próprio...) entrega
 * e-mails por webhook em um formato diferente. Um adaptador implementa esta interface
 * convertendo a requisição em `ParsedInboundEmail`; o restante do fluxo é o mesmo.
 * Para adicionar um provedor: crie o adaptador e registre-o em `providers.ts`.
 */

export interface WebhookRequest {
  headers: Headers;
  rawBody: Buffer;
}

export interface ParsedEmailAttachment {
  fileName: string;
  contentType: string | null;
  data: Buffer;
  /** Preenchido quando o anexo é uma imagem embutida no corpo (assinaturas, logotipos). */
  contentId: string | null;
}

export interface ParsedInboundEmail {
  /** Message-ID do e-mail (ou identificador único do provedor) — base da idempotência. */
  messageId: string;
  from: { address: string; name: string | null };
  /** Todos os destinatários conhecidos (To, Cc, destinatário original). */
  recipients: string[];
  subject: string | null;
  text: string | null;
  date: Date | null;
  attachments: ParsedEmailAttachment[];
}

export interface InboundEmailProvider {
  readonly id: string;
  /** O servidor tem as credenciais deste provedor? Sem elas, o endpoint responde 503. */
  isConfigured(): boolean;
  /** Autentica a origem da requisição (assinatura, Basic Auth...). */
  authenticate(request: WebhookRequest): boolean;
  /** Converte o payload. Lança erro se o formato for inválido. */
  parse(request: WebhookRequest): ParsedInboundEmail;
}
