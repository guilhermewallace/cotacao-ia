import { MATERIAL_ROLES } from "@/modules/normalization/attribute-parser";
import {
  ATTRIBUTE_DEFINITIONS,
  ATTRIBUTE_LIST,
  formatAttributeValue,
  type AttributeKey,
  type AttributeValue,
  type TechnicalAttributes,
} from "@/modules/normalization/attributes";

/**
 * Comparação de atributos técnicos entre o item solicitado e um produto do catálogo.
 *
 * Três resultados possíveis por atributo solicitado:
 * - MATCH: o produto atende ao valor solicitado;
 * - MISMATCH: o produto declara um valor diferente;
 * - UNKNOWN: o catálogo não informa o atributo (ou usa outra forma de medida) —
 *   não é possível afirmar compatibilidade, e isso é dito ao revisor.
 */

export type AttributeVerdict = "MATCH" | "MISMATCH" | "UNKNOWN";

export interface AttributeComparison {
  key: AttributeKey;
  label: string;
  critical: boolean;
  verdict: AttributeVerdict;
  /** Valor solicitado, formatado. */
  requested: string;
  /** Valor do produto, formatado; `null` quando o catálogo não informa. */
  product: string | null;
}

export interface ComparisonSummary {
  comparisons: AttributeComparison[];
  matches: AttributeComparison[];
  criticalMismatches: AttributeComparison[];
  softMismatches: AttributeComparison[];
  unknownCritical: AttributeComparison[];
  unknownSoft: AttributeComparison[];
  /** Verdadeiro quando não há divergência em atributo crítico. */
  compatible: boolean;
}

function asNumbers(value: AttributeValue): number[] {
  if (Array.isArray(value)) return value.filter((item): item is number => typeof item === "number");
  return typeof value === "number" ? [value] : [];
}

function asTexts(value: AttributeValue): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function numbersEqual(a: number, b: number, tolerance = 0): boolean {
  if (tolerance <= 0) return Math.abs(a - b) < 1e-9;
  return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * tolerance;
}

function compareDiameter(requested: string, product: string): AttributeVerdict {
  const unitOf = (value: string) => (value.endsWith("pol") ? "pol" : value.endsWith("mm") ? "mm" : "outro");
  if (unitOf(requested) !== unitOf(product)) {
    // Polegadas × milímetros nominais não têm conversão direta (ex.: eletroduto 3/4" ≈ DN 25).
    return "UNKNOWN";
  }
  return requested === product ? "MATCH" : "MISMATCH";
}

/**
 * Dimensões (LxA ou LxAxP): compara os números, sem depender da ordem dos lados.
 * Unidades diferentes são convertidas (cm ↔ mm); se um dos lados não informa a
 * unidade, vale a comparação numérica ("30x30" ≈ "30x30mm").
 */
function compareDimensions(requested: string, product: string): AttributeVerdict {
  const parse = (value: string) => {
    const match = /^([\d.x]+?)(mm|cm)?$/.exec(value);
    if (!match?.[1]) return null;
    const numbers = match[1].split("x").map(Number);
    if (numbers.some((number) => !Number.isFinite(number))) return null;
    return { numbers, unit: match[2] ?? null };
  };
  const a = parse(requested);
  const b = parse(product);
  if (!a || !b) return requested === product ? "MATCH" : "MISMATCH";
  if (a.numbers.length !== b.numbers.length) return "MISMATCH";
  const scale = (side: { numbers: number[]; unit: string | null }, convert: boolean) =>
    [...side.numbers].map((number) => (convert && side.unit === "cm" ? number * 10 : number)).sort((x, y) => x - y);
  const convert = a.unit !== null && b.unit !== null;
  const left = scale(a, convert);
  const right = scale(b, convert);
  return left.every((value, index) => numbersEqual(value, right[index] ?? Number.NaN)) ? "MATCH" : "MISMATCH";
}

function compareMaterials(requested: string[], product: string[]): AttributeVerdict {
  const byRole = (values: string[]) => {
    const roles = new Map<string, Set<string>>();
    for (const value of values) {
      const role = MATERIAL_ROLES[value] ?? "corpo";
      if (!roles.has(role)) roles.set(role, new Set());
      roles.get(role)?.add(value);
    }
    return roles;
  };
  const requestedRoles = byRole(requested);
  const productRoles = byRole(product);

  let compared = false;
  for (const [role, requestedValues] of requestedRoles) {
    const productValues = productRoles.get(role);
    if (!productValues) continue;
    compared = true;
    const intersects = [...requestedValues].some((value) => productValues.has(value));
    if (!intersects) return "MISMATCH";
  }
  return compared ? "MATCH" : "UNKNOWN";
}

