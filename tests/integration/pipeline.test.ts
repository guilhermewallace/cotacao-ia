import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readDemoFixture } from "@/demo/mock-fixtures";
import { FIXTURE_FILES } from "@/demo/scenarios";
import { setAiProvidersForTests } from "@/modules/ai";
import { emptyExtraction, type AiExtraction } from "@/modules/ai/schema";
import { AiProviderError, type AiProvider } from "@/modules/ai/types";
import { updateOrganizationSettings } from "@/modules/identity/organizations";
import { ingestUpload } from "@/modules/inbox/upload";
import { claimJob } from "@/modules/processing/jobs";
import { processInboundMessage } from "@/modules/processing/pipeline";
import { enqueueProcessingJob } from "@/modules/processing/queue";
import { recoverInterruptedJobs, reprocessRequest } from "@/modules/processing/recovery";
import { deleteRequestDocuments, purgeExpiredDocuments } from "@/modules/processing/retention";
import { runProcessingJob } from "@/modules/processing/runner";
import { getRequestDetail, type RequestDetail } from "@/modules/requests/queries";
import { storage } from "@/modules/storage";
import { systemContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { getPrisma } from "@/platform/db";
import { createTestOrganization, rejection, settleJobs, type TestOrganization } from "../helpers/factory";

/**
 * PROCESSAMENTO DE DOCUMENTOS — pipeline assíncrono completo (fila em linha + provedor de IA mock):
 * validação do arquivo → armazenamento privado → extração → normalização → matching → revisão.
 */

let org: TestOrganization;

async function upload(files: Array<{ name: string; data: Buffer }>, note?: string): Promise<RequestDetail> {
  const result = await ingestUpload(org.seller, { files, note });
  await settleJobs();
  return getRequestDetail(org.seller, result.requestId!);
}

const fixture = (name: string) => ({ name, data: readDemoFixture(name) });
const outcomes = (detail: RequestDetail) => detail.items.map((item) => item.matchOutcome);

beforeAll(async () => {
  org = await createTestOrganization("pipe", { withDemoCatalog: true });
});

afterEach(() => {
  setAiProvidersForTests({});
});

describe("documentos de exemplo (cenários do ambiente de demonstração)", () => {
  it("CSV — todos os itens identificados, lido sem IA", async () => {
    const detail = await upload([fixture(FIXTURE_FILES.csv)]);
    expect(detail.status).toBe("AWAITING_REVIEW");
    expect(detail.extractionProvider).toBe("tabular");
    expect(detail.legibility).toBe("GOOD");
    expect(detail.items).toHaveLength(5);
    expect(outcomes(detail).every((outcome) => outcome === "SUGGESTED")).toBe(true);
    expect(detail.items[0]).toMatchObject({ originalDescription: "Lâmpada LED bulbo 9W bivolt 6500K", quantity: "40", unit: "UN" });
    // Toda sugestão aguarda revisão humana: nada é confirmado automaticamente.
    expect(detail.items.every((item) => item.status === "PENDING" && item.selectedProduct === null)).toBe(true);
    expect(detail.progress).toMatchObject({ total: 5, pending: 5, confirmed: 0 });
  });

  it("Excel — alguns itens não encontrados no catálogo", async () => {
    const detail = await upload([fixture(FIXTURE_FILES.spreadsheet)]);
    expect(detail.items).toHaveLength(12);
    const notFound = detail.items.filter((item) => item.matchOutcome === "NO_MATCH");
    expect(notFound.map((item) => item.originalDescription)).toEqual(["Chave fim de curso com rolete", 'Válvula solenoide 1/2" 24Vcc', "Manômetro 0-10 bar"]);
    expect(notFound.every((item) => item.candidates.length === 0)).toBe(true);
    expect(detail.items.filter((item) => item.matchOutcome === "SUGGESTED").length).toBeGreaterThanOrEqual(8);
    // rastreabilidade: cada item aponta a linha da planilha de onde veio
    expect(detail.items[0]?.sourceReference).toMatchObject({ origin: "attachment", sheet: "Materiais", row: 5 });
    expect(detail.items[0]?.manufacturerCode).toBe("AMP-K18M");
    expect(detail.items[0]?.candidates[0]?.sku).toBe("CT-18-220");
  });

  it("PDF — múltiplos itens e dados do cliente", async () => {
    const detail = await upload([fixture(FIXTURE_FILES.pdfOrder)]);
    expect(detail.items).toHaveLength(8);
    expect(detail.customerHint).toMatchObject({ name: "Construtora Horizonte Azul", email: "compras@horizonteazul.example" });
    expect(detail.items[0]).toMatchObject({ originalDescription: "Disjuntor DIN tripolar 32A curva C", quantity: "12" });
    expect(detail.items[0]?.candidates.map((candidate) => candidate.sku)).toEqual(["DJ-3P-032-C"]);
    expect(detail.items[0]?.rejected.map((candidate) => candidate.sku)).toContain("DJ-3P-040-C");
    expect(detail.attachments[0]).toMatchObject({ kind: "PDF", status: "STORED", canInline: true });
    expect(detail.attachments[0]?.extractedText).toContain("Disjuntor DIN tripolar 32A");
  });

  it("foto de lista manuscrita — documento pouco legível, sem inventar o que não dá para ler", async () => {
    const detail = await upload([fixture(FIXTURE_FILES.handwritten)]);
    expect(detail.legibility).toBe("POOR");
    expect(detail.warnings.join(" ")).toMatch(/pouco leg[ií]ve/i);

    const breaker = detail.items.find((item) => item.originalDescription.includes("4_A"))!;
    expect(breaker.matchOutcome).toBe("AMBIGUOUS");
    expect(breaker.attributes.map((attribute) => attribute.key)).not.toContain("corrente_a"); // o dígito borrado não vira um valor
    expect(breaker.notes).toMatch(/ileg[ií]vel/i);
    expect(new Set(breaker.candidates.map((candidate) => candidate.sku)).size).toBeGreaterThan(1);

    const tape = detail.items.find((item) => item.originalDescription.startsWith("fita"))!;
    expect(tape.quantity).toBeNull(); // quantidade ausente fica nula
    expect(detail.warnings.join(" ")).toMatch(/sem quantidade/i);
  });

  it("mensagem com especificações incompatíveis — parecidos são descartados com o motivo", async () => {
    const detail = await upload(
      [{ name: "obs.csv", data: Buffer.from("descricao;quantidade\nFita isolante preta 19mm x 20m;1\n") }],
      "- 4 disjuntor tripolar 80A curva C\n- 6 contatores 18A bobina 380V\n- 10 disjuntores tripolares 32A curva C",
    );
    const byText = (text: string) => detail.items.find((item) => item.originalDescription.includes(text))!;
    expect(byText("80A")).toMatchObject({ matchOutcome: "NO_MATCH", candidates: [] });
    expect(byText("80A").rejected.length).toBeGreaterThan(0);
    expect(byText("80A").rejected[0]?.incompatibilities[0]).toMatchObject({ key: "corrente_a", verdict: "MISMATCH" });
    expect(byText("380V").matchOutcome).toBe("NO_MATCH");
    expect(byText("380V").rejected.some((candidate) => candidate.incompatibilities.some((entry) => entry.key === "tensao_v"))).toBe(true);
    expect(byText("32A")).toMatchObject({ matchOutcome: "SUGGESTED", quantity: "10" });
    // o texto da mensagem e o anexo passam pelo mesmo pipeline e viram uma única solicitação
    expect(detail.items).toHaveLength(4);
  });

  it("pedido com informações incompletas — fica ambíguo e sem quantidade", async () => {
    const detail = await upload([{ name: "pedido.csv", data: Buffer.from("descricao\nCabo flexível 4mm\nDisjuntor bipolar\nFonte 24V\n") }]);
    expect(detail.items).toHaveLength(3);
    expect(detail.items.every((item) => item.quantity === null)).toBe(true);
    expect(detail.items.every((item) => item.matchOutcome === "AMBIGUOUS")).toBe(true);
    expect(detail.items.every((item) => item.candidates.length > 1)).toBe(true);
    expect(detail.warnings.join(" ")).toMatch(/sem quantidade/i);
  });
});

describe("validação de upload", () => {
  it("recusa formatos não suportados, arquivos vazios e envio sem arquivos — sem gravar nada", async () => {
    const before = await tenantDb(org.id).inboundMessage.count();
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300)]);
    expect(await rejection(ingestUpload(org.seller, { files: [{ name: "pedido.pdf", data: exe }] }))).toMatchObject({ code: "VALIDATION" });
    expect(await rejection(ingestUpload(org.seller, { files: [{ name: "vazio.csv", data: Buffer.alloc(0) }] }))).toMatchObject({ code: "VALIDATION" });
    expect(await rejection(ingestUpload(org.seller, { files: [] }))).toMatchObject({ code: "VALIDATION" });
    // um arquivo inválido recusa o envio inteiro
    expect(await rejection(ingestUpload(org.seller, { files: [fixture(FIXTURE_FILES.csv), { name: "virus.pdf", data: exe }] }))).toMatchObject({ code: "VALIDATION" });
    expect(await rejection(ingestUpload(org.seller, { files: Array.from({ length: 11 }, (_, index) => ({ name: `a${index}.csv`, data: Buffer.from("descricao\nitem\n") })) }))).toMatchObject({
      code: "VALIDATION",
    });
    expect(await tenantDb(org.id).inboundMessage.count()).toBe(before);
  });

  it("reenviar o mesmo formulário (mesma chave de idempotência) não cria outra solicitação", async () => {
    const input = { files: [fixture(FIXTURE_FILES.csv)], idempotencyKey: "form-abc-12345678" };
    const first = await ingestUpload(org.seller, input);
    const second = await ingestUpload(org.seller, input);
    await settleJobs();
    expect(first.status).toBe("created");
    expect(second).toMatchObject({ status: "duplicate", requestId: first.requestId, messageId: first.messageId });
    expect(await tenantDb(org.id).quotationRequest.count({ where: { inboundMessageId: first.messageId } })).toBe(1);
  });

  it("os arquivos ficam no storage privado, em chave gerada pelo servidor, com URL temporária", async () => {
    const detail = await upload([{ name: "../../etc/passwd.csv", data: Buffer.from("descricao;quantidade\nFita isolante;2\n") }]);
    const attachment = await tenantDb(org.id).attachment.findUniqueOrThrow({ where: { id: detail.attachments[0]!.id } });
    expect(attachment.storageKey).toMatch(new RegExp(`^org/${org.id}/inbound/[0-9a-f-]+/[0-9a-f-]+\\.csv$`));
    expect(attachment.fileName).not.toContain("/");
    expect(attachment.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await storage().exists(attachment.storageKey!)).toBe(true);
    const url = await storage().getSignedUrl(attachment.storageKey!, { fileName: attachment.fileName });
    expect(url).toMatch(/exp=\d+/);
    expect(url).toMatch(/sig=[0-9a-f]{64}/);
  });
});

