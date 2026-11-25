import { emptyExtraction } from "@/modules/ai/empty-extraction";
import type { AiCustomer, AiExtractedItem, AiExtraction } from "@/modules/ai/schema";
import { stripAccents } from "@/modules/normalization/text";
import { parseQuantity } from "@/modules/normalization/units";

/**
 * Extrator por regras, determinístico e sem serviços externos.
 *
 * É o motor do provedor de IA mock: lê listas simples de materiais em texto
 * ("10 disjuntores tripolares 32A", "Cabo flexível 2,5mm - 200 m"). Não substitui
 * um modelo de linguagem em documentos complexos — nesses casos, o que não for
 * reconhecido simplesmente não é extraído (nada é inventado).
 */

const PRODUCT_KEYWORDS = [
  "disjuntor", "cabo", "fio", "contator", "contactor", "rele", "tomada", "interruptor", "lampada", "refletor", "holofote",
  "eletroduto", "conduite", "canaleta", "quadro", "dps", "idr", "dr", "fusivel", "sensor", "inversor", "fonte", "botao",
  "botoeira", "sinaleiro", "terminal", "abracadeira", "fita", "prensa", "plugue", "luminaria", "reator", "soquete",
  "barramento", "transformador", "motor", "chave", "temporizador", "clp", "luva", "curva", "caixa", "haste", "conector",
  "borne", "trilho", "painel", "soft", "seccionadora", "timer", "fotocelula", "filtro", "ventilador", "exaustor",
];
const KEYWORD_PATTERN = new RegExp(`\\b(${PRODUCT_KEYWORDS.join("|")})(es|s)?\\b`);

/** Unidades aceitas junto a uma quantidade. `mm`, `cm`, `A`, `V`... são medidas, não quantidades. */
const QUANTITY_UNITS =
  "unidades|unidade|unid|und|un|pecas|peca|pcs|pc|pcas|pca|metros|metro|mts|mt|m|rolos|rolo|rl|caixas|caixa|cx|kg|quilos|quilo|pares|par|jogos|jogo|jg|kits|kit|barras|barra|br|varas|vara|pacotes|pacote|pct|centos|cento|ct|milheiros|milheiro";
/** Unidades que só valem como quantidade ao FINAL da linha (evita ler "100m" de "rolo 100m" como quantidade). */
const TRAILING_UNITS =
  "unidades|unidade|unid|und|un|pecas|peca|pcs|pc|pcas|pca|metros|metro|mts|rolos|rolo|rl|caixas|caixa|cx|kg|quilos|quilo|pares|par|jogos|jogo|jg|kits|kit|barras|barra|varas|vara|pacotes|pacote|pct";

const NUMBER = "\\d{1,6}(?:[.,]\\d{1,3})?";
const MEASURE_AHEAD = "(?!\\s?(?:mm|cm|a\\b|v\\b|w\\b|kw|cv|hp|ka|ma|hz|k\\b|pol|vca|vcc|\"|/|x\\s?\\d|p\\b|p\\+))";

const LEADING = new RegExp(`^(${NUMBER})(?![.,]?\\d)${MEASURE_AHEAD}\\s*(?:x\\s+)?(?:(${QUANTITY_UNITS})\\b\\.?)?\\s*(?:de\\s+|x\\s+)?(.{3,})$`);
const TRAILING_SEPARATED = new RegExp(`^(.{3,}?)\\s*(?:[-–:=]|\\bqtd\\.?:?|\\bqtde\\.?:?|\\bquantidade:?)\\s*(${NUMBER})\\s*(${QUANTITY_UNITS})?\\.?$`);
const TRAILING_WITH_UNIT = new RegExp(`^(.{3,}?)\\s+(${NUMBER})\\s*(${TRAILING_UNITS})\\.?$`);

const NOISE_LINE =
  /^(bom dia|boa tarde|boa noite|ola|oi|prezad[oa]s?|caro|cara|att|atenciosamente|obrigad[oa]|grat[oa]|abs|abracos?|segue|seguem|aguardo|fico no aguardo|favor|por favor|por gentileza|gostaria|preciso|precisamos|solicito|solicitamos|necessito|cotacao|orcamento|pedido de cotacao|lista de materiais?|materiais?|itens?|obra|entrega|prazo|pagamento|cnpj|cpf|telefone|tel|fone|whatsapp|e-?mail|endereco|empresa|cliente|razao social|contato|data|assunto|de:|para:)\b/;

const LEAD_IN =
  /^(?:(?:bom dia|boa tarde|boa noite|ola|oi)[,!. ]*)?(?:por favor[, ]*|por gentileza[, ]*)?(?:(?:eu\s+)?(?:preciso|precisamos|gostaria|gostariamos|necessito|necessitamos|quero|queremos|solicito|solicitamos|favor|poderia|pode)\s+)?(?:(?:me\s+)?(?:de\s+)?(?:cotar|orcar|enviar|mandar|passar|fazer)\s+)?(?:(?:a\s+|o\s+|um\s+|uma\s+)?(?:cotacao|orcamento|preco|precos)\s+)?(?:de\s+|dos?\s+|das?\s+|para\s+|:\s*)?/;

function plain(value: string): string {
  return stripAccents(value).toLowerCase();
}

function cleanDescription(value: string): string {
  return value.replace(/^[\s\-–:;,.•*]+|[\s\-–:;,]+$/g, "").replace(/\s+/g, " ").trim();
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-•*·▪●◦>]+|\(?\d{1,3}[.)]\s|item\s*\d+\s*[:.)-]?)\s*/i, "").trim();
}

