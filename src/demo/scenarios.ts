import type { AiExtraction } from "@/modules/ai/schema";

/**
 * Dados FICTÍCIOS do ambiente de demonstração: empresas, pessoas, contatos e
 * solicitações inventados. Os e-mails usam o domínio reservado `.example` e os
 * telefones seguem um padrão evidentemente fictício (…9 0000-0XXX).
 */

export const DEMO_ORG = {
  slug: "eletrica-central-demo",
  name: "Elétrica Central (demonstração)",
  legalName: "Elétrica Central Materiais Elétricos Ltda. — empresa fictícia",
  inboundEmailKey: "eletricacentral-demo",
  /** phone_number_id fictício, usado apenas pelo simulador local de webhooks. */
  whatsAppPhoneNumberId: "100000000000001",
  whatsAppDisplayNumber: "+55 11 90000-0001",
} as const;

export const SECONDARY_ORG = {
  slug: "volt-sul-demo",
  name: "Volt Sul Distribuidora (demonstração)",
  legalName: "Volt Sul Distribuidora Ltda. — empresa fictícia",
  inboundEmailKey: "voltsul-demo",
} as const;

export const DEMO_USERS = [
  { email: "ana.souza@eletricacentral.example", name: "Ana Souza", role: "OWNER" },
  { email: "bruno.lima@eletricacentral.example", name: "Bruno Lima", role: "SELLER" },
  { email: "carla.mendes@eletricacentral.example", name: "Carla Mendes", role: "VIEWER" },
] as const;

export const SECONDARY_USERS = [
  { email: "diego.rocha@voltsul.example", name: "Diego Rocha", role: "OWNER" },
  // Ana pertence às duas organizações: demonstra a troca de organização.
  { email: "ana.souza@eletricacentral.example", name: "Ana Souza", role: "ADMIN" },
] as const;

export interface DemoCustomer {
  key: string;
  name: string;
  legalName: string;
  contactName: string;
  email: string;
  phone: string;
  priceList?: "partners";
}

export const DEMO_CUSTOMERS: DemoCustomer[] = [
  { key: "horizonte", name: "Construtora Horizonte Azul", legalName: "Construtora Horizonte Azul Ltda. (fictícia)", contactName: "Marina Duarte", email: "compras@horizonteazul.example", phone: "5511900000101", priceList: "partners" },
  { key: "serra", name: "Metalúrgica Serra Verde", legalName: "Metalúrgica Serra Verde S.A. (fictícia)", contactName: "Rafael Teixeira", email: "suprimentos@serraverde.example", phone: "5531900000202" },
  { key: "acacias", name: "Condomínio Parque das Acácias", legalName: "Condomínio Edifício Parque das Acácias (fictício)", contactName: "Sílvia Prado", email: "administracao@parqueacacias.example", phone: "5521900000303" },
  { key: "valenorte", name: "Automação Vale Norte", legalName: "Vale Norte Automação Industrial Ltda. (fictícia)", contactName: "Diego Antunes", email: "diego@valenorte.example", phone: "5547900000404" },
  { key: "luzforca", name: "Instaladora Luz & Força", legalName: "Luz & Força Instalações Elétricas ME (fictícia)", contactName: "Paulo Meireles", email: "contato@luzeforca.example", phone: "5511900000505" },
];

// ─────────────────────── Documentos de exemplo (demo/fixtures) ───────────────────────

export const FIXTURE_FILES = {
  pdfOrder: "pedido-cotacao-horizonte-azul.pdf",
  spreadsheet: "lista-materiais-serra-verde.xlsx",
  csv: "pedido-condominio-acacias.csv",
  handwritten: "lista-manuscrita-condominio.jpg",
} as const;

/** Itens do PDF de exemplo (também usados para gerar o próprio PDF). */
export const PDF_ORDER_ITEMS: Array<{ description: string; unit: string; quantity: number }> = [
  { description: "Disjuntor DIN tripolar 32A curva C (ref. ZTK-M3C32)", unit: "un", quantity: 12 },
  { description: "Disjuntor DIN monopolar 16A curva C", unit: "un", quantity: 40 },
  { description: "IDR bipolar 40A 30mA", unit: "un", quantity: 6 },
  { description: "Cabo flexível 2,5mm² 750V azul", unit: "m", quantity: 500 },
  { description: "Cabo flexível 2,5mm² 750V preto", unit: "m", quantity: 500 },
  { description: 'Eletroduto PVC rígido roscável 3/4" barra 3m', unit: "br", quantity: 60 },
  { description: "Tomada 2P+T 10A 250V branca", unit: "un", quantity: 80 },
  { description: "Quadro de distribuição de embutir 24 disjuntores DIN", unit: "un", quantity: 4 },
];