describe("resiliência do processamento", () => {
  const brokenProvider = (retryable: boolean, calls: { count: number }): AiProvider => ({
    name: "mock",
    model: "falha-simulada",
    capabilities: { images: true, pdf: true },
    extract: async () => {
      calls.count += 1;
      throw new AiProviderError("Falha na chamada à IA (HTTP 503).", { retryable });
    },
  });

  it("falha temporária da IA: tenta de novo e, esgotadas as tentativas, marca a solicitação como falha", async () => {
    const calls = { count: 0 };
    setAiProvidersForTests({ ai: brokenProvider(true, calls) });
    const detail = await upload([fixture(FIXTURE_FILES.pdfOrder)]);
    expect(calls.count).toBe(5);
    expect(detail.status).toBe("FAILED");
    expect(detail.message.error).toMatch(/IA/);
    expect(detail.items).toHaveLength(0);
    const job = await tenantDb(org.id).processingJob.findFirstOrThrow({ where: { type: "PROCESS_INBOUND_MESSAGE" }, orderBy: { createdAt: "desc" } });
    expect(job).toMatchObject({ status: "FAILED", attempts: 5 });

    // depois que o provedor volta, "Reprocessar" recupera a solicitação
    setAiProvidersForTests({});
    await reprocessRequest(org.seller, detail.id);
    await settleJobs();
    const recovered = await getRequestDetail(org.seller, detail.id);
    expect(recovered.status).toBe("AWAITING_REVIEW");
    expect(recovered.items).toHaveLength(8);
  });

  it("falha definitiva (ex.: credencial inválida) não é repetida", async () => {
    const calls = { count: 0 };
    setAiProvidersForTests({ ai: brokenProvider(false, calls) });
    const detail = await upload([fixture(FIXTURE_FILES.pdfOrder)]);
    expect(calls.count).toBe(1);
    expect(detail.status).toBe("FAILED");
  });

  it("erros inesperados não vazam detalhes internos para o usuário", async () => {
    setAiProvidersForTests({
      ai: {
        name: "mock",
        model: "erro",
        capabilities: { images: true, pdf: true },
        extract: async () => {
          throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password="s3cr3t"');
        },
      },
    });
    const detail = await upload([fixture(FIXTURE_FILES.pdfOrder)]);
    expect(detail.status).toBe("FAILED");
    expect(detail.message.error).not.toMatch(/ECONNREFUSED|s3cr3t|10\.0\.0\.5/);
  });

  it("idempotência: executar o mesmo job duas vezes não duplica itens", async () => {
    const detail = await upload([fixture(FIXTURE_FILES.csv)]);
    const job = await tenantDb(org.id).processingJob.findFirstOrThrow({ where: { type: "PROCESS_INBOUND_MESSAGE" }, orderBy: { createdAt: "desc" } });
    expect(job.status).toBe("SUCCEEDED");
    expect(await runProcessingJob({ processingJobId: job.id, organizationId: org.id })).toBe("skipped");
    expect(await claimJob(org.id, job.id)).toBeNull();
    // mesmo forçando o pipeline de novo, os itens são substituídos — não somados
    await processInboundMessage(systemContext(org.id), job.inboundMessageId!);
    expect((await getRequestDetail(org.seller, detail.id)).items).toHaveLength(5);
  });

  it("um job só é reivindicado por um worker; outra organização não o alcança", async () => {
    const other = await createTestOrganization("pipe2");
    setAiProvidersForTests({ ai: { name: "mock", model: "lento", capabilities: { images: true, pdf: true }, extract: async () => emptyExtraction() } });
    const result = await ingestUpload(org.seller, { files: [fixture(FIXTURE_FILES.csv)] });
    await settleJobs();
    const job = await tenantDb(org.id).processingJob.findFirstOrThrow({ where: { inboundMessageId: result.messageId } });

    await getPrisma().processingJob.update({ where: { id: job.id }, data: { status: "QUEUED" } });
    expect(await claimJob(other.id, job.id)).toBeNull();
    const [first, second] = await Promise.all([claimJob(org.id, job.id), claimJob(org.id, job.id)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("recupera jobs interrompidos: worker que caiu (sem heartbeat) e job que não chegou à fila", async () => {
    const result = await ingestUpload(org.seller, { files: [fixture(FIXTURE_FILES.csv)] });
    await settleJobs();
    const db = tenantDb(org.id);
    const job = await db.processingJob.findFirstOrThrow({ where: { inboundMessageId: result.messageId } });

    // simula um worker que morreu no meio do processamento, há 10 minutos
    const stale = new Date(Date.now() - 10 * 60_000);
    await getPrisma().processingJob.update({ where: { id: job.id }, data: { status: "RUNNING", heartbeatAt: stale, startedAt: stale, finishedAt: null } });
    await db.quotationRequest.update({ where: { id: result.requestId! }, data: { status: "PROCESSING" } });

    const recovered = await recoverInterruptedJobs();
    await settleJobs();
    expect(recovered.requeued).toBeGreaterThanOrEqual(1);
    expect((await db.processingJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SUCCEEDED");
    expect((await getRequestDetail(org.seller, result.requestId!)).status).toBe("AWAITING_REVIEW");

    // job ativo (heartbeat recente) NÃO é tocado
    await getPrisma().processingJob.update({ where: { id: job.id }, data: { status: "RUNNING", heartbeatAt: new Date(), finishedAt: null } });
    await recoverInterruptedJobs();
    expect((await db.processingJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("RUNNING");
    await getPrisma().processingJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date() } });
  });

  it("enfileirar duas vezes o mesmo job processa uma vez só", async () => {
    const calls = { count: 0 };
    const counting: AiProvider = {
      name: "mock",
      model: "contador",
      capabilities: { images: true, pdf: true },
      extract: async (): Promise<AiExtraction> => {
        calls.count += 1;
        return emptyExtraction({ documentType: "other" });
      },
    };
    setAiProvidersForTests({ ai: counting });
    const result = await ingestUpload(org.seller, { files: [fixture(FIXTURE_FILES.pdfOrder)] });
    const job = await tenantDb(org.id).processingJob.findFirstOrThrow({ where: { inboundMessageId: result.messageId } });
    await Promise.all([
      enqueueProcessingJob({ processingJobId: job.id, organizationId: org.id }),
      enqueueProcessingJob({ processingJobId: job.id, organizationId: org.id }),
    ]);
    await settleJobs();
    expect(calls.count).toBe(1);
  });
});

describe("retenção e exclusão de documentos (LGPD)", () => {
  it("exclusão manual apaga arquivos e texto, preservando os itens extraídos", async () => {
    const detail = await upload([fixture(FIXTURE_FILES.pdfOrder)], "pedido urgente da obra");
    const key = (await tenantDb(org.id).attachment.findUniqueOrThrow({ where: { id: detail.attachments[0]!.id } })).storageKey!;
    expect(await storage().exists(key)).toBe(true);

    expect(await rejection(deleteRequestDocuments(org.seller, detail.id))).toMatchObject({ code: "FORBIDDEN" });
    expect(await deleteRequestDocuments(org.admin, detail.id)).toEqual({ attachments: 1 });

    expect(await storage().exists(key)).toBe(false);
    const after = await getRequestDetail(org.seller, detail.id);
    expect(after.attachments[0]).toMatchObject({ status: "PURGED", extractedText: null });
    expect(after.message.text).toBeNull();
    expect(after.items).toHaveLength(8);
  });

  it("a política de retenção expurga apenas documentos mais antigos que o prazo, e só de quem a configurou", async () => {
    const other = await createTestOrganization("pipe3", { withDemoCatalog: false });
    const keepForever = await ingestUpload(other.owner, { files: [fixture(FIXTURE_FILES.csv)] });
    const old = await upload([fixture(FIXTURE_FILES.csv)]);
    const recent = await upload([fixture(FIXTURE_FILES.csv)]);
    await settleJobs();

    const prisma = getPrisma();
    const longAgo = new Date(Date.now() - 45 * 24 * 3600_000);
    const oldMessage = await prisma.quotationRequest.findUniqueOrThrow({ where: { id: old.id }, select: { inboundMessageId: true } });
    for (const messageId of [oldMessage.inboundMessageId, keepForever.messageId]) {
      await prisma.inboundMessage.update({ where: { id: messageId }, data: { receivedAt: longAgo } });
      await prisma.attachment.updateMany({ where: { inboundMessageId: messageId }, data: { createdAt: longAgo } });
    }
    await updateOrganizationSettings(org.admin, { name: "Empresa pipeline", defaultQuotationValidityDays: 15, documentRetentionDays: 30 });

    const result = await purgeExpiredDocuments();
    expect(result.attachments).toBeGreaterThanOrEqual(1);

    expect((await getRequestDetail(org.seller, old.id)).attachments[0]?.status).toBe("PURGED");
    expect((await getRequestDetail(org.seller, old.id)).items).toHaveLength(5);
    expect((await getRequestDetail(org.seller, recent.id)).attachments[0]?.status).toBe("STORED");
    // a outra organização não definiu prazo: nada é excluído
    expect((await getRequestDetail(other.owner, keepForever.requestId!)).attachments[0]?.status).toBe("STORED");
    await updateOrganizationSettings(org.admin, { name: "Empresa pipeline", defaultQuotationValidityDays: 15, documentRetentionDays: null });
  });
});
