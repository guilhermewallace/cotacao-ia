import { beforeAll, describe, expect, it } from "vitest";
import { listAuditLogs } from "@/modules/audit/audit";
import { previewImport } from "@/modules/catalog/import";
import { createPriceList } from "@/modules/catalog/price-lists";
import { createProduct, listProducts, updateProduct } from "@/modules/catalog/products";
import { createCustomer } from "@/modules/customers/customers";
import { getDashboardData } from "@/modules/dashboard/metrics";
import { updateOrganizationSettings } from "@/modules/identity/organizations";
import { addMember, listMembers, removeMember, updateMemberRole } from "@/modules/identity/users";
import { ingestUpload } from "@/modules/inbox/upload";
import { getWhatsAppIntegration, rotateInboundEmailKey, saveWhatsAppIntegration } from "@/modules/integrations/integrations";
import { deleteRequestDocuments } from "@/modules/processing/retention";
import { createQuotationFromRequest, finalizeQuotation, getQuotation, updateQuotation } from "@/modules/quotations/service";
import { getRequestDetail, listRequests } from "@/modules/requests/queries";
import { acceptSuggestedItems, confirmItem, markItemNotFound } from "@/modules/requests/review";
import { systemContext } from "@/modules/tenancy/context";
import { getPrisma } from "@/platform/db";
import { createTestOrganization, productId, rejection, settleJobs, type TestOrganization } from "../helpers/factory";

/**
 * PERMISSÕES DE ACESSO, verificadas no backend (nos serviços de domínio) — a interface apenas
 * esconde o que o papel não alcança. Papéis: Proprietário, Administrador, Vendedor e Leitura.
 */

let org: TestOrganization;
let requestId: string;

const CSV = Buffer.from("descricao;quantidade;unidade\nDisjuntor DIN tripolar 32A curva C;10;un\nItem que não existe no catálogo xyz;2;un\n", "utf8");
const product = { sku: "PERM-001", description: "Produto de teste de permissão", unit: "UN" };

const expectForbidden = async (promise: Promise<unknown>) => {
  expect(await rejection(promise)).toMatchObject({ code: "FORBIDDEN" });
};

beforeAll(async () => {
  org = await createTestOrganization("perm", { withDemoCatalog: true });
  const upload = await ingestUpload(org.seller, { files: [{ name: "pedido.csv", data: CSV }] });
  await settleJobs();
  requestId = upload.requestId!;
});

describe("papel Leitura", () => {
  it("consulta, mas não altera nada", async () => {
    expect((await listProducts(org.viewer)).total).toBeGreaterThan(0);
    expect((await listRequests(org.viewer)).items.length).toBe(1);
    expect((await getDashboardData(org.viewer)).kpis.received).toBe(1);
    const detail = await getRequestDetail(org.viewer, requestId);

    await expectForbidden(ingestUpload(org.viewer, { files: [{ name: "pedido.csv", data: CSV }] }));
    await expectForbidden(confirmItem(org.viewer, detail.items[0]!.id, productId(org, "DJ-3P-032-C")));
    await expectForbidden(markItemNotFound(org.viewer, detail.items[1]!.id));
    await expectForbidden(acceptSuggestedItems(org.viewer, requestId));
    await expectForbidden(createQuotationFromRequest(org.viewer, requestId));
    await expectForbidden(createProduct(org.viewer, product));
    await expectForbidden(createCustomer(org.viewer, { name: "Cliente" }));
    await expectForbidden(createPriceList(org.viewer, { name: "Lista" }));
    await expectForbidden(listAuditLogs(org.viewer));
    await expectForbidden(listMembers(org.viewer));

    const after = await getRequestDetail(org.owner, requestId);
    expect(after.progress.pending).toBe(after.progress.total);
  });
});

