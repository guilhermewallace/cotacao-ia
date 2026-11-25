import * as XLSX from "xlsx";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeImport, applyImport, parseImportTable, previewImport, suggestMapping } from "@/modules/catalog/import";
import { getPriceList, listPriceLists } from "@/modules/catalog/price-lists";
import { createProduct, findDuplicateGroups, getProduct, listProducts, searchProducts } from "@/modules/catalog/products";
import { resolvePrice } from "@/modules/pricing/resolve";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { createTestOrganization, rejection, type TestOrganization } from "../helpers/factory";

/** IMPORTAÇÃO DE CATÁLOGO E LISTAS DE PREÇOS (CSV e Excel). */

let org: TestOrganization;

const utf8 = (lines: string[]) => Buffer.from(lines.join("\n"), "utf8");

beforeAll(async () => {
  org = await createTestOrganization("imp");
  await createProduct(org.owner, { sku: "EX-001", description: "Disjuntor DIN Monopolar 10A Curva C", manufacturer: "Zentrik", unit: "UN", price: 10 });
});

describe("leitura de planilhas", () => {
  it("lê CSV do Excel brasileiro (ponto e vírgula, Windows-1252, vírgula decimal)", async () => {
    const latin1 = Buffer.from("Código;Descrição;Preço\r\nA-1;Lâmpada LED 9W;12,50\r\nA-2;Eletroduto 3/4\";7,90\r\n", "latin1");
    const table = await parseImportTable(latin1, "produtos.csv");
    expect(table.headers).toEqual(["Código", "Descrição", "Preço"]);
    expect(table.rows.map((row) => row.cells)).toEqual([
      ["A-1", "Lâmpada LED 9W", "12,50"],
      ["A-2", 'Eletroduto 3/4"', "7,90"],
    ]);
    expect(table.rows[0]?.number).toBe(2);
  });

  it("lê CSV separado por vírgula com aspas e Excel (.xlsx)", async () => {
    const comma = await parseImportTable(utf8(['sku,descricao,preco', 'B-1,"Cabo flexível 2,5mm² azul","3,20"']), "produtos.csv");
    expect(comma.rows[0]?.cells).toEqual(["B-1", "Cabo flexível 2,5mm² azul", "3,20"]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["SKU", "Descrição", "Preço"], ["C-1", "Contator 18A 220V", 141.43]]), "Produtos");
    const xlsx = await parseImportTable(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer, "produtos.xlsx");
    expect(xlsx.sheetName).toBe("Produtos");
    expect(xlsx.rows[0]?.cells.slice(0, 2)).toEqual(["C-1", "Contator 18A 220V"]);
  });

  it("reconhece as colunas pelo cabeçalho", () => {
    const mapping = suggestMapping(["Cód. Produto", "Descrição do Produto", "Marca", "Part Number", "Grupo", "UN", "Preço de Venda", "Sinônimos"], "products");
    expect(mapping.columns).toMatchObject({ description: 1, manufacturer: 2, manufacturerCode: 3, category: 4, unit: 5, price: 6, synonyms: 7 });
    expect(suggestMapping(["SKU", "Valor"], "price_list").columns).toEqual({ sku: 0, price: 1 });
  });

  it("recusa arquivos que não são planilhas", async () => {
    expect(await rejection(parseImportTable(Buffer.from("%PDF-1.4 conteúdo"), "catalogo.pdf"))).toMatchObject({ code: "VALIDATION" });
    expect(await rejection(parseImportTable(Buffer.from(""), "vazio.csv"))).toMatchObject({ code: "VALIDATION" });
  });
});

