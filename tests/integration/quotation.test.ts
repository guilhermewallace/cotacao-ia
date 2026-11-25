import * as XLSX from "xlsx";
import { beforeAll, describe, expect, it } from "vitest";
import { listAuditLogs } from "@/modules/audit/audit";
import { createPriceList, setPriceListItem } from "@/modules/catalog/price-lists";
import { getProduct, updateProduct } from "@/modules/catalog/products";
import { createCustomer } from "@/modules/customers/customers";
import { ingestUpload } from "@/modules/inbox/upload";
import { buildQuotationCsv } from "@/modules/quotations/export/csv";
import { loadQuotationExportData } from "@/modules/quotations/export/data";
import { buildQuotationPdf } from "@/modules/quotations/export/pdf";
import { buildQuotationXlsx } from "@/modules/quotations/export/xlsx";
import {
  cancelQuotation,
  createQuotationFromRequest,
  finalizeQuotation,
  getQuotation,
  reopenQuotation,
  repriceQuotation,
  updateQuotation,
  type QuotationUpdateInput,
  type QuotationView,
} from "@/modules/quotations/service";
import { getRequestDetail } from "@/modules/requests/queries";
import { acceptSuggestedItems, confirmItem, markItemNotFound, setItemPrice, setRequestCustomer, updateItemQuantity } from "@/modules/requests/review";
import { createTestOrganization, productId, rejection, settleJobs, type TestOrganization } from "../helpers/factory";

/** GERAÇÃO DE COTAÇÕES: revisão → cotação → edição → finalização → exportação. */

let org: TestOrganization;
const YEAR = new Date().getUTCFullYear();

const csv = (rows: string[]) => Buffer.from(["descricao;quantidade;unidade", ...rows].join("\n"), "utf8");

async function newRequest(rows: string[]): Promise<string> {
  const upload = await ingestUpload(org.seller, { files: [{ name: "pedido.csv", data: csv(rows) }] });
  await settleJobs();
  return upload.requestId!;
}

/** Solicitação revisada por completo: aceita as sugestões fortes e marca o resto como não encontrado. */
async function reviewedRequest(rows: string[]): Promise<string> {
  const requestId = await newRequest(rows);
  await acceptSuggestedItems(org.seller, requestId);
  for (const item of (await getRequestDetail(org.seller, requestId)).items) {
    if (item.status === "PENDING") await markItemNotFound(org.seller, item.id);
  }
  return requestId;
}

function asUpdate(quotation: QuotationView, overrides: Partial<QuotationUpdateInput> = {}): QuotationUpdateInput {
  return {
    customerId: quotation.customerId,
    customerName: quotation.customerName,
    validUntil: quotation.validUntil.toISOString().slice(0, 10),
    discountPercent: Number(quotation.discountPercent),
    items: quotation.items.map((item) => ({
      id: item.id,
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice === null ? null : Number(item.unitPrice),
      discountPercent: Number(item.discountPercent),
    })),
    ...overrides,
  };
}

const STANDARD = ["Disjuntor DIN tripolar 32A curva C;10;un", "Cabo flexível 2,5mm² 750V azul;200;m", "Manômetro 0-10 bar;1;un"];

beforeAll(async () => {
  org = await createTestOrganization("quote", { withDemoCatalog: true });
});