describe("papel Vendedor", () => {
  it("revisa solicitações e monta cotações", async () => {
    const detail = await getRequestDetail(org.seller, requestId);
    expect((await acceptSuggestedItems(org.seller, requestId)).confirmed).toBe(1);
    await markItemNotFound(org.seller, detail.items[1]!.id);
    const quotation = await createQuotationFromRequest(org.seller, requestId);
    const view = await getQuotation(org.seller, quotation.id);
    await updateQuotation(org.seller, quotation.id, {
      customerName: "Cliente do vendedor",
      validUntil: "2031-01-01",
      discountPercent: 0,
      items: view.items.map((item) => ({ id: item.id, quantity: Number(item.quantity), unitPrice: item.unitPrice === null ? null : Number(item.unitPrice), discountPercent: 0 })),
    });
    await finalizeQuotation(org.seller, quotation.id);
    expect((await getQuotation(org.seller, quotation.id)).status).toBe("FINALIZED");
    expect((await createCustomer(org.seller, { name: "Cliente novo" })).id).toBeTruthy();
  });

  it("não administra catálogo, integrações, membros, configurações nem auditoria", async () => {
    await expectForbidden(createProduct(org.seller, product));
    await expectForbidden(updateProduct(org.seller, productId(org, "DJ-3P-032-C"), { ...product, sku: "DJ-3P-032-C" }));
    await expectForbidden(previewImport(org.seller, { target: "products", fileName: "catalogo.csv", data: Buffer.from("sku;descricao\nA;B\n") }));
    await expectForbidden(createPriceList(org.seller, { name: "Lista" }));
    await expectForbidden(getWhatsAppIntegration(org.seller));
    await expectForbidden(saveWhatsAppIntegration(org.seller, { phoneNumberId: "1234567890", accessToken: "token" }));
    await expectForbidden(rotateInboundEmailKey(org.seller));
    await expectForbidden(addMember(org.seller, { name: "Novo", email: "novo@perm.example", role: "VIEWER" }));
    await expectForbidden(updateOrganizationSettings(org.seller, { name: "Outra", defaultQuotationValidityDays: 10, documentRetentionDays: null }));
    await expectForbidden(deleteRequestDocuments(org.seller, requestId));
    await expectForbidden(listAuditLogs(org.seller));
  });
});

describe("Administrador e Proprietário", () => {
  it("administrador gerencia catálogo, membros e configurações", async () => {
    const created = await createProduct(org.admin, product);
    expect(created.sku).toBe("PERM-001");
    await addMember(org.admin, { name: "Pessoa Nova", email: `nova-${org.slug}@perm.example`, role: "SELLER" });
    await updateOrganizationSettings(org.admin, { name: "Empresa de Teste", defaultQuotationValidityDays: 20, documentRetentionDays: 90 });
    expect((await listAuditLogs(org.admin)).length).toBeGreaterThan(0);
    expect((await listMembers(org.admin)).length).toBe(5);
  });

  it("administrador não promove nem rebaixa proprietários; proprietário pode", async () => {
    const prisma = getPrisma();
    const sellerMembership = await prisma.membership.findFirstOrThrow({ where: { organizationId: org.id, userId: org.seller.userId! } });
    const ownerMembership = await prisma.membership.findFirstOrThrow({ where: { organizationId: org.id, userId: org.owner.userId! } });

    await expectForbidden(updateMemberRole(org.admin, sellerMembership.id, "OWNER"));
    await expectForbidden(updateMemberRole(org.admin, ownerMembership.id, "VIEWER"));
    await expectForbidden(removeMember(org.admin, ownerMembership.id));
    await expectForbidden(addMember(org.admin, { name: "Outro Dono", email: `dono2-${org.slug}@perm.example`, role: "OWNER" }));

    await updateMemberRole(org.owner, sellerMembership.id, "ADMIN");
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: sellerMembership.id } })).role).toBe("ADMIN");
    await updateMemberRole(org.owner, sellerMembership.id, "SELLER");
  });

  it("a organização nunca fica sem proprietário", async () => {
    const ownerMembership = await getPrisma().membership.findFirstOrThrow({ where: { organizationId: org.id, userId: org.owner.userId! } });
    const demote = await rejection(updateMemberRole(org.owner, ownerMembership.id, "ADMIN"));
    const remove = await rejection(removeMember(org.owner, ownerMembership.id));
    expect(demote).toMatchObject({ code: expect.stringMatching(/CONFLICT|VALIDATION|FORBIDDEN/) });
    expect(remove).toMatchObject({ code: expect.stringMatching(/CONFLICT|VALIDATION|FORBIDDEN/) });
    expect((await getPrisma().membership.findUniqueOrThrow({ where: { id: ownerMembership.id } })).role).toBe("OWNER");
  });
});

describe("atores de sistema", () => {
  it("workers e webhooks não herdam permissões de usuário", async () => {
    const system = systemContext(org.id);
    await expectForbidden(createProduct(system, product));
    await expectForbidden(listRequests(system));
    await expectForbidden(listAuditLogs(system));
  });
});
