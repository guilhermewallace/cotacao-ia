import { beforeAll, describe, expect, it } from "vitest";
import { listAuditLogs } from "@/modules/audit/audit";
import { createPriceList, getPriceList, listPriceLists, setPriceListItem } from "@/modules/catalog/price-lists";
import { addProductAlias, getProduct, listProducts, searchProducts, setProductActive, updateProduct } from "@/modules/catalog/products";
import { createCustomer, listCustomers, updateCustomer } from "@/modules/customers/customers";
import { getDashboardData } from "@/modules/dashboard/metrics";
import { removeMember, updateMemberRole } from "@/modules/identity/users";
import { getAttachmentAccess } from "@/modules/inbox/attachments";
import { ingestUpload } from "@/modules/inbox/upload";
import { reprocessRequest } from "@/modules/processing/recovery";
import { deleteRequestDocuments } from "@/modules/processing/retention";
import { loadQuotationExportData } from "@/modules/quotations/export/data";
import { createQuotationFromRequest, finalizeQuotation, getQuotation, listQuotations, updateQuotation } from "@/modules/quotations/service";
import { getRequestDetail, listRequests } from "@/modules/requests/queries";
import { acceptSuggestedItems, confirmItem, discardRequest, markItemNotFound, setRequestCustomer } from "@/modules/requests/review";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { getPrisma } from "@/platform/db";
import { createTestOrganization, productId, rejection, settleJobs, type TestOrganization } from "../helpers/factory";

/**
 * ISOLAMENTO ENTRE ORGANIZAÇÕES.
 *
 * Regra do produto: "Nenhum usuário poderá visualizar ou modificar recursos pertencentes
 * a outra organização." Aqui, o usuário MAIS privilegiado da organização A (proprietário)
 * tenta alcançar, por ID, cada tipo de recurso da organização B. Toda tentativa deve
 * resultar em "não encontrado" — o mesmo resultado de um ID inexistente (sem vazar a existência).
 */

interface Fixture {
  org: TestOrganization;
  customerId: string;
  priceListId: string;
  requestId: string;
  itemId: string;
  attachmentId: string;
  quotationId: string;
  membershipId: string;
}

const CSV = (rows: string[]) => Buffer.from(["descricao;quantidade;unidade", ...rows].join("\n"), "utf8");

async function buildFixture(label: string): Promise<Fixture> {
  const org = await createTestOrganization(label, { withDemoCatalog: true });
  const customer = await createCustomer(org.owner, { name: `Cliente ${label}`, email: `compras@${label}.example` });
  const priceList = await createPriceList(org.owner, { name: `Lista ${label}` });

  // Solicitação já cotada (para ter cotação) …
  const quoted = await ingestUpload(org.owner, { files: [{ name: "cotado.csv", data: CSV(["Disjuntor DIN tripolar 32A curva C;10;un"]) }] });
  // … e outra aguardando revisão (para ter itens editáveis e anexo).
  const pending = await ingestUpload(org.owner, { files: [{ name: "pendente.csv", data: CSV(["Disjuntor DIN monopolar 16A curva C;5;un", "Cabo flexível 2,5mm² azul;100;m"]) }] });
  await settleJobs();

  await acceptSuggestedItems(org.owner, quoted.requestId!);
  const quotation = await createQuotationFromRequest(org.owner, quoted.requestId!);

  const detail = await getRequestDetail(org.owner, pending.requestId!);
  const membership = await getPrisma().membership.findFirstOrThrow({ where: { organizationId: org.id, role: "SELLER" } });
  return {
    org,
    customerId: customer.id,
    priceListId: priceList.id,
    requestId: detail.id,
    itemId: detail.items[0]!.id,
    attachmentId: detail.attachments[0]!.id,
    quotationId: quotation.id,
    membershipId: membership.id,
  };
}

let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  a = await buildFixture("isoa");
  b = await buildFixture("isob");
});

const expectNotFound = async (promise: Promise<unknown>) => {
  const error = await rejection(promise);
  expect(error).toMatchObject({ code: "NOT_FOUND" });
};