describe("da revisão à cotação", () => {
  it("só gera cotação quando todos os itens foram decididos por uma pessoa", async () => {
    const requestId = await newRequest(STANDARD);
    const pending = await rejection(createQuotationFromRequest(org.seller, requestId));
    expect(pending).toMatchObject({ code: "VALIDATION" });
    expect((pending as Error).message).toMatch(/3 itens pendentes/);

    const detail = await getRequestDetail(org.seller, requestId);
    for (const item of detail.items) await markItemNotFound(org.seller, item.id);
    expect(await rejection(createQuotationFromRequest(org.seller, requestId))).toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/nenhum item foi confirmado/i) });
  });

  it("gera a cotação com numeração sequencial, preços do catálogo e itens não atendidos", async () => {
    const requestId = await reviewedRequest(STANDARD);
    const created = await createQuotationFromRequest(org.seller, requestId);
    expect(created.number).toMatch(new RegExp(`^COT-${YEAR}-\\d{5}$`));

    const quotation = await getQuotation(org.seller, created.id);
    expect(quotation).toMatchObject({ status: "DRAFT", requestId, currency: "BRL", discountPercent: "0" });
    expect(quotation.items).toHaveLength(3);

    const [breaker, cable, gauge] = quotation.items;
    const breakerProduct = await getProduct(org.owner, productId(org, "DJ-3P-032-C"));
    expect(breaker).toMatchObject({ sku: "DJ-3P-032-C", quantity: "10", unit: "UN", available: true, priceSource: "CATALOG", unitPrice: breakerProduct.price });
    expect(Number(breaker!.lineTotal)).toBeCloseTo(10 * Number(breakerProduct.price), 2);
    expect(cable).toMatchObject({ sku: "CB-25-AZ", quantity: "200", unit: "M", available: true });
    // item pedido mas não atendido: consta na cotação, sem preço e sem somar
    expect(gauge).toMatchObject({ description: "Manômetro 0-10 bar", available: false, unitPrice: null, productId: null, lineTotal: "0.00" });

    expect(Number(quotation.subtotal)).toBeCloseTo(Number(breaker!.lineTotal) + Number(cable!.lineTotal), 2);
    expect(quotation.total).toBe(quotation.subtotal);
    expect(quotation.validUntil.getTime()).toBeGreaterThan(quotation.issueDate.getTime());

    // a solicitação fica "Cotada" e a revisão é travada
    const request = await getRequestDetail(org.seller, requestId);
    expect(request.status).toBe("QUOTED");
    expect(request.quotations).toEqual([{ id: created.id, number: created.number, status: "DRAFT" }]);
    expect(await rejection(confirmItem(org.seller, request.items[2]!.id, productId(org, "DJ-3P-032-C")))).toMatchObject({ code: "CONFLICT" });
    expect(await rejection(createQuotationFromRequest(org.seller, requestId))).toMatchObject({ code: "CONFLICT" });
  });

  it("exige quantidade nos itens confirmados — nunca assume '1'", async () => {
    const requestId = await newRequest(["Disjuntor DIN tripolar 32A curva C;;un"]);
    const detail = await getRequestDetail(org.seller, requestId);
    expect(detail.items[0]?.quantity).toBeNull();
    await acceptSuggestedItems(org.seller, requestId);
    expect(await rejection(createQuotationFromRequest(org.seller, requestId))).toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/quantidade/i) });
    await updateItemQuantity(org.seller, detail.items[0]!.id, { quantity: 7, unit: "un" });
    const created = await createQuotationFromRequest(org.seller, requestId);
    expect((await getQuotation(org.seller, created.id)).items[0]?.quantity).toBe("7");
  });

  it("a numeração é sequencial por organização, mesmo com criações simultâneas", async () => {
    const other = await createTestOrganization("quote2", { withDemoCatalog: true });
    const [first, second, third] = await Promise.all([reviewedRequest(STANDARD), reviewedRequest(STANDARD), reviewedRequest(STANDARD)]);
    const numbers = (await Promise.all([first, second, third].map((requestId) => createQuotationFromRequest(org.seller, requestId)))).map((quotation) => quotation.number).sort();
    const sequence = numbers.map((number) => Number(number.split("-")[2]));
    expect(new Set(numbers).size).toBe(3);
    expect(sequence[1]).toBe(sequence[0]! + 1);
    expect(sequence[2]).toBe(sequence[0]! + 2);

    // outra organização tem a sua própria sequência
    const upload = await ingestUpload(other.seller, { files: [{ name: "pedido.csv", data: csv(STANDARD) }] });
    await settleJobs();
    await acceptSuggestedItems(other.seller, upload.requestId!);
    for (const item of (await getRequestDetail(other.seller, upload.requestId!)).items) if (item.status === "PENDING") await markItemNotFound(other.seller, item.id);
    expect((await createQuotationFromRequest(other.seller, upload.requestId!)).number).toBe(`COT-${YEAR}-00001`);
  });
});

