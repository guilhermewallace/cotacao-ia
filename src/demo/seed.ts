import { buildDemoCatalog, buildSecondaryCatalog, type DemoProduct } from "@/demo/catalog";
import { readDemoFixture } from "@/demo/mock-fixtures";
import {
  DEMO_CUSTOMERS,
  DEMO_ORG,
  DEMO_USERS,
  EMAIL_INCOMPLETE_TEXT,
  EMAIL_PDF_BODY,
  FIXTURE_FILES,
  HISTORICAL_REQUESTS,
  SECONDARY_ORG,
  SECONDARY_USERS,
  WHATSAPP_INCOMPATIBLE_TEXT,
} from "@/demo/scenarios";
import type { MembershipRole } from "@/generated/prisma/enums";
import { buildProductAttributes, buildProductSearchFields } from "@/modules/catalog/search-text";
import { ingestInboundMessage, type IncomingMessage } from "@/modules/inbox/ingest";
import { normalizeCode, normalizeText } from "@/modules/normalization/text";
import { waitForInlineJobs } from "@/modules/processing/queue";
import { createQuotationFromRequest, finalizeQuotation, getQuotation, updateQuotation } from "@/modules/quotations/service";
import { getRequestDetail } from "@/modules/requests/queries";
import { confirmItem, markItemNotFound } from "@/modules/requests/review";
import { ensureStorageReady, storage } from "@/modules/storage";
import { userContext, webhookContext, type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { encryptJson } from "@/platform/crypto";
import { addDays, dateOnly, localDateString, toDateInputValue } from "@/platform/dates";
import { getPrisma } from "@/platform/db";
import { env } from "@/platform/env";

/**
 * Seed do ambiente de demonstração.
 *
 * Tudo aqui é fictício e identificado como tal (organizações com `isDemo = true`).
 * As solicitações de exemplo passam pelo pipeline REAL (ingestão → extração com o
 * provedor mock → matching), e as cotações são criadas pelos mesmos serviços usados
 * pela interface — o seed não grava resultados "prontos" diretamente no banco.
 */

export interface SeedSummary {
  organization: string;
  products: number;
  customers: number;
  requests: number;
  quotations: number;
  users: string[];
}

async function removeOrganization(slug: string): Promise<void> {
  const prisma = getPrisma();
  const organization = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  if (!organization) return;
  const attachments = await prisma.attachment.findMany({ where: { organizationId: organization.id, storageKey: { not: null } }, select: { storageKey: true } });
  await Promise.allSettled(attachments.map((attachment) => (attachment.storageKey ? storage().delete(attachment.storageKey) : Promise.resolve())));
  await prisma.organization.delete({ where: { id: organization.id } });
}

async function createOrganizationWithUsers(
  org: { slug: string; name: string; legalName: string; inboundEmailKey: string },
  users: ReadonlyArray<{ email: string; name: string; role: MembershipRole }>,
): Promise<{ organizationId: string; userIds: Map<string, string> }> {
  const prisma = getPrisma();
  const organization = await prisma.organization.create({
    data: {
      slug: org.slug,
      name: org.name,
      legalName: org.legalName,
      inboundEmailKey: org.inboundEmailKey,
      isDemo: true,
      defaultQuotationValidityDays: 15,
      documentRetentionDays: 180,
    },
  });
  const userIds = new Map<string, string>();
  for (const user of users) {
    const row = await prisma.user.upsert({ where: { email: user.email }, update: { name: user.name, isActive: true }, create: { email: user.email, name: user.name } });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: row.id, role: user.role } });
    userIds.set(user.email, row.id);
  }
  return { organizationId: organization.id, userIds };
}