export const SPREADSHEET_ROWS: Array<{ code: string; description: string; brand: string; unit: string; quantity: number; use: string }> = [
  { code: "AMP-K18M", description: "Contator tripolar 18A bobina 220Vca", brand: "Amperis", unit: "pç", quantity: 6, use: "Painel das bombas" },
  { code: "", description: "Relé térmico 12-18A", brand: "", unit: "pç", quantity: 6, use: "Painel das bombas" },
  { code: "", description: "Inversor de frequência 2CV 220V monofásico", brand: "", unit: "un", quantity: 2, use: "Esteira 3" },
  { code: "", description: "Sensor indutivo M18 PNP 24Vcc", brand: "", unit: "un", quantity: 8, use: "Esteira 3" },
  { code: "", description: "Fonte chaveada 24Vcc 5A", brand: "", unit: "un", quantity: 2, use: "Painel CLP" },
  { code: "", description: "Botão de emergência 22mm vermelho", brand: "", unit: "un", quantity: 3, use: "" },
  { code: "", description: "Chave fim de curso com rolete", brand: "", unit: "un", quantity: 4, use: "Portão da doca" },
  { code: "", description: 'Válvula solenoide 1/2" 24Vcc', brand: "", unit: "un", quantity: 2, use: "Linha de ar" },
  { code: "", description: "Cabo PP 3x2,5mm²", brand: "", unit: "m", quantity: 150, use: "" },
  { code: "", description: "Prensa-cabo PG 13,5", brand: "", unit: "un", quantity: 30, use: "" },
  { code: "", description: "Manômetro 0-10 bar", brand: "", unit: "un", quantity: 1, use: "Linha de ar" },
  { code: "", description: "Sinaleiro LED 22mm verde 220V", brand: "", unit: "un", quantity: 6, use: "" },
];

export const CSV_ROWS: Array<{ description: string; quantity: number; unit: string }> = [
  { description: "Lâmpada LED bulbo 9W bivolt 6500K", quantity: 40, unit: "un" },
  { description: "Refletor LED 50W bivolt IP65", quantity: 6, unit: "un" },
  { description: "Cabo flexível 2,5mm² 750V preto", quantity: 200, unit: "m" },
  { description: "Tomada 2P+T 10A branca", quantity: 25, unit: "un" },
  { description: "Fita isolante preta 19mm x 20m", quantity: 10, unit: "un" },
];

/** Linhas da lista manuscrita (usadas para gerar a imagem de exemplo). */
export const HANDWRITTEN_LINES = ["Lista p/ manutencao - bloco B", "30 lamp led 9w", "4 refletor led 50w", "2 disj. bipolar 4_A", "fita isol.", "100m cabo flex 4mm verde"];

function item(input: {
  description: string;
  quantity: number | null;
  unit: string | null;
  code?: string;
  confidence: number;
  notes?: string;
  excerpt?: string;
}): AiExtraction["items"][number] {
  return {
    originalDescription: input.description,
    normalizedDescription: null,
    quantity: input.quantity,
    unit: input.unit,
    manufacturer: null,
    manufacturerCode: input.code ?? null,
    attributes: [],
    page: 1,
    sourceExcerpt: input.excerpt ?? input.description,
    confidence: input.confidence,
    notes: input.notes ?? null,
  };
}

/**
 * Respostas do provedor de IA mock para os documentos de exemplo que dependem de
 * leitura por modelo (PDF e imagem). Planilhas e CSV são lidos diretamente, sem IA.
 */
export const FIXTURE_ANSWERS: Record<string, AiExtraction> = {
  [FIXTURE_FILES.pdfOrder]: {
    documentType: "quotation_request",
    legibility: "good",
    customer: { name: "Construtora Horizonte Azul", taxId: null, email: "compras@horizonteazul.example", phone: null, contactName: "Marina Duarte" },
    items: PDF_ORDER_ITEMS.map((row) =>
      item({
        description: row.description.replace(/ \(ref\. [^)]+\)/, ""),
        quantity: row.quantity,
        unit: row.unit,
        code: /ref\. ([A-Z0-9-]+)/.exec(row.description)?.[1],
        confidence: 0.97,
        excerpt: row.description,
      }),
    ),
    warnings: [],
  },
  [FIXTURE_FILES.handwritten]: {
    documentType: "quotation_request",
    legibility: "poor",
    customer: null,
    items: [
      item({ description: "lamp led 9w", quantity: 30, unit: null, confidence: 0.82 }),
      item({ description: "refletor led 50w", quantity: 4, unit: null, confidence: 0.78 }),
      item({
        description: "disj. bipolar 4_A",
        quantity: 2,
        unit: null,
        confidence: 0.35,
        notes: "Corrente parcialmente ilegível no original (pode ser 40A ou 45A). Confirme com o cliente.",
      }),
      item({ description: "fita isol.", quantity: null, unit: null, confidence: 0.5, notes: "Quantidade não informada no documento." }),
      item({ description: "cabo flex 4mm verde", quantity: 100, unit: "m", confidence: 0.74 }),
    ],
    warnings: ["Documento manuscrito com trechos pouco legíveis. Confira cada item com a imagem original."],
  },
};