describe("leitura: A não enxerga nada de B", () => {
  it("listagens e buscas só trazem registros da própria organização", async () => {
    const bProductIds = new Set(b.org.products.values());
    const products = await listProducts(a.org.owner, { pageSize: 100, status: "all" });
    expect(products.total).toBe(a.org.products.size);
    expect(products.items.some((product) => bProductIds.has(product.id))).toBe(false);

    const found = await searchProducts(a.org.owner, "disjuntor tripolar 32A", 12);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((product) => !bProductIds.has(product.id))).toBe(true);

    expect((await listCustomers(a.org.owner)).map((customer) => customer.id)).toEqual([a.customerId]);
    expect((await listPriceLists(a.org.owner)).map((list) => list.id)).toEqual([a.priceListId]);
    expect((await listRequests(a.org.owner)).items.map((request) => request.id)).not.toContain(b.requestId);
    expect((await listQuotations(a.org.owner)).items.map((quotation) => quotation.id)).toEqual([a.quotationId]);
  });

  it("acesso direto por ID devolve 'não encontrado'", async () => {
    await expectNotFound(getProduct(a.org.owner, productId(b.org, "DJ-3P-032-C")));
    await expectNotFound(getRequestDetail(a.org.owner, b.requestId));
    await expectNotFound(getQuotation(a.org.owner, b.quotationId));
    await expectNotFound(getPriceList(a.org.owner, b.priceListId));
    await expectNotFound(getAttachmentAccess(a.org.owner, b.attachmentId));
    await expectNotFound(getAttachmentAccess(a.org.owner, b.attachmentId, { download: true }));
    await expectNotFound(loadQuotationExportData(a.org.owner, b.quotationId, "pdf"));
    // controle: o dono de B acessa normalmente
    expect((await getQuotation(b.org.owner, b.quotationId)).id).toBe(b.quotationId);
    expect((await getAttachmentAccess(b.org.owner, b.attachmentId)).url).toContain(b.org.id);
  });

  it("os candidatos do matching vêm apenas do catálogo da própria organização", async () => {
    const detail = await getRequestDetail(a.org.owner, a.requestId);
    const aProductIds = new Set(a.org.products.values());
    const candidateIds = detail.items.flatMap((item) => [...item.candidates, ...item.rejected].map((candidate) => candidate.productId));
    expect(candidateIds.length).toBeGreaterThan(0);
    expect(candidateIds.every((id) => aProductIds.has(id))).toBe(true);
  });

  it("indicadores e auditoria não misturam organizações", async () => {
    const dashboard = await getDashboardData(a.org.owner, { periodDays: 30 });
    expect(dashboard.kpis.received).toBe(2);
    expect(dashboard.recent.map((request) => request.id)).not.toContain(b.requestId);

    const logs = await listAuditLogs(a.org.owner, { limit: 200 });
    const foreign = new Set([b.requestId, b.quotationId, b.customerId, b.priceListId, b.org.id]);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((log) => log.entityId !== null && foreign.has(log.entityId))).toBe(false);
  });
});

describe("escrita: A não altera nada de B", () => {
  it("catálogo, clientes e listas de preços", async () => {
    const bProduct = productId(b.org, "DJ-3P-032-C");
    const before = await getProduct(b.org.owner, bProduct);

    await expectNotFound(updateProduct(a.org.owner, bProduct, { sku: "INVADIDO", description: "produto alterado por outra empresa", unit: "UN" }));
    await expectNotFound(setProductActive(a.org.owner, bProduct, false));
    await expectNotFound(addProductAlias(a.org.owner, bProduct, { type: "SYNONYM", value: "apelido indevido" }));
    await expectNotFound(updateCustomer(a.org.owner, b.customerId, { name: "Cliente sequestrado" }));
    await expectNotFound(setPriceListItem(a.org.owner, b.priceListId, productId(a.org, "DJ-3P-032-C"), 1));
    // referência cruzada: lista de A com produto de B
    await expectNotFound(setPriceListItem(a.org.owner, a.priceListId, bProduct, 1));

    const after = await getProduct(b.org.owner, bProduct);
    expect(after).toMatchObject({ sku: before.sku, description: before.description, isActive: true });
    expect(after.aliases).toEqual(before.aliases);
    expect((await getPriceList(b.org.owner, b.priceListId)).total).toBe(0);
    expect((await getPriceList(a.org.owner, a.priceListId)).total).toBe(0);
  });

  it("solicitações e itens (inclusive referências cruzadas)", async () => {
    await expectNotFound(confirmItem(a.org.owner, b.itemId, productId(a.org, "DJ-1P-016-C")));
    await expectNotFound(confirmItem(a.org.owner, b.itemId, productId(b.org, "DJ-1P-016-C")));
    await expectNotFound(markItemNotFound(a.org.owner, b.itemId));
    await expectNotFound(acceptSuggestedItems(a.org.owner, b.requestId));
    await expectNotFound(discardRequest(a.org.owner, b.requestId));
    await expectNotFound(reprocessRequest(a.org.owner, b.requestId));
    await expectNotFound(deleteRequestDocuments(a.org.owner, b.requestId));
    await expectNotFound(createQuotationFromRequest(a.org.owner, b.requestId));
    // item de A com produto de B / solicitação de A com cliente de B
    await expectNotFound(confirmItem(a.org.owner, a.itemId, productId(b.org, "DJ-1P-016-C")));
    await expectNotFound(setRequestCustomer(a.org.owner, a.requestId, b.customerId));

    const untouched = await getRequestDetail(b.org.owner, b.requestId);
    expect(untouched.status).toBe("AWAITING_REVIEW");
    expect(untouched.progress.pending).toBe(untouched.progress.total);
    expect(untouched.attachments[0]?.status).toBe("STORED");
    const own = await getRequestDetail(a.org.owner, a.requestId);
    expect(own.customer).toBeNull();
    expect(own.items[0]?.status).toBe("PENDING");
  });

  it("cotações e membros", async () => {
    const before = await getQuotation(b.org.owner, b.quotationId);
    await expectNotFound(
      updateQuotation(a.org.owner, b.quotationId, { customerName: "Invasor", validUntil: "2030-01-01", discountPercent: 99, items: [] }),
    );
    await expectNotFound(finalizeQuotation(a.org.owner, b.quotationId));
    await expectNotFound(updateMemberRole(a.org.owner, b.membershipId, "OWNER"));
    await expectNotFound(removeMember(a.org.owner, b.membershipId));

    const after = await getQuotation(b.org.owner, b.quotationId);
    expect(after).toMatchObject({ status: "DRAFT", customerName: before.customerName, total: before.total });
    expect(await getPrisma().membership.findUnique({ where: { id: b.membershipId } })).toMatchObject({ role: "SELLER" });

    // cotação de A recebendo produto de B
    const own = await getQuotation(a.org.owner, a.quotationId);
    await expectNotFound(
      updateQuotation(a.org.owner, a.quotationId, {
        customerName: own.customerName,
        validUntil: "2030-01-01",
        discountPercent: 0,
        items: own.items.map((item) => ({ id: item.id, quantity: Number(item.quantity), unitPrice: item.unitPrice === null ? null : Number(item.unitPrice), discountPercent: 0 })),
        addedItems: [{ productId: productId(b.org, "DJ-1P-016-C"), quantity: 1 }],
      }),
    );
    expect((await getQuotation(a.org.owner, a.quotationId)).items).toHaveLength(own.items.length);
  });
});

