import { describe, expect, it } from "vitest";
import { buildWhatsAppTextWebhook } from "@/demo/simulate";
import { signGenericEmailPayload, verifyGenericEmailSignature } from "@/modules/inbox/channels/email/generic";
import { extractAddress, findInboundKey } from "@/modules/inbox/channels/email/handler";
import { handleWhatsAppVerification } from "@/modules/inbox/channels/whatsapp/handler";
import { parseWhatsAppWebhook } from "@/modules/inbox/channels/whatsapp/payload";
import { signMetaPayload, verifyMetaSignature } from "@/modules/inbox/channels/whatsapp/signature";

const SECRET = "segredo-do-aplicativo";

describe("assinatura do webhook da Meta (X-Hub-Signature-256)", () => {
  const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));

  it("aceita o corpo assinado com a chave do aplicativo", () => {
    expect(verifyMetaSignature(body, signMetaPayload(body, SECRET), SECRET)).toBe(true);
  });

  it("recusa corpo adulterado, chave errada e cabeçalho ausente ou malformado", () => {
    const signature = signMetaPayload(body, SECRET);
    expect(verifyMetaSignature(Buffer.from(body.toString().replace("entry", "entrY")), signature, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, signMetaPayload(body, "outra-chave"), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abcdef", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, signature.replace("sha256=", ""), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, signature, "")).toBe(false);
  });
});

describe("verificação do endpoint (hub.challenge)", () => {
  it("devolve o desafio apenas com o token correto", () => {
    const ok = handleWhatsAppVerification(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "test-verify-token", "hub.challenge": "12345" }));
    expect(ok).toEqual({ status: 200, body: "12345" });
    const wrong = handleWhatsAppVerification(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "12345" }));
    expect(wrong.status).toBe(403);
    expect(handleWhatsAppVerification(new URLSearchParams()).status).toBe(403);
  });
});

describe("interpretação das notificações do WhatsApp", () => {
  it("lê mensagens de texto", () => {
    const parsed = parseWhatsAppWebhook(
      buildWhatsAppTextWebhook({ phoneNumberId: "100000000000001", displayPhoneNumber: "+55 11 90000-0001", from: "5511900000505", profileName: "Paulo", text: "10 disjuntor 32A", messageId: "wamid.TESTE1" }),
    );
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({ phoneNumberId: "100000000000001", externalId: "wamid.TESTE1", from: "5511900000505", senderName: "Paulo", text: "10 disjuntor 32A" });
    expect(parsed.statuses).toHaveLength(0);
  });

  it("lê documentos, imagens e áudios como anexos a baixar depois", () => {
    const base = buildWhatsAppTextWebhook({ phoneNumberId: "1000000001", displayPhoneNumber: "+55 11 90000-0001", from: "5511900000505", profileName: "Paulo", text: "x" }) as {
      entry: Array<{ changes: Array<{ value: { messages: unknown[] } }> }>;
    };
    base.entry[0]!.changes[0]!.value.messages = [
      { from: "5511900000505", id: "wamid.DOC", timestamp: "1795000000", type: "document", document: { id: "MEDIA1", mime_type: "application/pdf", filename: "pedido.pdf", caption: "segue pedido" } },
      { from: "5511900000505", id: "wamid.IMG", timestamp: "1795000001", type: "image", image: { id: "MEDIA2", mime_type: "image/jpeg" } },
      { from: "5511900000505", id: "wamid.AUD", timestamp: "1795000002", type: "audio", audio: { id: "MEDIA3", mime_type: "audio/ogg; codecs=opus" } },
      { from: "5511900000505", id: "wamid.STK", timestamp: "1795000003", type: "sticker", sticker: { id: "MEDIA4" } },
    ];
    const parsed = parseWhatsAppWebhook(base);
    expect(parsed.messages.map((message) => message.type)).toEqual(["document", "image", "audio"]);
    expect(parsed.ignored).toBe(1);
    const [document, image, audio] = parsed.messages;
    expect(document?.text).toBe("segue pedido");
    expect(document?.attachments[0]).toMatchObject({ source: "remote", externalMediaId: "MEDIA1", fileName: "pedido.pdf", declaredType: "application/pdf" });
    expect(image?.attachments[0]).toMatchObject({ source: "remote", externalMediaId: "MEDIA2" });
    expect(audio?.attachments[0]).toMatchObject({ source: "remote", externalMediaId: "MEDIA3" });
  });

  it("lê eventos de status sem tratá-los como mensagens", () => {
    const parsed = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "5511900000001", phone_number_id: "100000000000001" },
                statuses: [{ id: "wamid.ENVIADA", status: "delivered", timestamp: "1795000000", recipient_id: "5511900000505" }],
              },
            },
          ],
        },
      ],
    });
    expect(parsed.messages).toHaveLength(0);
    expect(parsed.statuses[0]).toMatchObject({ messageId: "wamid.ENVIADA", status: "delivered", phoneNumberId: "100000000000001" });
  });

  it("ignora objetos de outros produtos da Meta e recusa payloads malformados", () => {
    expect(parseWhatsAppWebhook({ object: "page", entry: [] })).toEqual({ messages: [], statuses: [], ignored: 0 });
    expect(() => parseWhatsAppWebhook("texto")).toThrow();
    expect(() => parseWhatsAppWebhook({ entry: [] })).toThrow();
  });
});

describe("webhook genérico de e-mail (HMAC com carimbo de tempo)", () => {
  const body = Buffer.from('{"messageId":"<1@exemplo>"}');

  it("aceita assinatura válida e recente", () => {
    expect(verifyGenericEmailSignature(body, signGenericEmailPayload(body, SECRET), SECRET)).toBe(true);
  });

  it("recusa assinatura antiga (replay), adulterada ou ausente", () => {
    const old = signGenericEmailPayload(body, SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyGenericEmailSignature(body, old, SECRET)).toBe(false);
    expect(verifyGenericEmailSignature(Buffer.from("{}"), signGenericEmailPayload(body, SECRET), SECRET)).toBe(false);
    expect(verifyGenericEmailSignature(body, signGenericEmailPayload(body, "outro"), SECRET)).toBe(false);
    expect(verifyGenericEmailSignature(body, null, SECRET)).toBe(false);
    expect(verifyGenericEmailSignature(body, "t=abc,v1=xyz", SECRET)).toBe(false);
  });
});

describe("roteamento de e-mails pelo endereço exclusivo da organização", () => {
  it("extrai o endereço de cabeçalhos com nome", () => {
    expect(extractAddress('"Compras" <Compras@Cliente.example>')).toBe("compras@cliente.example");
    expect(extractAddress("sem endereço")).toBeNull();
  });

  it("encontra a chave da organização apenas no domínio de entrada", () => {
    const domain = "inbound.test.example";
    expect(findInboundKey(["Vendas <eletricacentral-demo@inbound.test.example>"], domain)).toBe("eletricacentral-demo");
    // plus addressing: "qualquercoisa+chave@dominio"
    expect(findInboundKey(["cotacoes+eletricacentral-demo@inbound.test.example"], domain)).toBe("eletricacentral-demo");
    expect(findInboundKey(["alguem@outro-dominio.example", "x@inbound.test.example.evil.example"], domain)).toBeNull();
    expect(findInboundKey([], domain)).toBeNull();
  });
});
