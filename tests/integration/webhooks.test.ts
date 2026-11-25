import { randomInt } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readDemoFixture } from "@/demo/mock-fixtures";
import { FIXTURE_FILES } from "@/demo/scenarios";
import { buildWhatsAppTextWebhook } from "@/demo/simulate";
import { createCustomer } from "@/modules/customers/customers";
import { GENERIC_SIGNATURE_HEADER, signGenericEmailPayload, type GenericEmailPayload } from "@/modules/inbox/channels/email/generic";
import { handleInboundEmailWebhook } from "@/modules/inbox/channels/email/handler";
import { handleWhatsAppWebhook } from "@/modules/inbox/channels/whatsapp/handler";
import { MediaDownloadError, setWhatsAppMediaClientForTests, type WhatsAppMediaClient } from "@/modules/inbox/channels/whatsapp/media";
import { signMetaPayload } from "@/modules/inbox/channels/whatsapp/signature";
import { disconnectWhatsAppIntegration, getWhatsAppIntegration, inboundAddress, saveWhatsAppIntegration, setEmailIntegrationEnabled } from "@/modules/integrations/integrations";
import { getRequestDetail, listRequests } from "@/modules/requests/queries";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { getPrisma } from "@/platform/db";
import { env } from "@/platform/env";
import { createTestOrganization, settleJobs, type TestOrganization } from "../helpers/factory";

/**
 * WEBHOOKS — autenticidade, roteamento por organização e IDEMPOTÊNCIA.
 * Os handlers são os mesmos chamados pelas rotas /api/webhooks/*; aqui recebem o corpo bruto
 * e os cabeçalhos, exatamente como chegariam da Meta ou do provedor de e-mail.
 */

interface Tenant {
  org: TestOrganization;
  phoneNumberId: string;
  address: string;
}

const ACCESS_TOKEN = "EAAG-token-de-teste-nao-real-1234567890";
let a: Tenant;
let b: Tenant;

async function tenant(label: string): Promise<Tenant> {
  const org = await createTestOrganization(label, { withDemoCatalog: true });
  const phoneNumberId = `${randomInt(10_000_000, 99_999_999)}${randomInt(10_000_000, 99_999_999)}`;
  await saveWhatsAppIntegration(org.owner, { phoneNumberId, displayPhoneNumber: "+55 11 90000-0001", accessToken: ACCESS_TOKEN });
  await setEmailIntegrationEnabled(org.owner, true);
  const { inboundEmailKey } = await getPrisma().organization.findUniqueOrThrow({ where: { id: org.id }, select: { inboundEmailKey: true } });
  return { org, phoneNumberId, address: inboundAddress(inboundEmailKey) };
}

const whatsappSecret = () => env().WHATSAPP_APP_SECRET as string;
const emailSecret = () => env().EMAIL_WEBHOOK_SECRET as string;

function deliverWhatsApp(payload: unknown, options: { signature?: string | null } = {}) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = options.signature === undefined ? signMetaPayload(rawBody, whatsappSecret()) : options.signature;
  return handleWhatsAppWebhook({ rawBody, signature });
}

function textMessage(target: Tenant, text: string, messageId: string, from = "5511900000505") {
  return buildWhatsAppTextWebhook({ phoneNumberId: target.phoneNumberId, displayPhoneNumber: "+55 11 90000-0001", from, profileName: "Paulo Meireles", text, messageId });
}

function mediaMessage(target: Tenant, messageId: string, media: { id: string; mime_type: string; filename?: string }) {
  const payload = textMessage(target, "x", messageId) as { entry: Array<{ changes: Array<{ value: { messages: unknown[] } }> }> };
  payload.entry[0]!.changes[0]!.value.messages = [{ from: "5511900000505", id: messageId, timestamp: String(Math.floor(Date.now() / 1000)), type: "document", document: media }];
  return payload;
}

function deliverEmail(payload: GenericEmailPayload, options: { signature?: string } = {}) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const headers = new Headers({ "content-type": "application/json", [GENERIC_SIGNATURE_HEADER]: options.signature ?? signGenericEmailPayload(rawBody, emailSecret()) });
  return handleInboundEmailWebhook("generic", { headers, rawBody });
}

const email = (target: Tenant, messageId: string, overrides: Partial<GenericEmailPayload> = {}): GenericEmailPayload => ({
  messageId,
  from: { address: "compras@cliente.example", name: "Marina Duarte" },
  to: [target.address],
  subject: "Pedido de cotação",
  text: "Favor cotar:\n10 disjuntores tripolares 32A curva C\n200 m cabo flexível 2,5mm² azul",
  ...overrides,
});