export async function seedCatalog(organizationId: string, catalog: DemoProduct[]): Promise<Map<string, string>> {
  const db = tenantDb(organizationId);
  await db.product.createMany({
    data: catalog.map((product) => ({
      organizationId,
      sku: product.sku,
      description: product.description,
      manufacturer: product.manufacturer,
      manufacturerCode: product.manufacturerCode,
      category: product.category,
      unit: product.unit,
      price: product.price,
      attributes: buildProductAttributes(product.description) as object,
      ...buildProductSearchFields({ ...product, aliases: [...product.synonyms, ...product.alternativeCodes.map((code) => code.value)] }),
    })),
  });
  const rows = await db.product.findMany({ select: { id: true, sku: true } });
  const idBySku = new Map(rows.map((row) => [row.sku, row.id]));

  const aliases = catalog.flatMap((product) => {
    const productId = idBySku.get(product.sku);
    if (!productId) return [];
    return [
      ...product.synonyms.map((value) => ({ organizationId, productId, type: "SYNONYM" as const, value, valueNormalized: normalizeText(value), manufacturer: null })),
      ...product.alternativeCodes.map((code) => ({
        organizationId,
        productId,
        type: "MANUFACTURER_CODE" as const,
        value: code.value,
        valueNormalized: normalizeCode(code.value),
        manufacturer: code.manufacturer,
      })),
    ];
  });
  await db.productAlias.createMany({ data: aliases, skipDuplicates: true });
  return idBySku;
}

async function seedPriceLists(organizationId: string, catalog: DemoProduct[], idBySku: Map<string, string>): Promise<{ partnersId: string }> {
  const db = tenantDb(organizationId);
  const general = await db.priceList.create({ data: { organizationId, name: "Tabela Geral 2026", isDefault: true, validFrom: dateOnly("2026-01-01") } });
  const partners = await db.priceList.create({ data: { organizationId, name: "Construtoras — Parceiros", validFrom: dateOnly("2026-01-01") } });
  const round = (value: number) => Math.round(value * 100) / 100;

  const items = catalog.flatMap((product, index) => {
    const productId = idBySku.get(product.sku);
    if (!productId || product.price === null) return [];
    const rows = [];
    // A tabela geral cobre a maior parte do catálogo; o restante usa o preço base do produto.
    if (index % 6 !== 5) rows.push({ organizationId, priceListId: general.id, productId, unitPrice: round(product.price * 0.97) });
    if (["Proteção", "Cabos", "Eletrodutos", "Tomadas e Interruptores", "Quadros"].includes(product.category)) {
      rows.push({ organizationId, priceListId: partners.id, productId, unitPrice: round(product.price * 0.9) });
    }
    return rows;
  });
  await db.priceListItem.createMany({ data: items });
  return { partnersId: partners.id };
}

async function seedCustomers(organizationId: string, partnersPriceListId: string): Promise<void> {
  await tenantDb(organizationId).customer.createMany({
    data: DEMO_CUSTOMERS.map((customer) => ({
      organizationId,
      name: customer.name,
      legalName: customer.legalName,
      contactName: customer.contactName,
      email: customer.email,
      phone: customer.phone,
      priceListId: customer.priceList === "partners" ? partnersPriceListId : null,
      notes: "Cliente fictício do ambiente de demonstração.",
    })),
  });
}

async function seedIntegrations(organizationId: string): Promise<void> {
  const db = tenantDb(organizationId);
  // Integrações marcadas como SIMULADAS: nenhuma conta externa está conectada.
  await db.integration.create({ data: { organizationId, type: "EMAIL_INBOUND", status: "ACTIVE", config: { simulated: true } } });
  await db.integration.create({
    data: {
      organizationId,
      type: "WHATSAPP_CLOUD",
      status: "ACTIVE",
      externalAccountId: DEMO_ORG.whatsAppPhoneNumberId,
      displayName: DEMO_ORG.whatsAppDisplayNumber,
      config: { simulated: true, displayPhoneNumber: DEMO_ORG.whatsAppDisplayNumber },
      credentialsEncrypted: encryptJson({ accessToken: "token-ficticio-de-demonstracao" }, `integration:${organizationId}:WHATSAPP_CLOUD`),
    },
  });
}

/** Pseudoaleatório determinístico (para durações de processamento plausíveis e estáveis). */
function stable(index: number, min: number, max: number): number {
  const value = Math.abs(Math.sin(index * 12.9898 + 78.233) * 43758.5453) % 1;
  return Math.round(min + value * (max - min));
}

