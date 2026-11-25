import { describe, expect, it } from "vitest";
import { buildQuotationCsv, escapeCsvCell } from "@/modules/quotations/export/csv";
import { computeLineTotal, computeTotals, formatQuotationNumber } from "@/modules/quotations/totals";

describe("totais da cotação (aritmética decimal exata)", () => {
  it("calcula o total da linha com desconto e arredondamento meio para cima", () => {
    expect(computeLineTotal({ quantity: 3, unitPrice: "19.99" }).toFixed(2)).toBe("59.97");
    expect(computeLineTotal({ quantity: "2.5", unitPrice: "10.25", discountPercent: 10 }).toFixed(2)).toBe("23.06"); // 23,0625 → 23,06
    expect(computeLineTotal({ quantity: 1, unitPrice: "0.125" }).toFixed(2)).toBe("0.13"); // meio para cima
    expect(computeLineTotal({ quantity: 3, unitPrice: "0.1" }).toFixed(2)).toBe("0.30"); // sem erro de ponto flutuante
  });

  it("não soma itens sem preço nem itens não atendidos — e nunca inventa um preço", () => {
    expect(computeLineTotal({ quantity: 10, unitPrice: null }).toFixed(2)).toBe("0.00");
    expect(computeLineTotal({ quantity: 10, unitPrice: 5, available: false }).toFixed(2)).toBe("0.00");
  });

  it("aplica o desconto geral sobre o subtotal", () => {
    const totals = computeTotals(
      [
        { quantity: 6, unitPrice: "141.43" },
        { quantity: 150, unitPrice: "10.62" },
        { quantity: 4, unitPrice: null },
        { quantity: 2, unitPrice: 99, available: false },
      ],
      5,
    );
    expect(totals.subtotal.toFixed(2)).toBe("2441.58");
    expect(totals.discountTotal.toFixed(2)).toBe("122.08"); // 122,079 → 122,08
    expect(totals.total.toFixed(2)).toBe("2319.50");
  });

  it("numera as cotações por ano com cinco dígitos", () => {
    expect(formatQuotationNumber(7, new Date("2026-11-23T00:00:00Z"))).toBe("COT-2026-00007");
    expect(formatQuotationNumber(12345, new Date("2027-01-02T00:00:00Z"))).toBe("COT-2027-12345");
  });
});

describe("exportação CSV", () => {
  it("neutraliza fórmulas (CSV injection) e escapa separadores", () => {
    expect(escapeCsvCell("=HYPERLINK(\"http://exemplo\")")).toMatch(/^"?'=/);
    expect(escapeCsvCell("+55 11 90000-0001")).toMatch(/^"?'\+/);
    expect(escapeCsvCell("@cmd")).toMatch(/^"?'@/);
    expect(escapeCsvCell("Cabo; flexível")).toBe('"Cabo; flexível"');
    expect(escapeCsvCell('Eletroduto 3/4"')).toBe('"Eletroduto 3/4"""');
    expect(escapeCsvCell(null)).toBe("");
  });

  it("gera CSV com BOM, ponto e vírgula e vírgula decimal", () => {
    const csv = buildQuotationCsv({
      organization: { name: "Empresa Teste", legalName: null, taxId: null, isDemo: false },
      quotation: {
        id: "q1",
        number: "COT-2026-00001",
        status: "DRAFT",
        requestId: null,
        customerId: null,
        customerName: "Cliente Teste",
        customerTaxId: null,
        customerEmail: null,
        customerPhone: null,
        customerContact: null,
        priceListName: null,
        issueDate: new Date("2026-11-23T00:00:00Z"),
        validUntil: new Date("2026-12-08T00:00:00Z"),
        notes: null,
        paymentTerms: null,
        deliveryTerms: null,
        discountPercent: "0",
        subtotal: "1234.50",
        discountTotal: "0",
        total: "1234.50",
        currency: "BRL",
        createdByName: null,
        finalizedAt: null,
        createdAt: new Date("2026-11-23T12:00:00Z"),
        items: [
          {
            id: "i1",
            lineNumber: 1,
            productId: "p1",
            sku: "DJ-3P-032-C",
            description: "Disjuntor DIN Tripolar 32A Curva C",
            unit: "UN",
            quantity: "10",
            unitPrice: "123.45",
            discountPercent: "0",
            lineTotal: "1234.50",
            priceSource: "CATALOG",
            available: true,
            notes: null,
          },
        ],
      },
    }).toString("utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("COT-2026-00001");
    expect(csv).toContain("DJ-3P-032-C;Disjuntor DIN Tripolar 32A Curva C;UN;10;123,45");
    expect(csv).toContain("1234,50");
  });
});
