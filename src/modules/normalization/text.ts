/**
 * Normalização de texto para descrições de materiais elétricos.
 *
 * A mesma função é aplicada ao catálogo e aos itens solicitados, de modo que a busca
 * (FTS + trigram) e o parser de atributos comparem textos equivalentes.
 * Funções puras e determinísticas — sem IA.
 */

const UNIT_SUFFIXES = ["mm2", "mm", "cm", "kva", "kv", "kw", "ka", "ma", "vcc", "vca", "vdc", "vac", "va", "hz", "cv", "hp", "pol", "lm", "a", "v", "w", "k", "m"];
const JOINABLE_UNITS = new RegExp(`(\\d+(?:\\.\\d+)?(?:/\\d+(?:\\.\\d+)?)*)\\s+(${UNIT_SUFFIXES.join("|")})\\b`, "g");

/** Abreviações e jargão comuns no balcão, mapeados para o termo de catálogo. */
const TOKEN_REPLACEMENTS: Record<string, string> = {
  disj: "disjuntor",
  dj: "disjuntor",
  disjuntores: "disjuntor",
  contactor: "contator",
  contatora: "contator",
  contactora: "contator",
  contatores: "contator",
  conduite: "eletroduto",
  conduites: "eletroduto",
  eletrodutos: "eletroduto",
  holofote: "refletor",
  holofotes: "refletor",
  cabinho: "cabo",
  flex: "flexivel",
  flexiveis: "flexivel",
  tomadas: "tomada",
  lamp: "lampada",
  lampadas: "lampada",
  interr: "interruptor",
  interruptores: "interruptor",
  inv: "inversor",
  inversores: "inversor",
  freq: "frequencia",
  abrac: "abracadeira",
  abracadeiras: "abracadeira",
  cx: "caixa",
  qd: "quadro",
  galv: "galvanizado",
  monopolar: "1p",
  monopolares: "1p",
  unipolar: "1p",
  unipolares: "1p",
  bipolar: "2p",
  bipolares: "2p",
  tripolar: "3p",
  tripolares: "3p",
  tetrapolar: "4p",
  tetrapolares: "4p",
  polegada: "pol",
  polegadas: "pol",
  bivolt: "bivolt",
  vcc: "vcc",
  vdc: "vcc",
  vca: "vca",
  vac: "vca",
};

const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\benforca[\s-]?gato\b/g, "abracadeira nylon"],
  [/\bcinta plastica\b/g, "abracadeira nylon"],
  [/\bfita hellermann\b/g, "abracadeira nylon"],
  [/\b([1-4]) polos?\b/g, "$1p"],
  [/\bc\/\s*/g, "com "],
  [/\bs\/\s*/g, "sem "],
  [/\bp\/\s*/g, "para "],
];

export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "ou", "em", "na", "no", "com", "sem", "para", "por",
  "um", "uma", "uns", "umas", "tipo", "marca", "modelo", "ref", "referencia", "similar", "equivalente", "favor",
  "cotar", "item", "itens", "un", "und", "unid", "unidade", "unidades", "pc", "pcs", "peca", "pecas", "que", "ao",
]);