describe("preços: sempre do catálogo, da lista ou informados por uma pessoa", () => {
  it("usa a lista de preços do cliente e registra a origem de cada preço", async () => {
    const list = await createPriceList(org.owner, { name: "Parceiros" });
    await setPriceListItem(org.owner, list.id, productId(org, "DJ-3P-032-C"), 44.4);
    const customer = await createCustomer(org.owner, { name: "Cliente Parceiro", taxId: "12.345.678/0001-95", email: "compras@parceiro.example", priceListId: list.id });

    const requestId = await newRequest(STANDARD);
    await setRequestCustomer(org.seller, requestId, customer.id);
    const detail = await getRequestDetail(org.seller, requestId);
    expect(detail.items[0]?.candidates[0]).toMatchObject({ sku: "DJ-3P-032-C", price: "44.4", priceSource: "PRICE_LIST", priceListName: "Parceiros" });
    await acceptSuggestedItems(org.seller, requestId);
    await markItemNotFound(org.seller, detail.items[2]!.id);

    const quotation = await getQuotation(org.seller, (await createQuotationFromRequest(org.seller, requestId)).id);
    expect(quotation).toMatchObject({ customerId: customer.id, customerName: "Cliente Parceiro", customerTaxId: "12345678000195", customerEmail: "compras@parceiro.example", priceListName: "Parceiros" });
    expect(quotation.items[0]).toMatchObject({ unitPrice: "44.4", priceSource: "PRICE_LIST", lineTotal: "444.00" });
    expect(quotation.items[1]).toMatchObject({ priceSource: "CATALOG" }); // fora da lista: preço de catálogo
  });

  it("produto sem preço fica SEM preço; a cotação só é finalizada depois que alguém o informa", async () => {
    const requestId = await newRequest(["CLP compacto 14 entradas 10 saídas a relé 24Vcc;2;un", "Disjuntor DIN tripolar 32A curva C;1;un"]);
    await acceptSuggestedItems(org.seller, requestId);
    const detail = await getRequestDetail(org.seller, requestId);
    const plc = detail.items[0]!;
    if (plc.status === "PENDING") await confirmItem(org.seller, plc.id, productId(org, "CLP-14-10"));
    expect((await getRequestDetail(org.seller, requestId)).items[0]).toMatchObject({ status: "CONFIRMED", unitPrice: null, priceSource: null });

    const created = await createQuotationFromRequest(org.seller, requestId);
    const draft = await getQuotation(org.seller, created.id);
    expect(draft.items[0]).toMatchObject({ sku: "CLP-14-10", unitPrice: null, lineTotal: "0.00", available: true });

    const blocked = await rejection(finalizeQuotation(org.seller, created.id));
    expect(blocked).toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/pre[çc]o do item 1/i) });

    const priced = await updateQuotation(org.seller, created.id, asUpdate(draft, { items: asUpdate(draft).items.map((item, index) => (index === 0 ? { ...item, unitPrice: 1890.5 } : item)) }));
    expect(priced.items[0]).toMatchObject({ unitPrice: "1890.5", priceSource: "MANUAL", lineTotal: "3781.00" });
    await finalizeQuotation(org.seller, created.id);
    expect((await getQuotation(org.seller, created.id)).status).toBe("FINALIZED");
  });

  it("preço manual na revisão é preservado e pode ser desfeito", async () => {
    const requestId = await newRequest(["Disjuntor DIN tripolar 32A curva C;3;un"]);
    await acceptSuggestedItems(org.seller, requestId);
    const item = (await getRequestDetail(org.seller, requestId)).items[0]!;
    const catalogPrice = item.unitPrice;
    await setItemPrice(org.seller, item.id, 39.9);
    expect((await getRequestDetail(org.seller, requestId)).items[0]).toMatchObject({ unitPrice: "39.9", priceSource: "MANUAL", catalogPrice });
    expect(await rejection(setItemPrice(org.seller, item.id, -1))).toMatchObject({ code: "VALIDATION" });
    await setItemPrice(org.seller, item.id, null);
    expect((await getRequestDetail(org.seller, requestId)).items[0]).toMatchObject({ unitPrice: catalogPrice, priceSource: "CATALOG" });
  });
});