/** Divide "10 disjuntores 32A, 5 contatores 18A e 200m de cabo. Obrigado!" em três itens e uma frase. */
function splitInlineList(line: string): string[] {
  // Fim de frase só separa quando o restante não tem números ("... preto. Consegue hoje?");
  // assim, abreviações como "disj. Tripolar 40A" não são partidas.
  const boundary = /(?<=[a-zà-ú0-9"”])[.!?]+\s+(?=[A-ZÀ-Ú][^\d]*$)/;
  return line
    .split(boundary)
    .flatMap((sentence) => sentence.split(/\s*[;,]\s+(?=\d)|\s+e\s+(?=\d{1,6}(?:[.,]\d+)?\s*(?:[a-zç]{1,8}\.?\s+)?[a-zç])/i))
    .map((part) => part.replace(/[.!?]+$/, "").trim())
    .filter(Boolean);
}

function removeLeadIn(line: string): { text: string; hadLeadIn: boolean } {
  const lowered = plain(line);
  const match = LEAD_IN.exec(lowered);
  if (match && match[0].length > 0 && match[0].length < lowered.length) {
    return { text: line.slice(match[0].length).trim(), hadLeadIn: true };
  }
  return { text: line, hadLeadIn: false };
}

function makeItem(input: { description: string; quantity: number | null; unit: string | null; excerpt: string; confidence: number; notes?: string }): AiExtractedItem {
  return {
    originalDescription: input.description,
    normalizedDescription: null,
    quantity: input.quantity,
    unit: input.unit,
    manufacturer: null,
    manufacturerCode: null,
    attributes: [],
    page: null,
    sourceExcerpt: input.excerpt.slice(0, 400),
    confidence: input.confidence,
    notes: input.notes ?? null,
  };
}

function parseSegment(segment: string, excerpt: string): AiExtractedItem | null {
  const text = cleanDescription(segment);
  if (text.length < 3) return null;
  const lowered = plain(text);

  const leading = LEADING.exec(lowered);
  if (leading) {
    const quantity = parseQuantity(leading[1] ?? "");
    const descriptionStart = text.length - (leading[3]?.length ?? 0);
    const description = cleanDescription(text.slice(descriptionStart));
    if (quantity && description.length >= 3 && /[a-z]{3}/.test(plain(description))) {
      return makeItem({ description, quantity, unit: leading[2] ?? null, excerpt, confidence: 0.9 });
    }
  }

  for (const pattern of [TRAILING_SEPARATED, TRAILING_WITH_UNIT]) {
    const trailing = pattern.exec(lowered);
    if (!trailing) continue;
    const quantity = parseQuantity(trailing[2] ?? "");
    const description = cleanDescription(text.slice(0, trailing[1]?.length ?? 0));
    if (quantity && description.length >= 3 && KEYWORD_PATTERN.test(plain(description))) {
      return makeItem({ description, quantity, unit: trailing[3] ?? null, excerpt, confidence: 0.85 });
    }
  }

  // Sem quantidade, só vale como item a linha que COMEÇA pelo nome de um produto
  // ("Cabo flexível 4mm"); frases como "estou montando um painel..." ficam de fora.
  const opening = lowered.split(/\s+/).slice(0, 2).join(" ");
  if (KEYWORD_PATTERN.test(opening) && !NOISE_LINE.test(lowered)) {
    return makeItem({
      description: text,
      quantity: null,
      unit: null,
      excerpt,
      confidence: 0.55,
      notes: "Quantidade não informada no documento.",
    });
  }
  return null;
}

function extractCustomer(text: string): AiCustomer | null {
  const taxId = /\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/.exec(text)?.[0] ?? null;
  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(text)?.[0] ?? null;
  const nameLine = /^\s*(?:empresa|cliente|raz[aã]o social|solicitante)\s*[:\-]\s*(.{3,120})$/im.exec(text)?.[1]?.trim() ?? null;
  const contact = /^\s*(?:contato|respons[aá]vel|comprador[a]?)\s*[:\-]\s*(.{3,80})$/im.exec(text)?.[1]?.trim() ?? null;
  if (!taxId && !email && !nameLine && !contact) return null;
  return { name: nameLine, taxId, email, phone: null, contactName: contact };
}

export function extractWithRules(text: string): AiExtraction {
  const items: AiExtractedItem[] = [];
  const seen = new Set<string>();

  // NFC garante que remover acentos não altera o comprimento das linhas (os índices são reutilizados).
  for (const rawLine of text.normalize("NFC").split(/\r?\n/)) {
    const line = stripListMarker(rawLine);
    if (!line) continue;

    const { text: withoutLeadIn, hadLeadIn } = removeLeadIn(line);
    const candidate = hadLeadIn ? withoutLeadIn : line;
    if (!hadLeadIn && NOISE_LINE.test(plain(line)) && !/\d/.test(line)) continue;

    for (const segment of splitInlineList(candidate)) {
      const item = parseSegment(segment, rawLine.trim());
      if (!item) continue;
      const key = `${plain(item.originalDescription)}|${item.quantity ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  if (items.length === 0) return emptyExtraction({ documentType: "other", customer: extractCustomer(text) });
  return { documentType: "quotation_request", legibility: "good", customer: extractCustomer(text), items, warnings: [] };
}