describe("importação de produtos", () => {
  const file = utf8([
    "sku;descricao;fabricante;codigo fabricante;categoria;unidade;preco;sinonimos",
    'EX-001;Disjuntor DIN Monopolar 10A Curva C 3kA;Zentrik;ZTK-M1C10;Proteção;un;11,90;"minidisjuntor 1P 10A; disjuntor unipolar 10A"',
    "NV-001;Disjuntor DIN Tripolar 40A Curva C 3kA;Zentrik;ZTK-M3C40;Proteção;pç;58,90;",
    "NV-002;Cabo Flexível 2,5mm² 750V Azul;Kabrax;;Cabos;m;3,20;cabinho 2,5 azul",
    "NV-003;Produto sem preço;;;;un;;",
    ";Linha sem SKU;;;;un;10;",
    "NV-004;;;;;un;10;",
    "NV-005;Preço inválido;;;;un;abc;",
    "NV-001;SKU repetido no arquivo;;;;un;1;",
  ]);

  it("analisa sem gravar: o que será criado, atualizado e recusado", async () => {
    const preview = await previewImport(org.owner, { target: "products", fileName: "catalogo.csv", data: file });
    expect(preview.totalRows).toBe(8);
    expect(preview.mapping.columns).toMatchObject({ sku: 0, description: 1, manufacturer: 2, manufacturerCode: 3, category: 4, unit: 5, price: 6, synonyms: 7 });
    expect(preview.analysis.stats).toMatchObject({ totalRows: 8, toCreate: 3, toUpdate: 1 });
    expect(preview.analysis.stats.errors).toBe(4);
    const messages = preview.analysis.issues.map((issue) => `${issue.row}:${issue.message}`).join("\n");
    expect(messages).toMatch(/6:.*SKU/i);
    expect(messages).toMatch(/7:.*descri/i);
    expect(messages).toMatch(/8:.*pre[çc]o/i);
    expect(messages).toMatch(/9:.*(repetid|duplicad)/i);

    // nada foi gravado na etapa de conferência
    expect((await listProducts(org.owner)).total).toBe(1);
  });

  it("aplica: cria novos, atualiza existentes pelo SKU e cadastra sinônimos", async () => {
    const preview = await previewImport(org.owner, { target: "products", fileName: "catalogo.csv", data: file });
    const result = await applyImport(org.owner, preview.importId, preview.mapping, { updateExisting: true });
    expect(result).toMatchObject({ created: 3, updated: 1, errors: 4 });
    expect(result.aliasesCreated).toBe(3);

    const products = await listProducts(org.owner, { pageSize: 50 });
    expect(products.items.map((product) => product.sku).sort()).toEqual(["EX-001", "NV-001", "NV-002", "NV-003"]);

    const updated = products.items.find((product) => product.sku === "EX-001")!;
    expect(updated).toMatchObject({ description: "Disjuntor DIN Monopolar 10A Curva C 3kA", manufacturerCode: "ZTK-M1C10", price: "11.9", category: "Proteção" });
    const detail = await getProduct(org.owner, updated.id);
    expect(detail.aliases.map((alias) => alias.value).sort()).toEqual(["disjuntor unipolar 10A", "minidisjuntor 1P 10A"]);
    expect(detail.attributes).toMatchObject({ corrente_a: 10, polos: 1, curva: "c" });

    const created = products.items.find((product) => product.sku === "NV-001")!;
    expect(created).toMatchObject({ unit: "UN", price: "58.9" });
    expect(created.attributes).toMatchObject({ corrente_a: 40, polos: 3 });
    // produto sem preço fica SEM preço — nenhum valor é inventado
    expect(products.items.find((product) => product.sku === "NV-003")?.price).toBeNull();

    // os importados já são encontrados pela busca (texto completo, sinônimo e código)
    expect((await searchProducts(org.owner, "cabinho 2,5 azul"))[0]?.sku).toBe("NV-002");
    expect((await searchProducts(org.owner, "ZTK-M3C40"))[0]?.sku).toBe("NV-001");
  });

  it("reimportar o mesmo arquivo não duplica; sem 'atualizar existentes', os já cadastrados são ignorados", async () => {
    const preview = await previewImport(org.owner, { target: "products", fileName: "catalogo.csv", data: file });
    expect(preview.analysis.stats).toMatchObject({ toCreate: 0, toUpdate: 4 });
    const result = await applyImport(org.owner, preview.importId, preview.mapping, { updateExisting: false });
    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 4 });
    expect((await listProducts(org.owner, { pageSize: 50 })).total).toBe(4);
    const aliases = await tenantDb(org.id).productAlias.count();
    expect(aliases).toBe(3);
  });

  it("uma importação só pode ser aplicada uma vez, e apenas pela organização que a enviou", async () => {
    const preview = await previewImport(org.owner, { target: "products", fileName: "catalogo.csv", data: utf8(["sku;descricao", "UNICO-1;Produto único de teste"]) });
    const other = await createTestOrganization("imp2");
    expect(await rejection(applyImport(other.owner, preview.importId, preview.mapping))).toMatchObject({ code: "NOT_FOUND" });
    expect((await applyImport(org.owner, preview.importId, preview.mapping)).created).toBe(1);
    expect(await rejection(applyImport(org.owner, preview.importId, preview.mapping))).toMatchObject({ code: expect.stringMatching(/CONFLICT|NOT_FOUND/) });
    expect((await listProducts(other.owner)).total).toBe(0);
  });

  it("exige o mapeamento das colunas obrigatórias", async () => {
    const preview = await previewImport(org.owner, { target: "products", fileName: "x.csv", data: utf8(["coluna a;coluna b", "1;2"]) });
    expect(preview.mapping.columns.sku).toBeNull();
    expect(await rejection(analyzeImport(org.owner, preview.importId, preview.mapping))).toMatchObject({ code: "VALIDATION" });
    const fixed = await analyzeImport(org.owner, preview.importId, { columns: { sku: 0, description: 1 }, attributeColumns: [] });
    expect(fixed.stats.totalRows).toBe(1);
  });

  it("detecta produtos possivelmente duplicados", async () => {
    await createProduct(org.owner, { sku: "DUP-1", description: "Contator Tripolar 25A Bobina 220Vca", manufacturerCode: "AMP-K25M", unit: "UN" });
    await createProduct(org.owner, { sku: "DUP-2", description: "Contator Tripolar 25A Bobina 220Vca 1NA", manufacturerCode: "amp k25m", unit: "UN" });
    const groups = await findDuplicateGroups(org.owner);
    const byCode = groups.find((group) => group.reason === "MANUFACTURER_CODE");
    expect(byCode?.products.map((product) => product.sku).sort()).toEqual(["DUP-1", "DUP-2"]);
  });
});