const messagesOf = (target: Tenant) => tenantDb(target.org.id).inboundMessage.count();

beforeAll(async () => {
  a = await tenant("hooka");
  b = await tenant("hookb");
});

afterEach(() => setWhatsAppMediaClientForTests(undefined));

describe("WhatsApp Business Cloud API", () => {
  it("mensagem autêntica vira solicitação na organização dona do número", async () => {
    await createCustomer(a.org.owner, { name: "Instaladora Luz & Força", phone: "(11) 90000-0505" });
    const response = await deliverWhatsApp(textMessage(a, "Bom dia!\n- 10 disjuntores tripolares 32A curva C\n- 4 disjuntor tripolar 80A curva C", "wamid.A1"));
    expect(response).toMatchObject({ status: 200, body: { received: 1, duplicates: 0 } });
    await settleJobs();

    const requests = await listRequests(a.org.owner);
    expect(requests.items).toHaveLength(1);
    expect(requests.items[0]).toMatchObject({ channel: "WHATSAPP", status: "AWAITING_REVIEW", senderName: "Paulo Meireles", customerName: "Instaladora Luz & Força", itemsCount: 2 });
    expect(await messagesOf(b)).toBe(0);
  });

  it("idempotência: a mesma notificação reenviada (ou entregue em paralelo) não duplica nada", async () => {
    const payload = textMessage(a, "- 5 contator 25A bobina 220V", "wamid.A2");
    const before = await messagesOf(a);

    const first = await deliverWhatsApp(payload);
    const replay = await deliverWhatsApp(payload);
    expect(first.body).toMatchObject({ received: 1, duplicates: 0 });
    expect(replay).toMatchObject({ status: 200, body: { received: 0, duplicates: 1 } });

    // reentrega do mesmo wamid dentro de outro envelope
    const again = await deliverWhatsApp(textMessage(a, "- 5 contator 25A bobina 220V (reenviado)", "wamid.A2"));
    expect(again.body).toMatchObject({ received: 0, duplicates: 1 });

    // entregas simultâneas da mesma mensagem
    const concurrent = textMessage(a, "- 3 relé térmico 17-25A", "wamid.A3");
    const results = await Promise.all([deliverWhatsApp(concurrent), deliverWhatsApp(concurrent), deliverWhatsApp(concurrent)]);
    expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(results.reduce((sum, result) => sum + (result.body as { received: number }).received, 0)).toBe(1);

    await settleJobs();
    const db = tenantDb(a.org.id);
    expect(await messagesOf(a)).toBe(before + 2);
    expect(await db.inboundMessage.count({ where: { externalId: "wamid.A2" } })).toBe(1);
    expect(await db.inboundMessage.count({ where: { externalId: "wamid.A3" } })).toBe(1);
    expect(await db.quotationRequest.count()).toBe(before + 2);
    expect(await db.processingJob.count({ where: { type: "PROCESS_INBOUND_MESSAGE" } })).toBe(before + 2);
  });

  it("recusa notificações sem assinatura válida, sem gravar nada", async () => {
    const payload = textMessage(a, "- 1 fonte 24V", "wamid.FORJADA");
    const before = await messagesOf(a);
    expect((await deliverWhatsApp(payload, { signature: null })).status).toBe(401);
    expect((await deliverWhatsApp(payload, { signature: "sha256=" + "0".repeat(64) })).status).toBe(401);
    expect((await deliverWhatsApp(payload, { signature: signMetaPayload(JSON.stringify(payload), "outra-chave") })).status).toBe(401);
    // assinatura de OUTRO corpo
    expect((await deliverWhatsApp(payload, { signature: signMetaPayload("{}", whatsappSecret()) })).status).toBe(401);
    expect(await messagesOf(a)).toBe(before);
    expect(await tenantDb(a.org.id).inboundMessage.count({ where: { externalId: "wamid.FORJADA" } })).toBe(0);
  });

  it("corpo assinado mas malformado é recusado com 400", async () => {
    const rawBody = Buffer.from("{isto não é json");
    expect((await handleWhatsAppWebhook({ rawBody, signature: signMetaPayload(rawBody, whatsappSecret()) })).status).toBe(400);
  });

  it("roteamento: cada número entrega apenas à sua organização; número desconhecido não entrega a ninguém", async () => {
    const beforeA = await messagesOf(a);
    const beforeB = await messagesOf(b);

    expect((await deliverWhatsApp(textMessage(b, "- 2 fonte chaveada 24Vcc 5A", "wamid.B1"))).body).toMatchObject({ received: 1 });
    // o mesmo wamid em outra organização NÃO é duplicata: a unicidade é por organização
    expect((await deliverWhatsApp(textMessage(a, "- 2 fonte chaveada 24Vcc 5A", "wamid.B1"))).body).toMatchObject({ received: 1, duplicates: 0 });

    const unknown = { phoneNumberId: "99999999999999", org: a.org, address: a.address };
    const unrouted = await deliverWhatsApp(textMessage(unknown, "- 9 itens", "wamid.NINGUEM"));
    expect(unrouted).toMatchObject({ status: 200, body: { received: 0, unrouted: 1 } });

    await settleJobs();
    expect(await messagesOf(a)).toBe(beforeA + 1);
    expect(await messagesOf(b)).toBe(beforeB + 1);
    expect(await getPrisma().inboundMessage.count({ where: { externalId: "wamid.NINGUEM" } })).toBe(0);
  });

  it("eventos de status são registrados uma única vez e não criam solicitações", async () => {
    const statusPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "5511900000001", phone_number_id: a.phoneNumberId },
                statuses: [{ id: "wamid.SAIDA1", status: "delivered", timestamp: "1795000000", recipient_id: "5511900000505" }],
              },
            },
          ],
        },
      ],
    };
    const requestsBefore = await tenantDb(a.org.id).quotationRequest.count();
    expect((await deliverWhatsApp(statusPayload)).body).toMatchObject({ received: 0, statuses: 1 });
    expect((await deliverWhatsApp(statusPayload)).body).toMatchObject({ statuses: 0, duplicates: 1 });
    const events = await tenantDb(a.org.id).channelEvent.findMany({ where: { externalId: { contains: "wamid.SAIDA1" } } });
    expect(events).toHaveLength(1);
    expect(await tenantDb(a.org.id).quotationRequest.count()).toBe(requestsBefore);
    expect((await getWhatsAppIntegration(a.org.owner)).lastEventAt).not.toBeNull();
  });

  it("mídias são baixadas pelo worker com o token da organização e seguem o mesmo pipeline", async () => {
    const calls: Array<{ mediaId: string; token: string }> = [];
    const client: WhatsAppMediaClient = {
      download: async (mediaId, token) => {
        calls.push({ mediaId, token });
        return { data: readDemoFixture(FIXTURE_FILES.pdfOrder), mimeType: "application/pdf" };
      },
    };
    setWhatsAppMediaClientForTests(client);

    expect((await deliverWhatsApp(mediaMessage(a, "wamid.DOC1", { id: "MEDIA-123", mime_type: "application/pdf", filename: "pedido.pdf" }))).body).toMatchObject({ received: 1 });
    await settleJobs();

    expect(calls).toEqual([{ mediaId: "MEDIA-123", token: ACCESS_TOKEN }]);
    const request = (await listRequests(a.org.owner)).items.find((item) => item.attachmentsCount === 1 && item.itemsCount === 8)!;
    const detail = await getRequestDetail(a.org.owner, request.id);
    expect(detail.attachments[0]).toMatchObject({ fileName: "pedido.pdf", kind: "PDF", status: "STORED" });
    expect(detail.items[0]?.candidates[0]?.sku).toBe("DJ-3P-032-C");
  });

  it("falha definitiva no download da mídia fica registrada, sem derrubar o processamento", async () => {
    setWhatsAppMediaClientForTests({
      download: async () => {
        throw new MediaDownloadError("A mídia não está mais disponível na Meta.", { retryable: false });
      },
    });
    await deliverWhatsApp(mediaMessage(a, "wamid.DOC2", { id: "MEDIA-EXPIRADA", mime_type: "application/pdf", filename: "antigo.pdf" }));
    await settleJobs();
    const message = await tenantDb(a.org.id).inboundMessage.findFirstOrThrow({ where: { externalId: "wamid.DOC2" }, include: { attachments: true, quotationRequest: true } });
    expect(message.attachments[0]).toMatchObject({ status: "FAILED" });
    expect(message.attachments[0]?.error).toMatch(/dispon[ií]vel/i);
    const detail = await getRequestDetail(a.org.owner, message.quotationRequest!.id);
    expect(detail.warnings.join(" ")).toMatch(/antigo\.pdf/);
    expect(detail.items).toHaveLength(0);
  });

  it("um arquivo que não é o que diz ser é rejeitado após o download", async () => {
    setWhatsAppMediaClientForTests({ download: async () => ({ data: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(500)]), mimeType: "application/pdf" }) });
    await deliverWhatsApp(mediaMessage(a, "wamid.DOC3", { id: "MEDIA-EXE", mime_type: "application/pdf", filename: "pedido.pdf" }));
    await settleJobs();
    const message = await tenantDb(a.org.id).inboundMessage.findFirstOrThrow({ where: { externalId: "wamid.DOC3" }, include: { attachments: true } });
    expect(message.attachments[0]).toMatchObject({ status: "REJECTED", storageKey: null });
  });

  it("o token de acesso fica cifrado no banco e nunca volta inteiro para a interface", async () => {
    const row = await tenantDb(a.org.id).integration.findFirstOrThrow({ where: { type: "WHATSAPP_CLOUD" } });
    expect(row.credentialsEncrypted).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(ACCESS_TOKEN);
    const view = await getWhatsAppIntegration(a.org.owner);
    expect(JSON.stringify(view)).not.toContain(ACCESS_TOKEN);
    expect(view.accessTokenMask).toMatch(/7890$/);
    expect(view).toMatchObject({ configured: true, status: "ACTIVE", simulated: false, phoneNumberId: a.phoneNumberId });
  });

  it("um número não pode ser vinculado a duas organizações; desconectar interrompe o recebimento", async () => {
    const c = await createTestOrganization("hookc");
    await expect(saveWhatsAppIntegration(c.owner, { phoneNumberId: b.phoneNumberId, accessToken: "outro-token" })).rejects.toMatchObject({ code: "CONFLICT" });

    await disconnectWhatsAppIntegration(b.org.owner);
    const before = await messagesOf(b);
    expect((await deliverWhatsApp(textMessage(b, "- 1 fonte 24V", "wamid.B-APOS-DESCONEXAO"))).body).toMatchObject({ received: 0, unrouted: 1 });
    expect(await messagesOf(b)).toBe(before);
    const row = await tenantDb(b.org.id).integration.findFirst({ where: { type: "WHATSAPP_CLOUD" } });
    expect(row?.credentialsEncrypted ?? null).toBeNull();
  });
});