export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Texto normalizado: minúsculas, sem acentos, unidades coladas ao número, jargão unificado. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  let text = input
    .replace(/[²]/g, "2")
    .replace(/[³]/g, "3")
    .replace(/[Øø⌀]/g, " diametro ")
    .replace(/[×✕]/g, "x")
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/[–—]/g, "-");

  text = stripAccents(text).toLowerCase();

  // Polegadas: 3/4" → 3/4pol
  text = text.replace(/(\d)\s*(?:"|''|pol\b\.?|polegadas?\b)/g, "$1pol ");
  // Vírgula decimal → ponto (2,5 → 2.5)
  text = text.replace(/(\d),(\d)/g, "$1.$2");
  // mm² em todas as grafias
  text = text.replace(/mm\s?\^?2\b/g, "mm2");
  // "3 x 2.5" → "3x2.5"
  text = text.replace(/(\d)\s*x\s*(\d)/g, "$1x$2");
  // Marcas de trecho ilegível ("4?A", "4_A") ficam presas ao token, para nunca virarem um valor ("4A").
  text = text.replace(/([a-z0-9])[?_]+(?=[a-z0-9])/g, "$1_");
  // Pontuação que não carrega significado
  text = text.replace(/[;:|()[\]{}!?*=<>#]+/g, " ").replace(/,/g, " ").replace(/(^|\s)_+|_+(?=\s|$)/g, " ");
  // Ponto final de abreviação ("disj." → "disj"), preservando decimais
  text = text.replace(/([a-z])\.(?=\s|$)/g, "$1 ").replace(/\.(?=\s|$)/g, " ");
  // Hífen entre palavras ("prensa-cabo" → "prensa cabo"); códigos são tratados à parte
  text = text.replace(/([a-z]{2,})-(?=[a-z]{2,})/g, "$1 ");

  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  // Unidade colada ao número: "32 a" → "32a", "2.5 mm2" → "2.5mm2"
  text = text.replace(JOINABLE_UNITS, "$1$2");

  const tokens = text
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const trimmed = token.replace(/^[-+/.']+|[-+/.']+$/g, "");
      return TOKEN_REPLACEMENTS[trimmed] ?? trimmed;
    })
    .filter(Boolean);

  return tokens.join(" ");
}

export function tokenize(normalized: string): string[] {
  return normalized.split(/\s+/).filter(Boolean);
}

/** Plural simples do português → singular, para comparar termos ("cabos" ≈ "cabo"). */
export function singularize(token: string): string {
  if (/\d/.test(token) || token.length <= 3) return token;
  if (token.endsWith("oes")) return `${token.slice(0, -3)}ao`;
  if (token.endsWith("ais")) return `${token.slice(0, -3)}al`;
  if (token.endsWith("eis")) return `${token.slice(0, -3)}el`;
  if (token.endsWith("res") || token.endsWith("zes")) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** Termos relevantes para comparação: sem stopwords, no singular, sem repetição. */
export function significantTokens(normalized: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tokenize(normalized)) {
    if (STOPWORDS.has(raw)) continue;
    const token = singularize(raw);
    if (token.length < 2 && !/\d/.test(token)) continue;
    if (!seen.has(token)) {
      seen.add(token);
      result.push(token);
    }
  }
  return result;
}

/** Código (SKU, código de fabricante) em forma canônica: maiúsculas, apenas letras e dígitos. */
export function normalizeCode(value: string | null | undefined): string {
  if (!value) return "";
  return stripAccents(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const MEASUREMENT_TOKEN = new RegExp(
  `^(?:\\d+(?:[.,]\\d+)?(?:/\\d+(?:[.,]\\d+)?)*(?:${UNIT_SUFFIXES.join("|")}|"|mm²)?|[1-4]p(?:\\+n)?(?:\\+t)?|ip\\d{2}|m\\d{1,2}|pg\\d+(?:[.,]\\d+)?|[bcd]\\d{1,3}|\\d+x\\d+(?:[.,]\\d+)?(?:mm2|mm|a|cm)?|\\d+(?:na|nf)(?:\\+\\d+(?:na|nf))?)$`,
  "i",
);

/**
 * Candidatos a código de produto presentes em um texto livre (ex.: "ZTK-DJ3P32C").
 * Um candidato tem ao menos 4 caracteres úteis, contém dígito e não é uma medida
 * (32A, 220V, 2,5mm², 3/4", IP65, M12...).
 */
export function extractCodeCandidates(text: string | null | undefined): string[] {
  if (!text) return [];
  const result = new Set<string>();
  const rawTokens = stripAccents(text)
    .split(/[\s,;:()[\]{}|]+/)
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean);

  for (const token of rawTokens) {
    if (!/\d/.test(token)) continue;
    if (/^\d+$/.test(token)) {
      // Só dígitos: aceito apenas como código longo (ex.: EAN ou código interno numérico).
      if (token.length >= 5 && token.length <= 20) result.add(token);
      continue;
    }
    if (MEASUREMENT_TOKEN.test(token)) continue;
    const code = normalizeCode(token);
    if (code.length < 4 || code.length > 40) continue;
    if (!/[A-Z]/.test(code) && code.length < 5) continue;
    result.add(code);
  }

  // Códigos escritos com espaço no meio ("AMP K18M", "5SL1 132-7"): tenta também a junção de
  // dois termos vizinhos. Junções sem sentido não fazem mal — só valem se existirem no catálogo.
  for (let index = 1; index < rawTokens.length; index += 1) {
    const previous = rawTokens[index - 1] as string;
    const current = rawTokens[index] as string;
    if (!/\d/.test(current) || MEASUREMENT_TOKEN.test(current)) continue;
    const brandPrefix = /^[A-Z]{2,6}$/.test(previous);
    const codeStart = /[A-Za-z]/.test(previous) && /\d/.test(previous) && !MEASUREMENT_TOKEN.test(previous);
    if (!brandPrefix && !codeStart) continue;
    const joined = normalizeCode(`${previous}${current}`);
    if (joined.length >= 5 && joined.length <= 40) result.add(joined);
  }
  return [...result];
}

/** Trunca texto para armazenamento/exibição sem cortar no meio de um par substituto. */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${[...value].slice(0, maxLength - 1).join("")}…`;
}
