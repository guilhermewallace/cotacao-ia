/**
 * Link de conversa do WhatsApp ("click to chat") usado nos botões da página pública.
 *
 * Formato oficial: https://wa.me/<número internacional, só dígitos>?text=<mensagem codificada>
 * (https://faq.whatsapp.com/5913398998672934). É apenas um link: nada é enviado por este sistema,
 * e ele não tem relação com a integração da WhatsApp Business Cloud API em modules/inbox.
 */

/** Número internacional: sem zero à esquerda e com até 15 dígitos (E.164). */
const INTERNATIONAL = /^[1-9]\d{7,14}$/;

/**
 * Número no formato que o wa.me espera: só dígitos, com DDI.
 *
 *  - começando por "+", o número é respeitado como veio;
 *  - 10 ou 11 dígitos sem "+" são lidos como DDD + número do Brasil e recebem o 55
 *    (a mesma convenção de `normalizePhone`, em modules/customers);
 *  - `null` quando não é um telefone plausível.
 */
export function normalizeWhatsappNumber(input: string | null | undefined): string | null {
  const trimmed = (input ?? "").trim();
  const digits = trimmed.replace(/\D/g, "").replace(/^0+/, "");
  if (trimmed.startsWith("+")) return INTERNATIONAL.test(digits) ? digits : null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.length >= 12 && INTERNATIONAL.test(digits) ? digits : null;
}

/** URL que abre a conversa com `number`, já com `message` escrita; `null` se o número for inválido. */
export function whatsappChatUrl(number: string | null | undefined, message?: string | null): string | null {
  const digits = normalizeWhatsappNumber(number);
  if (!digits) return null;
  const text = message?.trim();
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