describe("edição, finalização e ciclo de vida", () => {
  let quotationId: string;
  let requestId: string;

  beforeAll(async () => {
    requestId = await reviewedRequest(STANDARD);
    quotationId = (await createQuotationFromRequest(org.seller, requestId)).id;
  });

  it("recalcula os totais no servidor ao editar quantidades, descontos, itens removidos e adicionados", async () => {
    const draft = await getQuotation(org.seller, quotationId);
    const [breaker, cable, gauge] = draft.items;
    const added = productId(org, "TM-2PT-20");
    const addedPrice = Number((await getProduct(org.owner, added)).price);

    const updated = await updateQuotation(org.seller, quotationId, {
      ...asUpdate(draft),
      customerName: "Metalúrgica Serra Verde",
      customerTaxId: "12.345.678/0001-95",
      paymentTerms: "28 dias",
      notes: "Frete por conta do cliente.",
      discountPercent: 5,
      items: [
        { id: breaker!.id, quantity: 12, unitPrice: 50, discountPercent: 10 },
        { id: cable!.id, quantity: 150.5, unitPrice: 3.333, discountPercent: 0 },
      ],
      removedItemIds: [gauge!.id],
      addedItems: [{ productId: added, quantity: 4 }],
    });

    expect(updated.items.map((item) => item.sku)).toEqual(["DJ-3P-032-C", "CB-25-AZ", "TM-2PT-20"]);
    expect(updated.items[0]).toMatchObject({ quantity: "12", unitPrice: "50", discountPercent: "10", lineTotal: "540.00", priceSource: "MANUAL" });
    expect(updated.items[1]).toMatchObject({ quantity: "150.5", lineTotal: "501.62" }); // 150,5 × 3,333 = 501,6165 → 501,62
    expect(updated.items[2]).toMatchObject({ quantity: "4", priceSource: "CATALOG" });
    const subtotal = 540 + 501.62 + Math.round(4 * addedPrice * 100) / 100;
    expect(Number(updated.subtotal)).toBeCloseTo(subtotal, 2);
    expect(Number(updated.discountTotal)).toBeCloseTo(Math.round(subtotal * 5) / 100, 2);
    expect(Number(updated.total)).toBeCloseTo(subtotal - Number(updated.discountTotal), 2);
    expect(updated).toMatchObject({ customerName: "Metalúrgica Serra Verde", customerTaxId: "12345678000195", paymentTerms: "28 dias", notes: "Frete por conta do cliente." });
  });

  it("valida os dados da edição", async () => {
    const draft = await getQuotation(org.seller, quotationId);
    const base = asUpdate(draft);
    const bad = (overrides: Partial<QuotationUpdateInput>) => rejection(updateQuotation(org.seller, quotationId, { ...base, ...overrides }));

    expect(await bad({ customerName: " " })).toBeInstanceOf(Error);
    expect(await bad({ discountPercent: 120 })).toBeInstanceOf(Error);
    expect(await bad({ validUntil: "2020-01-01" })).toMatchObject({ code: "VALIDATION" });
    expect(await bad({ validUntil: "31/12/2030" })).toBeInstanceOf(Error);
    expect(await bad({ items: base.items.map((item) => ({ ...item, quantity: 0 })) })).toBeInstanceOf(Error);
    expect(await bad({ items: base.items.map((item) => ({ ...item, unitPrice: -5 })) })).toBeInstanceOf(Error);
    expect(await bad({ items: [{ id: "3f2c1d6e-8a4b-4c1d-9e2f-0a1b2c3d4e5f", quantity: 1, unitPrice: 1, discountPercent: 0 }] })).toMatchObject({ code: "NOT_FOUND" });
    expect((await getQuotation(org.seller, quotationId)).total).toBe(draft.total);
  });

  it("a cotação guarda uma fotografia do produto: mudanças posteriores no catálogo não a alteram", async () => {
    const before = await getQuotation(org.seller, quotationId);
    const id = productId(org, "TM-2PT-20");
    const product = await getProduct(org.owner, id);
    await updateProduct(org.owner, id, { sku: product.sku, description: "Tomada 2P+T 20A 250V Branca — nova linha", unit: product.unit, price: 999 });
    const after = await getQuotation(org.seller, quotationId);
    expect(after.items[2]).toMatchObject({ description: before.items[2]!.description, unitPrice: before.items[2]!.unitPrice });
    expect(after.total).toBe(before.total);

    // "Atualizar preços" é uma ação explícita: aí sim os preços voltam a ser os do catálogo
    await repriceQuotation(org.seller, quotationId);
    const repriced = await getQuotation(org.seller, quotationId);
    expect(repriced.items[2]).toMatchObject({ unitPrice: "999", priceSource: "CATALOG" });
    expect(repriced.items[0]?.priceSource).toBe("CATALOG"); // o preço manual foi substituído
    await updateProduct(org.owner, id, { sku: product.sku, description: product.description, unit: product.unit, price: Number(product.price) });
    await repriceQuotation(org.seller, quotationId);
  });

  it("finalizada, a cotação fica travada; pode ser reaberta; cancelada, devolve a solicitação à revisão", async () => {
    await finalizeQuotation(org.seller, quotationId);
    const finalized = await getQuotation(org.seller, quotationId);
    expect(finalized.status).toBe("FINALIZED");
    expect(finalized.finalizedAt).toBeInstanceOf(Date);
    expect(await rejection(updateQuotation(org.seller, quotationId, asUpdate(finalized)))).toMatchObject({ code: "CONFLICT" });
    expect(await rejection(repriceQuotation(org.seller, quotationId))).toMatchObject({ code: "CONFLICT" });
    expect(await rejection(finalizeQuotation(org.seller, quotationId))).toMatchObject({ code: "CONFLICT" });

    await reopenQuotation(org.seller, quotationId);
    expect((await getQuotation(org.seller, quotationId)).status).toBe("DRAFT");
    expect(await rejection(reopenQuotation(org.seller, quotationId))).toMatchObject({ code: "CONFLICT" });

    await cancelQuotation(org.seller, quotationId);
    expect((await getQuotation(org.seller, quotationId)).status).toBe("CANCELED");
    expect(await rejection(updateQuotation(org.seller, quotationId, asUpdate(finalized)))).toMatchObject({ code: "CONFLICT" });
    expect(await rejection(reopenQuotation(org.seller, quotationId))).toMatchObject({ code: "CONFLICT" });
    expect((await getRequestDetail(org.seller, requestId)).status).toBe("AWAITING_REVIEW");
  });
});