function atLocalHour(daysAgo: number, hour: number, minute = 0): Date {
  // Horário de Brasília (UTC-3) — suficiente para dados de demonstração.
  const day = localDateString(addDays(new Date(), -daysAgo));
  return new Date(`${day}T${String(hour + 3).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
}

async function ingestAndProcess(ctx: TenantContext, message: IncomingMessage, sequence: number): Promise<string> {
  const result = await ingestInboundMessage(ctx, message);
  await waitForInlineJobs();
  if (!result.requestId) throw new Error("Solicitação de demonstração não criada");

  // Ajusta os instantes para refletir o momento fictício do recebimento.
  const processedAt = new Date(message.receivedAt.getTime() + stable(sequence, 14, 68) * 1000);
  const db = tenantDb(ctx.organizationId);
  await db.quotationRequest.update({
    where: { id: result.requestId },
    data: { createdAt: message.receivedAt, processingStartedAt: new Date(message.receivedAt.getTime() + 2000), processedAt },
  });
  await db.inboundMessage.update({ where: { id: result.messageId }, data: { createdAt: message.receivedAt } });
  return result.requestId;
}

/** Revisão feita "por uma pessoa" no seed: confirma a melhor sugestão compatível ou marca como não encontrado. */
async function reviewLikeAHuman(ctx: TenantContext, requestId: string): Promise<void> {
  const detail = await getRequestDetail(ctx, requestId);
  for (const item of detail.items) {
    const best = item.candidates[0];
    if (best && (item.matchOutcome === "SUGGESTED" || best.score >= 0.6)) await confirmItem(ctx, item.id, best.productId);
    else await markItemNotFound(ctx, item.id);
  }
}

async function quote(ctx: TenantContext, requestId: string, options: { finalize: boolean; when: Date; discountPercent?: number; notes?: string }): Promise<void> {
  await reviewLikeAHuman(ctx, requestId);
  const { id } = await createQuotationFromRequest(ctx, requestId);
  const quotation = await getQuotation(ctx, id);
  const issueDate = dateOnly(localDateString(options.when));
  const db = tenantDb(ctx.organizationId);
  await db.quotation.update({ where: { id }, data: { issueDate, validUntil: addDays(issueDate, 15), createdAt: options.when } });

  await updateQuotation(ctx, id, {
    customerId: quotation.customerId,
    customerName: quotation.customerName,
    customerTaxId: quotation.customerTaxId,
    customerEmail: quotation.customerEmail,
    customerPhone: quotation.customerPhone,
    customerContact: quotation.customerContact,
    validUntil: toDateInputValue(addDays(issueDate, 15)),
    notes: options.notes ?? null,
    paymentTerms: "28 dias, boleto bancário",
    deliveryTerms: "Até 3 dias úteis para itens em estoque",
    discountPercent: options.discountPercent ?? 0,
    items: quotation.items.map((item) => ({
      id: item.id,
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice === null ? null : Number(item.unitPrice),
      discountPercent: 0,
      notes: item.notes,
    })),
  });
  if (options.finalize) {
    await finalizeQuotation(ctx, id);
    const finalizedAt = new Date(options.when.getTime() + 40 * 60 * 1000);
    await db.quotation.update({ where: { id }, data: { finalizedAt } });
    await db.quotationRequest.update({ where: { id: requestId }, data: { reviewedAt: finalizedAt } });
  }
}

export async function seedDemo(): Promise<SeedSummary> {
  const config = env();
  if (config.AI_PROVIDER !== "mock") {
    throw new Error("O seed de demonstração exige AI_PROVIDER=mock (os documentos de exemplo têm respostas fixas do provedor mock).");
  }
  if (config.QUEUE_DRIVER !== "inline") {
    throw new Error("O seed de demonstração deve ser executado com QUEUE_DRIVER=inline (o script prisma/seed.ts já faz isso).");
  }
  // Antes de tocar no banco: os documentos de exemplo são gravados no storage.
  try {
    await ensureStorageReady();
  } catch (error) {
    throw new Error(
      `Não foi possível acessar o storage S3 em ${config.S3_ENDPOINT ?? "AWS S3"} (bucket "${config.S3_BUCKET}"). ` +
        "Confira se o contêiner de storage está de pé (docker compose ps) e as variáveis S3_* do .env — " +
        "ou defina STORAGE_DRIVER=local para gravar os arquivos em disco.",
      { cause: error },
    );
  }

  await removeOrganization(DEMO_ORG.slug);
  await removeOrganization(SECONDARY_ORG.slug);

  // ── Elétrica Central ───────────────────────────────────────────────────────
  const { organizationId, userIds } = await createOrganizationWithUsers(DEMO_ORG, DEMO_USERS);
  const catalog = buildDemoCatalog();
  const idBySku = await seedCatalog(organizationId, catalog);
  const { partnersId } = await seedPriceLists(organizationId, catalog, idBySku);
  await seedCustomers(organizationId, partnersId);
  await seedIntegrations(organizationId);

  const sellerId = userIds.get("bruno.lima@eletricacentral.example");
  const ownerId = userIds.get("ana.souza@eletricacentral.example");
  if (!sellerId || !ownerId) throw new Error("Usuários de demonstração não criados");
  const seller = userContext({ organizationId, userId: sellerId, role: "SELLER" });
  const owner = userContext({ organizationId, userId: ownerId, role: "OWNER" });
  const inbound = webhookContext(organizationId);
  const customer = (key: string) => {
    const found = DEMO_CUSTOMERS.find((entry) => entry.key === key);
    if (!found) throw new Error(`Cliente de demonstração desconhecido: ${key}`);
    return found;
  };

  let sequence = 0;
  let requests = 0;
  let quotations = 0;

  // Histórico: solicitações já atendidas nos últimos dias.
  for (const historical of HISTORICAL_REQUESTS) {
    sequence += 1;
    const sender = customer(historical.customer);
    const receivedAt = atLocalHour(historical.daysAgo, historical.hour, stable(sequence, 3, 52));
    const requestId = await ingestAndProcess(
      inbound,
      {
        channel: historical.channel,
        externalId: `demo-historico-${sequence}`,
        senderName: sender.contactName,
        senderAddress: historical.channel === "WHATSAPP" ? sender.phone : sender.email,
        subject: historical.subject ?? null,
        text: historical.text,
        receivedAt,
        metadata: { demo: true },
        attachments: [],
      },
      sequence,
    );
    requests += 1;
    if (historical.outcome !== "awaiting") {
      const when = new Date(receivedAt.getTime() + stable(sequence, 25, 140) * 60 * 1000);
      await quote(sequence % 2 === 0 ? owner : seller, requestId, {
        finalize: historical.outcome === "finalized",
        when,
        discountPercent: historical.customer === "horizonte" ? 3 : 0,
      });
      quotations += 1;
    }
  }

  // CSV enviado manualmente há alguns dias — já cotado.
  sequence += 1;
  const csvReceivedAt = atLocalHour(6, 13, 20);
  const csvRequest = await ingestAndProcess(
    seller,
    {
      channel: "UPLOAD",
      externalId: "demo-upload-csv",
      senderName: "Bruno Lima",
      senderAddress: "bruno.lima@eletricacentral.example",
      text: "Pedido recebido no balcão — Condomínio Parque das Acácias.",
      receivedAt: csvReceivedAt,
      uploadedById: sellerId,
      metadata: { demo: true },
      attachments: [{ source: "inline", fileName: FIXTURE_FILES.csv, data: readDemoFixture(FIXTURE_FILES.csv) }],
    },
    sequence,
  );
  const acacias = await tenantDb(organizationId).customer.findFirst({ where: { email: customer("acacias").email }, select: { id: true } });
  await tenantDb(organizationId).quotationRequest.update({ where: { id: csvRequest }, data: { customerId: acacias?.id ?? null } });
  await quote(seller, csvRequest, { finalize: true, when: new Date(csvReceivedAt.getTime() + 35 * 60 * 1000) });
  requests += 1;
  quotations += 1;

  // Cenários aguardando revisão — um para cada situação que a demonstração precisa mostrar.
  const scenarios: IncomingMessage[] = [
    {
      // Documento pouco legível (foto de lista manuscrita).
      channel: "WHATSAPP",
      externalId: "demo-whatsapp-manuscrito",
      senderName: customer("acacias").contactName,
      senderAddress: customer("acacias").phone,
      text: "segue a lista do eletricista",
      receivedAt: atLocalHour(1, 16, 42),
      metadata: { demo: true },
      attachments: [{ source: "inline", fileName: FIXTURE_FILES.handwritten, data: readDemoFixture(FIXTURE_FILES.handwritten) }],
    },
    {
      // Solicitação com informações incompletas.
      channel: "EMAIL",
      externalId: "demo-email-incompleto",
      senderName: customer("valenorte").contactName,
      senderAddress: customer("valenorte").email,
      subject: "Orçamento de materiais",
      text: EMAIL_INCOMPLETE_TEXT,
      receivedAt: atLocalHour(1, 10, 15),
      metadata: { demo: true },
      attachments: [],
    },
    {
      // Múltiplos itens, alguns fora do catálogo (planilha).
      channel: "UPLOAD",
      externalId: "demo-upload-planilha",
      senderName: "Ana Souza",
      senderAddress: "ana.souza@eletricacentral.example",
      text: null,
      receivedAt: atLocalHour(0, 8, 5),
      uploadedById: ownerId,
      metadata: { demo: true },
      attachments: [{ source: "inline", fileName: FIXTURE_FILES.spreadsheet, data: readDemoFixture(FIXTURE_FILES.spreadsheet) }],
    },
    {
      // Todos os produtos identificados (PDF anexo ao e-mail).
      channel: "EMAIL",
      externalId: "demo-email-pdf",
      senderName: customer("horizonte").contactName,
      senderAddress: customer("horizonte").email,
      subject: "Pedido de cotação - Residencial Jardim das Flores",
      text: EMAIL_PDF_BODY,
      receivedAt: atLocalHour(0, 9, 30),
      metadata: { demo: true },
      attachments: [{ source: "inline", fileName: FIXTURE_FILES.pdfOrder, data: readDemoFixture(FIXTURE_FILES.pdfOrder) }],
    },
    {
      // Especificações incompatíveis com o catálogo.
      channel: "WHATSAPP",
      externalId: "demo-whatsapp-incompativel",
      senderName: customer("luzforca").contactName,
      senderAddress: customer("luzforca").phone,
      text: WHATSAPP_INCOMPATIBLE_TEXT,
      receivedAt: atLocalHour(0, 10, 48),
      metadata: { demo: true },
      attachments: [],
    },
  ];
  for (const scenario of scenarios) {
    sequence += 1;
    // Um instante no futuro (seed executado de manhã cedo) viraria "recebido amanhã": limita ao presente.
    const receivedAt = scenario.receivedAt.getTime() > Date.now() ? new Date(Date.now() - sequence * 7 * 60 * 1000) : scenario.receivedAt;
    await ingestAndProcess(scenario.channel === "UPLOAD" ? owner : inbound, { ...scenario, receivedAt }, sequence);
    requests += 1;
  }

  // ── Segunda organização (isolamento entre empresas) ────────────────────────
  const secondary = await createOrganizationWithUsers(SECONDARY_ORG, SECONDARY_USERS);
  const secondaryCatalog = buildSecondaryCatalog();
  await seedCatalog(secondary.organizationId, secondaryCatalog);
  await tenantDb(secondary.organizationId).priceList.create({ data: { organizationId: secondary.organizationId, name: "Tabela Volt Sul", isDefault: true } });

  return {
    organization: DEMO_ORG.name,
    products: catalog.length,
    customers: DEMO_CUSTOMERS.length,
    requests,
    quotations,
    users: DEMO_USERS.map((user) => `${user.email} (${user.role})`),
  };
}
