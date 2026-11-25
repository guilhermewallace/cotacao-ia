
/**
 * Registro de atributos técnicos.
 *
 * Cada atributo tem uma chave canônica, um tipo e a indicação de criticidade:
 * divergência em atributo CRÍTICO torna o produto tecnicamente incompatível
 * (ex.: disjuntor de 32 A × 40 A); divergência em atributo não crítico apenas
 * reduz a pontuação e é exibida ao revisor (ex.: cor).
 */

export const ATTRIBUTE_KEYS = [
  "tensao_v",
  "tipo_tensao",
  "corrente_a",
  "faixa_ajuste_a",
  "polos",
  "configuracao_polos",
  "fases",
  "secao_mm2",
  "condutores",
  "diametro",
  "dimensoes",
  "material",
  "rosca",
  "potencia_w",
  "potencia_va",
  "curva",
  "corrente_residual_ma",
  "capacidade_interrupcao_ka",
  "tipo_saida",
  "contatos",
  "frequencia_hz",
  "grau_protecao",
  "cor",
  "comprimento_m",
  "temperatura_cor_k",
] as const;

export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export type AttributeValue = number | string | number[] | string[];
export type TechnicalAttributes = Partial<Record<AttributeKey, AttributeValue>>;

export type AttributeKind = "number" | "numberSet" | "text" | "textSet";

export interface AttributeDefinition {
  key: AttributeKey;
  label: string;
  unit?: string;
  kind: AttributeKind;
  critical: boolean;
  /** Tolerância relativa para comparação numérica (ex.: 0.03 = 3%). */
  tolerance?: number;
}

const definitions: AttributeDefinition[] = [
  { key: "tensao_v", label: "Tensão", unit: "V", kind: "numberSet", critical: true },
  { key: "tipo_tensao", label: "Tipo de tensão", kind: "text", critical: true },
  { key: "corrente_a", label: "Corrente", unit: "A", kind: "number", critical: true },
  { key: "faixa_ajuste_a", label: "Faixa de ajuste", unit: "A", kind: "text", critical: true },
  { key: "polos", label: "Polos", kind: "number", critical: true },
  { key: "configuracao_polos", label: "Configuração de polos", kind: "text", critical: true },
  { key: "fases", label: "Fases", kind: "number", critical: true },
  { key: "secao_mm2", label: "Bitola", unit: "mm²", kind: "number", critical: true },
  { key: "condutores", label: "Condutores", kind: "number", critical: true },
  { key: "diametro", label: "Diâmetro", kind: "text", critical: true },
  { key: "dimensoes", label: "Dimensões", kind: "text", critical: true },
  { key: "material", label: "Material", kind: "textSet", critical: true },
  { key: "rosca", label: "Rosca", kind: "text", critical: true },
  { key: "potencia_w", label: "Potência", unit: "W", kind: "number", critical: true, tolerance: 0.03 },
  { key: "potencia_va", label: "Potência aparente", unit: "VA", kind: "number", critical: true, tolerance: 0.03 },
  { key: "curva", label: "Curva", kind: "text", critical: true },
  { key: "corrente_residual_ma", label: "Corrente residual", unit: "mA", kind: "number", critical: true },
  { key: "capacidade_interrupcao_ka", label: "Capacidade de interrupção", unit: "kA", kind: "number", critical: true },
  { key: "tipo_saida", label: "Tipo de saída", kind: "text", critical: true },
  { key: "contatos", label: "Contatos", kind: "text", critical: true },
  { key: "frequencia_hz", label: "Frequência", unit: "Hz", kind: "numberSet", critical: false },
  { key: "grau_protecao", label: "Grau de proteção", kind: "text", critical: false },
  { key: "cor", label: "Cor", kind: "textSet", critical: false },
  { key: "comprimento_m", label: "Comprimento", unit: "m", kind: "number", critical: false },
  { key: "temperatura_cor_k", label: "Temperatura de cor", unit: "K", kind: "number", critical: false },
];

export const ATTRIBUTE_DEFINITIONS: Readonly<Record<AttributeKey, AttributeDefinition>> = Object.fromEntries(
  definitions.map((definition) => [definition.key, definition]),
) as Record<AttributeKey, AttributeDefinition>;

export const ATTRIBUTE_LIST: readonly AttributeDefinition[] = definitions;

export function isAttributeKey(value: string): value is AttributeKey {
  return (ATTRIBUTE_KEYS as readonly string[]).includes(value);
}

const MAX_TEXT_LENGTH = 60;
const MAX_SET_SIZE = 8;

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Texto aparado, de 1 a 60 caracteres; `null` quando não serve. */
function shortText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= 1 && text.length <= MAX_TEXT_LENGTH ? text : null;
}

/**
 * Valida um valor conforme o tipo do atributo; `null` quando é inválido.
 *
 * Escrito sem bibliotecas de propósito: este módulo também roda no navegador, dentro do
 * motor de demonstração da página pública (src/modules/landing/browser/engine.ts).
 */