describe("e-mail de entrada", () => {
  it("e-mail autêntico vira solicitação; anexos passam pelo mesmo pipeline", async () => {
    await createCustomer(a.org.owner, { name: "Construtora Horizonte Azul", email: "compras@cliente.example" });
    const response = await deliverEmail(
      email(a, "<pedido-1@cliente.example>", {
        text: "Segue o pedido em anexo.",
        attachments: [{ fileName: "pedido.pdf", contentType: "application/pdf", contentBase64: readDemoFixture(FIXTURE_FILES.pdfOrder).toString("base64") }],
      }),
    );
    expect(response).toMatchObject({ status: 200, body: { status: "created" } });
    await settleJobs();

    const request = (await listRequests(a.org.owner, { channel: "EMAIL" })).items[0]!;
    expect(request).toMatchObject({ title: "Pedido de cotação", status: "AWAITING_REVIEW", customerName: "Construtora Horizonte Azul", senderAddress: "compras@cliente.example", itemsCount: 8 });
  });

  it("idempotência pelo Message-ID, inclusive em entregas simultâneas", async () => {
    const before = await tenantDb(a.org.id).inboundMessage.count({ where: { channel: "EMAIL" } });
    const payload = email(a, "<pedido-2@cliente.example>");
    expect((await deliverEmail(payload)).body).toMatchObject({ status: "created" });
    expect((await deliverEmail(payload)).body).toMatchObject({ status: "duplicate" });
    const concurrent = email(a, "<pedido-3@cliente.example>");
    const results = await Promise.all([deliverEmail(concurrent), deliverEmail(concurrent)]);
    expect(results.map((result) => (result.body as { status: string }).status).sort()).toEqual(["created", "duplicate"]);
    await settleJobs();
    expect(await tenantDb(a.org.id).inboundMessage.count({ where: { channel: "EMAIL" } })).toBe(before + 2);
  });

  it("recusa chamadas sem assinatura válida ou com assinatura antiga (replay)", async () => {
    const payload = email(a, "<forjado@cliente.example>");
    const rawBody = Buffer.from(JSON.stringify(payload));
    expect((await deliverEmail(payload, { signature: "t=1,v1=abc" })).status).toBe(401);
    expect((await deliverEmail(payload, { signature: signGenericEmailPayload(rawBody, "outro-segredo") })).status).toBe(401);
    expect((await deliverEmail(payload, { signature: signGenericEmailPayload(rawBody, emailSecret(), Math.floor(Date.now() / 1000) - 7200) })).status).toBe(401);
    expect((await handleInboundEmailWebhook("generic", { headers: new Headers(), rawBody })).status).toBe(401);
    expect((await handleInboundEmailWebhook("desconhecido", { headers: new Headers(), rawBody })).status).toBe(404);
    expect(await tenantDb(a.org.id).inboundMessage.count({ where: { externalId: { contains: "forjado" } } })).toBe(0);
  });

  it("roteia pelo endereço exclusivo; endereço desconhecido ou recebimento desativado são ignorados", async () => {
    const beforeA = await messagesOf(a);
    const beforeB = await messagesOf(b);

    expect((await deliverEmail(email(b, "<para-b@cliente.example>"))).body).toMatchObject({ status: "created" });
    expect((await deliverEmail(email(a, "<nao-existe@cliente.example>", { to: ["inexistente@inbound.test.example"] }))).body).toMatchObject({ status: "ignored" });
    expect((await deliverEmail(email(a, "<outro-dominio@cliente.example>", { to: [a.address.replace("inbound.test.example", "evil.example")] }))).body).toMatchObject({ status: "ignored" });

    await setEmailIntegrationEnabled(b.org.owner, false);
    expect((await deliverEmail(email(b, "<desativado@cliente.example>"))).body).toMatchObject({ status: "ignored" });
    await setEmailIntegrationEnabled(b.org.owner, true);

    await settleJobs();
    expect(await messagesOf(a)).toBe(beforeA);
    expect(await messagesOf(b)).toBe(beforeB + 1);
  });

  it("anexos não permitidos são recusados com o motivo, sem bloquear o restante do e-mail", async () => {
    const response = await deliverEmail(
      email(a, "<anexo-ruim@cliente.example>", {
        attachments: [
          { fileName: "instalador.exe", contentType: "application/octet-stream", contentBase64: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300)]).toString("base64") },
          { fileName: "lista.csv", contentType: "text/csv", contentBase64: Buffer.from("descricao;quantidade\nFita isolante preta 19mm x 20m;3\n").toString("base64") },
        ],
      }),
    );
    expect(response.body).toMatchObject({ status: "created" });
    await settleJobs();
    const message = await tenantDb(a.org.id).inboundMessage.findFirstOrThrow({ where: { externalId: { contains: "anexo-ruim" } }, include: { attachments: { orderBy: { fileName: "asc" } } } });
    expect(message.attachments.map((attachment) => [attachment.fileName, attachment.status])).toEqual([
      ["instalador.exe", "REJECTED"],
      ["lista.csv", "STORED"],
    ]);
    expect(message.attachments[0]?.storageKey).toBeNull();
  });

  it("adaptador Postmark: autentica por Basic Auth e interpreta o formato do provedor", async () => {
    const config = env();
    const rawBody = Buffer.from(
      JSON.stringify({
        MessageID: "postmark-abc-123",
        From: "Marina Duarte <compras@cliente.example>",
        FromFull: { Email: "compras@cliente.example", Name: "Marina Duarte" },
        To: a.address,
        ToFull: [{ Email: a.address }],
        OriginalRecipient: a.address,
        Subject: "Cotação urgente",
        TextBody: "5 contator 25A bobina 220V",
        Attachments: [],
      }),
    );
    const basic = (user: string, password: string) => new Headers({ authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` });

    expect((await handleInboundEmailWebhook("postmark", { headers: basic("postmark", "senha-errada"), rawBody })).status).toBe(401);
    expect((await handleInboundEmailWebhook("postmark", { headers: new Headers(), rawBody })).status).toBe(401);
    const ok = await handleInboundEmailWebhook("postmark", { headers: basic(config.POSTMARK_WEBHOOK_USER!, config.POSTMARK_WEBHOOK_PASSWORD!), rawBody });
    expect(ok).toMatchObject({ status: 200, body: { status: "created" } });
    const replay = await handleInboundEmailWebhook("postmark", { headers: basic(config.POSTMARK_WEBHOOK_USER!, config.POSTMARK_WEBHOOK_PASSWORD!), rawBody });
    expect(replay.body).toMatchObject({ status: "duplicate" });
    await settleJobs();
    const request = (await listRequests(a.org.owner, { query: "Cotação urgente" })).items[0];
    expect(request).toMatchObject({ channel: "EMAIL", itemsCount: 1 });
  });
});