// ─────────────────────────── Mensagens de exemplo ───────────────────────────

export const WHATSAPP_INCOMPATIBLE_TEXT = `Bom dia! Preciso de cotação pra hoje:
- 10 disjuntores tripolares 32A curva C
- 4 disjuntor tripolar 80A curva C
- 6 contatores 18A bobina 380V
- 200m de cabo flexível 2,5mm azul
- 20 un tomada 2P+T 20A branca
- 2 IDR tetrapolar 100A 30mA`;

export const EMAIL_INCOMPLETE_TEXT = `Olá,

Estou montando um painel e preciso de preço para:

Cabo flexível 4mm
Disjuntor bipolar
Canaleta 30x30
Fonte 24V

Abs,
Diego`;

export const EMAIL_PDF_BODY = `Prezados,

Segue em anexo nosso pedido de cotação para a obra Residencial Jardim das Flores.
Favor informar prazo de entrega.

Atenciosamente,
Marina Duarte
Construtora Horizonte Azul`;

export interface HistoricalRequest {
  customer: string;
  channel: "WHATSAPP" | "EMAIL";
  daysAgo: number;
  hour: number;
  subject?: string;
  text: string;
  /** O que o seed faz com a solicitação depois de processada. */
  outcome: "finalized" | "draft" | "awaiting";
}

export const HISTORICAL_REQUESTS: HistoricalRequest[] = [
  {
    customer: "luzforca", channel: "WHATSAPP", daysAgo: 12, hour: 9, outcome: "finalized",
    text: "Bom dia, cotar por favor:\n- 20 disjuntores DIN monopolar 20A curva C\n- 100m de cabo flexível 4mm preto\n- 15 un tomada 2P+T 20A branca",
  },
  {
    customer: "serra", channel: "EMAIL", daysAgo: 10, hour: 14, subject: "Cotação - painel de bombas", outcome: "finalized",
    text: "Boa tarde,\n\nSolicito cotação dos itens:\n1) 4 contator tripolar 25A bobina 220Vca\n2) 4 relé térmico 17-25A\n3) 10 sinaleiro LED 22mm vermelho 220V\n\nObrigado,\nRafael",
  },
  {
    customer: "acacias", channel: "WHATSAPP", daysAgo: 9, hour: 11, outcome: "finalized",
    text: "Oi! Para a área externa do condomínio:\n- 12 refletor LED 100W bivolt IP65\n- 30 lâmpada LED bulbo 12W bivolt 6500K",
  },
  {
    customer: "valenorte", channel: "EMAIL", daysAgo: 7, hour: 16, subject: "Materiais para painel", outcome: "draft",
    text: "Olá,\n\nPreciso de:\n- 6 sensor indutivo M12 PNP 24Vcc\n- 2 fonte chaveada 24Vcc 10A\n- 20 borne de passagem 2,5mm² cinza\n- 2 trilho DIN 35mm 2m\n\nAbs, Diego",
  },
  {
    customer: "horizonte", channel: "WHATSAPP", daysAgo: 5, hour: 10, outcome: "finalized",
    text: "Bom dia! Mais um pedido da obra:\n- 300m de cabo flexível 6mm azul\n- 300m de cabo flexível 6mm preto\n- 10 IDR bipolar 40A 30mA\n- 6 DPS 275V 20kA",
  },
  {
    customer: "luzforca", channel: "EMAIL", daysAgo: 3, hour: 15, subject: "Eletrodutos", outcome: "awaiting",
    text: 'Boa tarde,\n\n- 50 eletroduto PVC rígido 1" barra 3m\n- 100 luva eletroduto PVC 1"\n- 20 curva 90 eletroduto PVC 1"\n\nPaulo',
  },
  {
    customer: "serra", channel: "WHATSAPP", daysAgo: 2, hour: 8, outcome: "awaiting",
    text: "Bom dia, preciso de:\n- 2 inversor de frequência 3CV 380V trifásico\n- 2 quadro de comando aço 60x40x20cm IP54",
  },
];