function validateValue(kind: AttributeKind, value: unknown): AttributeValue | null {
  switch (kind) {
    case "number":
      return isPositiveNumber(value) ? value : null;
    case "numberSet":
      return Array.isArray(value) && value.length >= 1 && value.length <= MAX_SET_SIZE && value.every(isPositiveNumber) ? (value as number[]) : null;
    case "text":
      return shortText(value);
    case "textSet": {
      if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SET_SIZE) return null;
      const texts = value.map(shortText);
      return texts.every((item): item is string => item !== null) ? texts : null;
    }
  }
}

/**
 * Mantém apenas chaves conhecidas com valores válidos. Usado em toda fronteira
 * (IA, importação, formulário) antes de persistir atributos.
 */
export function sanitizeAttributes(raw: unknown): TechnicalAttributes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: TechnicalAttributes = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAttributeKey(key) || value === null || value === undefined) continue;
    const definition = ATTRIBUTE_DEFINITIONS[key];
    let candidate: unknown = value;
    if (definition.kind === "numberSet" && typeof value === "number") candidate = [value];
    if (definition.kind === "textSet" && typeof value === "string") candidate = [value];
    if (definition.kind === "text" && typeof value === "number") candidate = String(value);
    const parsed = validateValue(definition.kind, candidate);
    if (parsed === null) continue;
    let finalValue: AttributeValue = parsed;
    if (Array.isArray(finalValue)) {
      finalValue =
        definition.kind === "numberSet"
          ? [...new Set(finalValue as number[])].sort((a, b) => a - b)
          : [...new Set((finalValue as string[]).map((item) => item.toLowerCase()))].sort();
    } else if (typeof finalValue === "string") {
      finalValue = finalValue.toLowerCase();
    }
    result[key] = finalValue;
  }
  return result;
}

const INCH_FRACTIONS: Array<[number, string]> = [
  [0.125, "1/8"], [0.25, "1/4"], [0.375, "3/8"], [0.5, "1/2"], [0.625, "5/8"], [0.75, "3/4"], [0.875, "7/8"],
];

/** 0.75 → `3/4"`, 1.5 → `1 1/2"`, 2 → `2"`. */
export function formatInches(decimal: number): string {
  const whole = Math.floor(decimal + 1e-9);
  const rest = decimal - whole;
  const fraction = INCH_FRACTIONS.find(([value]) => Math.abs(value - rest) < 0.005);
  if (rest < 0.005) return `${whole}"`;
  if (!fraction) return `${formatNumber(decimal)}"`;
  return whole > 0 ? `${whole} ${fraction[1]}"` : `${fraction[1]}"`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}

const UPPERCASE_VALUES = new Set<AttributeKey>(["curva", "tipo_tensao", "tipo_saida", "grau_protecao", "rosca", "configuracao_polos", "contatos"]);

/** Valor de atributo em formato legível (pt-BR), com unidade. */
export function formatAttributeValue(key: AttributeKey, value: AttributeValue): string {
  const definition = ATTRIBUTE_DEFINITIONS[key];
  const unit = definition.unit ? ` ${definition.unit}` : "";

  if (key === "diametro" && typeof value === "string") {
    const inches = /^(\d+(?:\.\d+)?)pol$/.exec(value);
    if (inches?.[1]) return formatInches(Number(inches[1]));
    const millimeters = /^(\d+(?:\.\d+)?)mm$/.exec(value);
    if (millimeters?.[1]) return `${formatNumber(Number(millimeters[1]))} mm`;
    return value;
  }
  if (key === "potencia_w" && typeof value === "number" && value >= 1000) {
    return `${formatNumber(value / 1000)} kW`;
  }
  if (key === "potencia_va" && typeof value === "number" && value >= 1000) {
    return `${formatNumber(value / 1000)} kVA`;
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => (typeof item === "number" ? formatNumber(item) : item));
    return `${parts.join(definition.kind === "numberSet" ? "/" : ", ")}${unit}`;
  }
  if (typeof value === "number") return `${formatNumber(value)}${unit}`;
  return `${UPPERCASE_VALUES.has(key) ? value.toUpperCase() : value}${unit}`;
}

export function attributeLabel(key: AttributeKey): string {
  return ATTRIBUTE_DEFINITIONS[key].label;
}

/** Lista "rótulo: valor" na ordem do registro, para exibição. */
export function describeAttributes(attributes: TechnicalAttributes): Array<{ key: AttributeKey; label: string; value: string }> {
  const entries: Array<{ key: AttributeKey; label: string; value: string }> = [];
  for (const definition of definitions) {
    const value = attributes[definition.key];
    if (value === undefined) continue;
    entries.push({ key: definition.key, label: definition.label, value: formatAttributeValue(definition.key, value) });
  }
  return entries;
}