describe("importação de lista de preços", () => {
  it("cria a lista, define preços por SKU e ignora SKUs desconhecidos", async () => {
    const data = utf8(["codigo;preco", "EX-001;9,50", "NV-001;55,00", "NAO-EXISTE;1,00", "NV-002;-3"]);
    const preview = await previewImport(org.owner, { target: "price_list", fileName: "precos.csv", data });
    expect(preview.analysis.stats).toMatchObject({ totalRows: 4, valid: 2, errors: 2 });

    const result = await applyImport(org.owner, preview.importId, preview.mapping, { newPriceListName: "Revendas" });
    expect(result).toMatchObject({ created: 2, errors: 2 });
    const list = (await listPriceLists(org.owner)).find((entry) => entry.name === "Revendas")!;
    expect(result.priceListId).toBe(list.id);
    const items = await getPriceList(org.owner, list.id);
    expect(items.items.map((item) => [item.sku, item.unitPrice])).toEqual([
      ["EX-001", "9.5"],
      ["NV-001", "55"],
    ]);

    // reimportar na mesma lista atualiza o preço, sem duplicar
    const again = await previewImport(org.owner, { target: "price_list", fileName: "precos.csv", data: utf8(["codigo;preco", "EX-001;9,90"]) });
    const second = await applyImport(org.owner, again.importId, again.mapping, { priceListId: list.id });
    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect((await getPriceList(org.owner, list.id)).total).toBe(2);
  });

  it("o preço vem da lista do cliente, da lista padrão ou do catálogo — nessa ordem — e nunca é inventado", async () => {
    const db = tenantDb(org.id);
    const products = await listProducts(org.owner, { pageSize: 50 });
    const id = (sku: string) => products.items.find((product) => product.sku === sku)!.id;
    const list = (await listPriceLists(org.owner)).find((entry) => entry.name === "Revendas")!;
    const customer = await db.customer.create({ data: { organizationId: org.id, name: "Cliente com lista", priceListId: list.id } });

    const fromList = await resolvePrice(db, id("EX-001"), { customerId: customer.id });
    expect(fromList).toMatchObject({ source: "PRICE_LIST", priceListName: "Revendas" });
    expect(fromList.unitPrice?.toString()).toBe("9.9");

    const fromCatalog = await resolvePrice(db, id("EX-001"), { customerId: null });
    expect(fromCatalog.source).toBe("CATALOG");
    expect(fromCatalog.unitPrice?.toString()).toBe("11.9");

    const fallback = await resolvePrice(db, id("NV-002"), { customerId: customer.id });
    expect(fallback.source).toBe("CATALOG");

    const none = await resolvePrice(db, id("NV-003"), { customerId: customer.id });
    expect(none).toMatchObject({ unitPrice: null, source: null });
  });
});
