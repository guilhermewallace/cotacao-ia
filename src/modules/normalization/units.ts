import { stripAccents } from "@/modules/normalization/text";

/**
 * Unidades de medida comerciais e quantidades no padrão brasileiro.
 */

const UNIT_ALIASES: Record<string, string> = {
  un: "UN", und: "UN", unid: "UN", unidade: "UN", unidades: "UN", pc: "UN", pcs: "UN", pca: "UN", pcas: "UN",
  peca: "UN", pecas: "UN", pç: "UN", pçs: "UN",
  m: "M", mt: "M", mts: "M", metro: "M", metros: "M",
  cm: "CM", mm: "MM",
  rl: "RL", rolo: "RL", rolos: "RL", bob: "RL", bobina: "RL", bobinas: "RL",
  cx: "CX", caixa: "CX", caixas: "CX",
  kg: "KG", quilo: "KG", quilos: "KG", kilo: "KG", kilos: "KG",
  g: "G", grama: "G", gramas: "G",
  l: "L", lt: "L", litro: "L", litros: "L",
  par: "PAR", pares: "PAR",
  jg: "JG", jogo: "JG", jogos: "JG",
  kit: "KIT", kits: "KIT",
  cj: "CJ", conjunto: "CJ", conjuntos: "CJ",
  ct: "CT", cento: "CT", centos: "CT",
  mil: "MIL", milheiro: "MIL", milheiros: "MIL",
  br: "BR", barra: "BR", barras: "BR", vara: "BR", varas: "BR",
  pct: "PCT", pacote: "PCT", pacotes: "PCT",
  sc: "SC", saco: "SC", sacos: "SC",
  fr: "FR", frasco: "FR", frascos: "FR",
  tb: "TB", tubo: "TB", tubos: "TB",
};

export const UNIT_LABELS: Record<string, string> = {
  UN: "unidade", M: "metro", CM: "centímetro", MM: "milímetro", RL: "rolo", CX: "caixa", KG: "quilo", G: "grama",
  L: "litro", PAR: "par", JG: "jogo", KIT: "kit", CJ: "conjunto", CT: "cento", MIL: "milheiro", BR: "barra",
  PCT: "pacote", SC: "saco", FR: "frasco", TB: "tubo",
};

/** Padrão (sem âncoras) das grafias de unidade aceitas ao ler texto livre. */
export const UNIT_WORD_PATTERN = Object.keys(UNIT_ALIASES)
  .sort((a, b) => b.length - a.length)
  .map((unit) => stripAccents(unit))
  .join("|");

/** Unidade em forma canônica (UN, M, RL, CX...) ou `null` quando desconhecida. */
export function normalizeUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = stripAccents(raw).toLowerCase().replace(/[.\s]/g, "");
  if (!key) return null;
  if (UNIT_ALIASES[key]) return UNIT_ALIASES[key];
  const upper = key.toUpperCase();
  return UNIT_LABELS[upper] ? upper : null;
}

/**
 * Converte quantidades em notação brasileira ou programática:
 * "2,5" → 2.5 · "1.000" → 1000 · "1.000,50" → 1000.5 · "1.5" → 1.5 · 12 → 12.
 * Retorna `null` para valores ausentes, inválidos ou não positivos — nunca inventa.
 */
export function parseQuantity(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;

  const text = raw.trim().replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(text)) return null;

  let normalized: string;
  if (text.includes(",")) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    normalized = text.replace(/\./g, "");
  } else {
    normalized = text;
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Valor monetário em notação brasileira: "R$ 1.234,56" → 1234.56, "12,5" → 12.5, "12.50" → 12.5.
 * Retorna `null` quando não for um número válido e não negativo.
 */
export function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;

  const text = raw.replace(/r\$/i, "").replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(text)) return null;

  let normalized: string;
  if (text.includes(",")) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    // "1.234" sem vírgula: milhar em pt-BR.
    normalized = text.replace(/\./g, "");
  } else {
    normalized = text;
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