function compareValue(key: AttributeKey, requested: AttributeValue, product: AttributeValue): AttributeVerdict {
  const definition = ATTRIBUTE_DEFINITIONS[key];

  if (key === "diametro") return compareDiameter(String(requested), String(product));
  if (key === "dimensoes") return compareDimensions(String(requested), String(product));
  if (key === "material") return compareMaterials(asTexts(requested), asTexts(product));

  switch (definition.kind) {
    case "number": {
      const [a] = asNumbers(requested);
      const [b] = asNumbers(product);
      if (a === undefined || b === undefined) return "UNKNOWN";
      return numbersEqual(a, b, definition.tolerance) ? "MATCH" : "MISMATCH";
    }
    case "numberSet": {
      // Todo valor solicitado precisa ser atendido pelo produto (ex.: bivolt exige 127 e 220).
      const requestedValues = asNumbers(requested);
      const productValues = asNumbers(product);
      if (requestedValues.length === 0 || productValues.length === 0) return "UNKNOWN";
      const covered = requestedValues.every((value) => productValues.some((candidate) => numbersEqual(value, candidate)));
      return covered ? "MATCH" : "MISMATCH";
    }
    case "text":
      return String(requested).toLowerCase() === String(product).toLowerCase() ? "MATCH" : "MISMATCH";
    case "textSet": {
      const productValues = new Set(asTexts(product).map((value) => value.toLowerCase()));
      const intersects = asTexts(requested).some((value) => productValues.has(value.toLowerCase()));
      return intersects ? "MATCH" : "MISMATCH";
    }
  }
}

/** Relé térmico: corrente solicitada dentro da faixa de ajuste do produto. */
function currentWithinRange(requested: TechnicalAttributes, product: TechnicalAttributes): AttributeVerdict | null {
  if (typeof requested.corrente_a !== "number" || typeof product.faixa_ajuste_a !== "string") return null;
  const range = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(product.faixa_ajuste_a);
  if (!range) return null;
  const low = Number(range[1]);
  const high = Number(range[2]);
  return requested.corrente_a >= low && requested.corrente_a <= high ? "MATCH" : "MISMATCH";
}

export function compareAttributes(requested: TechnicalAttributes, product: TechnicalAttributes): ComparisonSummary {
  const comparisons: AttributeComparison[] = [];

  for (const definition of ATTRIBUTE_LIST) {
    const requestedValue = requested[definition.key];
    if (requestedValue === undefined) continue;
    const productValue = product[definition.key];

    let verdict: AttributeVerdict;
    let productText: string | null = null;

    if (productValue !== undefined) {
      verdict = compareValue(definition.key, requestedValue, productValue);
      productText = formatAttributeValue(definition.key, productValue);
    } else if (definition.key === "corrente_a") {
      const withinRange = currentWithinRange(requested, product);
      verdict = withinRange ?? "UNKNOWN";
      if (withinRange && product.faixa_ajuste_a !== undefined) {
        productText = `faixa ${formatAttributeValue("faixa_ajuste_a", product.faixa_ajuste_a)}`;
      }
    } else {
      verdict = "UNKNOWN";
    }

    comparisons.push({
      key: definition.key,
      label: definition.label,
      critical: definition.critical,
      verdict,
      requested: formatAttributeValue(definition.key, requestedValue),
      product: productText,
    });
  }

  const matches = comparisons.filter((item) => item.verdict === "MATCH");
  const criticalMismatches = comparisons.filter((item) => item.verdict === "MISMATCH" && item.critical);
  const softMismatches = comparisons.filter((item) => item.verdict === "MISMATCH" && !item.critical);
  const unknownCritical = comparisons.filter((item) => item.verdict === "UNKNOWN" && item.critical);
  const unknownSoft = comparisons.filter((item) => item.verdict === "UNKNOWN" && !item.critical);

  return {
    comparisons,
    matches,
    criticalMismatches,
    softMismatches,
    unknownCritical,
    unknownSoft,
    compatible: criticalMismatches.length === 0,
  };
}