describe("defesa em profundidade", () => {
  it("o cliente Prisma com escopo filtra e carimba a organização em toda operação", async () => {
    const db = tenantDb(a.org.id);
    const bProduct = productId(b.org, "DJ-3P-032-C");

    const all = await db.product.findMany({ select: { organizationId: true } });
    expect(all.length).toBe(a.org.products.size);
    expect(all.every((row) => row.organizationId === a.org.id)).toBe(true);

    expect(await db.product.findUnique({ where: { id: bProduct } })).toBeNull();
    expect(await db.product.findFirst({ where: { id: bProduct } })).toBeNull();
    expect(await db.product.count({ where: { id: { in: [...b.org.products.values()] } } })).toBe(0);
    await expect(db.product.update({ where: { id: bProduct }, data: { description: "invadido" } })).rejects.toThrow();
    await expect(db.product.delete({ where: { id: bProduct } })).rejects.toThrow();
    expect((await db.product.updateMany({ where: { id: bProduct }, data: { description: "invadido" } })).count).toBe(0);
    expect((await db.product.deleteMany({ where: { id: bProduct } })).count).toBe(0);

    // tentar "criar em outra organização" ou "mover" um registro não funciona
    const created = await db.product.create({
      data: { organizationId: b.org.id, sku: "ISO-TESTE-1", skuNormalized: "isoteste1", description: "Teste", descriptionNormalized: "teste", searchText: "teste", unit: "UN" } as never,
    });
    expect(created.organizationId).toBe(a.org.id);
    await db.product.update({ where: { id: created.id }, data: { organizationId: b.org.id, description: "Teste 2" } as never });
    expect((await getPrisma().product.findUniqueOrThrow({ where: { id: created.id } })).organizationId).toBe(a.org.id);
    expect(await getPrisma().product.count({ where: { organizationId: b.org.id, sku: "ISO-TESTE-1" } })).toBe(0);

    const intact = await getPrisma().product.findUniqueOrThrow({ where: { id: bProduct } });
    expect(intact.description).not.toBe("invadido");
  });

  it("o banco recusa referências entre organizações (chaves estrangeiras compostas)", async () => {
    const prisma = getPrisma();
    const aProduct = productId(a.org, "DJ-3P-032-C");
    const bProduct = productId(b.org, "DJ-3P-032-C");

    // sinônimo da organização A apontando para produto de B
    await expect(
      prisma.$executeRaw`INSERT INTO product_aliases (organization_id, product_id, type, value, value_normalized)
                         VALUES (${a.org.id}::uuid, ${bProduct}::uuid, 'SYNONYM', 'x', 'x')`,
    ).rejects.toThrow();
    // item de solicitação de B selecionando produto de A
    await expect(prisma.$executeRaw`UPDATE requested_items SET selected_product_id = ${aProduct}::uuid WHERE id = ${b.itemId}::uuid`).rejects.toThrow();
    // preço em lista de A para produto de B
    await expect(
      prisma.$executeRaw`INSERT INTO price_list_items (organization_id, price_list_id, product_id, unit_price)
                         VALUES (${a.org.id}::uuid, ${a.priceListId}::uuid, ${bProduct}::uuid, 10)`,
    ).rejects.toThrow();
    // cotação de A vinculada a cliente de B
    await expect(prisma.$executeRaw`UPDATE quotations SET customer_id = ${b.customerId}::uuid WHERE id = ${a.quotationId}::uuid`).rejects.toThrow();
  });
});