describe("exportação", () => {
  it("gera PDF, Excel e CSV com os mesmos dados da cotação, e registra a exportação na auditoria", async () => {
    const created = await createQuotationFromRequest(org.seller, await reviewedRequest(STANDARD));
    const draft = await getQuotation(org.seller, created.id);
    await updateQuotation(org.seller, created.id, asUpdate(draft, { customerName: "Construtora Horizonte Azul", discountPercent: 2.5, notes: "Validade sujeita a estoque." }));
    const quotation = await getQuotation(org.seller, created.id);

    const pdfData = await loadQuotationExportData(org.viewer, created.id, "pdf"); // leitura basta para exportar
    const pdf = await buildQuotationPdf(pdfData);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-8).toString("latin1")).toContain("%%EOF");
    expect(pdf.byteLength).toBeGreaterThan(1500);

    const workbook = XLSX.read(buildQuotationXlsx(await loadQuotationExportData(org.seller, created.id, "xlsx")), { type: "buffer" });
    const cells = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]!]!, { header: 1, raw: true }).flat();
    expect(cells).toEqual(expect.arrayContaining([created.number, "Construtora Horizonte Azul", "DJ-3P-032-C", "CB-25-AZ", "Manômetro 0-10 bar"]));
    expect(cells).toContain(Number(quotation.total));
    expect(cells).toContain(Number(quotation.items[0]!.unitPrice));

    const csvText = buildQuotationCsv(await loadQuotationExportData(org.seller, created.id, "csv")).toString("utf8");
    expect(csvText).toContain(created.number);
    expect(csvText).toContain("Construtora Horizonte Azul");
    expect(csvText).toContain(Number(quotation.total).toFixed(2).replace(".", ","));
    expect(csvText.split("\n").filter((line) => /^\d+;/.test(line))).toHaveLength(3);

    const exports = (await listAuditLogs(org.owner, { limit: 20 })).filter((log) => log.action === "quotation.export" && log.entityId === created.id);
    expect(exports.map((log) => (log.metadata as { format: string }).format).sort()).toEqual(["csv", "pdf", "xlsx"]);
  });
});
