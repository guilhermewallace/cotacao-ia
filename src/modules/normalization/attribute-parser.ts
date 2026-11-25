import { sanitizeAttributes, type TechnicalAttributes } from "@/modules/normalization/attributes";
import { normalizeText } from "@/modules/normalization/text";

/**
 * Parser determinístico de atributos técnicos a partir de texto livre.
 *
 * Opera sobre o texto normalizado (ver `normalizeText`), no qual a unidade já está
 * colada ao número ("32a", "2.5mm2", "3/4pol"). Cada trecho reconhecido é consumido,
 * para que padrões genéricos não reinterpretem o que um padrão específico já leu.
 * Quando um valor não aparece no texto, o atributo simplesmente não é emitido.
 */

const NUMBER = "\\d+(?:\\.\\d+)?";
/** Não pode haver letra, dígito, ponto ou barra imediatamente antes do número. */
const START = "(?<![a-z0-9./])";

const STANDARD_SECTIONS = new Set([0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300]);
const METRIC_THREADS = new Set([5, 6, 8, 10, 12, 16, 18, 20, 22, 25, 30, 32, 40, 50, 63]);

const CABLE_CONTEXT = /\b(cabo|cabos|fio|fios|cordao|condutor|terminal|terminais|ilhos)\b/;
const DEVICE_CONTEXT = /\b(disjuntor|idr|ddr|dr|dps|seccionadora|chave|contator|interruptor diferencial|minidisjuntor)\b/;
const BREAKER_CONTEXT = /\b(disjuntor|minidisjuntor|ddr)\b/;
const DIAMETER_CONTEXT =
  /\b(eletroduto|tubo|mangueira|luva|bucha|arruela|prensa|botao|botoeira|sinaleiro|sinalizador|diametro|furo|curva 90|curva 45|condulete|box)\b/;

/** Materiais agrupados por papel: só se comparam materiais do mesmo papel. */
export const MATERIAL_ROLES: Record<string, "condutor" | "corpo"> = {
  cobre: "condutor",
  aluminio: "condutor",
  latao: "condutor",
  bronze: "condutor",
  pvc: "corpo",
  aco: "corpo",
  "aco galvanizado": "corpo",
  "aco inox": "corpo",
  "aco carbono": "corpo",
  "ferro fundido": "corpo",
  nylon: "corpo",
  polietileno: "corpo",
  polipropileno: "corpo",
  policarbonato: "corpo",
  termoplastico: "corpo",
  borracha: "corpo",
  silicone: "corpo",
  ceramica: "corpo",
  zamac: "corpo",
};

const MATERIAL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(aco )?inox(idavel)?\b/, "aco inox"],
  [/\b(aco )?galvanizad[oa]s?\b/, "aco galvanizado"],
  [/\baco carbono\b/, "aco carbono"],
  [/\bferro fundido\b/, "ferro fundido"],
  [/\bcobre\b/, "cobre"],
  [/\baluminio\b/, "aluminio"],
  [/\blatao\b/, "latao"],
  [/\bbronze\b/, "bronze"],
  [/\bpvc\b/, "pvc"],
  [/\b(nylon|nailon|poliamida)\b/, "nylon"],
  [/\b(polietileno|pead)\b/, "polietileno"],
  [/\bpolipropileno\b/, "polipropileno"],
  [/\bpolicarbonato\b/, "policarbonato"],
  [/\btermoplastic[oa]\b/, "termoplastico"],
  [/\bborracha\b/, "borracha"],
  [/\bsilicone\b/, "silicone"],
  [/\b(ceramica|porcelana)\b/, "ceramica"],
  [/\bzamac\b/, "zamac"],
];

const COLOR_PATTERNS: Array<[RegExp, string]> = [
  [/\bverde[\s/-]+amarel[oa]\b/, "verde-amarelo"],
  [/\bpret[oa]s?\b/, "preto"],
  [/\bbranc[oa]s?\b/, "branco"],
  [/\bazul\b|\bazuis\b/, "azul"],
  [/\bvermelh[oa]s?\b/, "vermelho"],
  [/\bverdes?\b/, "verde"],
  [/\bamarel[oa]s?\b/, "amarelo"],
  [/\bcinzas?\b/, "cinza"],
  [/\bmarrom\b|\bmarrons\b/, "marrom"],
  [/\blaranjas?\b/, "laranja"],
  [/\b(violeta|rox[oa])s?\b/, "violeta"],
  [/\b(transparente|incolor)\b/, "transparente"],
];

class Scanner {
  constructor(public text: string) {}

  /** Retorna todas as ocorrências e as apaga do texto de trabalho. */
  take(pattern: RegExp): RegExpExecArray[] {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const regex = new RegExp(pattern.source, flags);
    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(this.text)) !== null) {
      matches.push(match);
      if (match[0].length === 0) regex.lastIndex += 1;
    }
    for (const found of matches) {
      this.text = this.text.slice(0, found.index) + " ".repeat(found[0].length) + this.text.slice(found.index + found[0].length);
    }
    return matches;
  }

  has(pattern: RegExp): boolean {
    return pattern.test(this.text);
  }
}

/** Agrupa tensões nominais equivalentes na prática (110/115/127 → 127; 220/230/240 → 220...). */
export function canonicalVoltage(volts: number): number {
  if (volts >= 100 && volts <= 130) return 127;
  if (volts >= 200 && volts <= 240) return 220;
  if (volts >= 370 && volts <= 415) return 380;
  if (volts >= 430 && volts <= 480) return 440;
  return volts;
}

/** "3/4" → 0.75 · "1 1/2" → 1.5 · "1.1/2" → 1.5 · "2" → 2. Retorna `null` se não for uma medida válida. */
export function parseFractional(raw: string): number | null {
  const text = raw.trim();
  const mixed = /^(\d+)[ .](\d+)\/(\d+)$/.exec(text);
  if (mixed) {
    const [, whole, numerator, denominator] = mixed;
    const den = Number(denominator);
    return den === 0 ? null : Number(whole) + Number(numerator) / den;
  }
  const fraction = /^(\d+)\/(\d+)$/.exec(text);
  if (fraction) {
    const den = Number(fraction[2]);
    return den === 0 ? null : Number(fraction[1]) / den;
  }
  const plain = /^\d+(?:\.\d+)?$/.exec(text);
  return plain ? Number(text) : null;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function parseAttributes(input: string | null | undefined): TechnicalAttributes {
  const normalized = normalizeText(input);
  if (!normalized) return {};

  const scanner = new Scanner(normalized);
  const attributes: TechnicalAttributes = {};
  const isCable = CABLE_CONTEXT.test(normalized);
  const isDevice = DEVICE_CONTEXT.test(normalized);
  const isBreaker = BREAKER_CONTEXT.test(normalized);

  // ── Tensão ────────────────────────────────────────────────────────────────
  const voltages: number[] = [];
  for (const match of scanner.take(new RegExp(`${START}(${NUMBER}(?:/${NUMBER})*)kv\\b`))) {
    const values = (match[1] ?? "").split("/").map(Number);
    voltages.push(Math.max(...values) * 1000);
  }
  for (const match of scanner.take(new RegExp(`${START}(\\d{1,4}(?:/\\d{1,4})*)v(cc|dc|ca|ac)?\\b`))) {
    for (const value of (match[1] ?? "").split("/")) voltages.push(Number(value));
    const suffix = match[2];
    if (suffix) attributes.tipo_tensao = suffix === "cc" || suffix === "dc" ? "cc" : "ca";
  }
  if (voltages.length === 0 && scanner.take(/\bbivolt\b/).length > 0) {
    voltages.push(127, 220);
  }
  if (voltages.length > 0) {
    attributes.tensao_v = unique(voltages.filter((v) => v > 0).map(canonicalVoltage)).sort((a, b) => a - b);
  }

  // ── Grandezas com unidade composta (antes de "a", "w" e "m" simples) ─────────
  const residual = scanner.take(new RegExp(`${START}(${NUMBER})ma\\b`));
  if (residual[0]?.[1]) attributes.corrente_residual_ma = Number(residual[0][1]);

  const breaking = scanner.take(new RegExp(`${START}(${NUMBER})ka\\b`));
  if (breaking[0]?.[1]) attributes.capacidade_interrupcao_ka = Number(breaking[0][1]);

  const kva = scanner.take(new RegExp(`${START}(${NUMBER})kva\\b`));
  const va = scanner.take(new RegExp(`${START}(${NUMBER})va\\b`));
  if (kva[0]?.[1]) attributes.potencia_va = round(Number(kva[0][1]) * 1000);
  else if (va[0]?.[1]) attributes.potencia_va = Number(va[0][1]);

  const fractionalPower = `((?:\\d+[ .])?\\d+/\\d+|${NUMBER})`;
  const kw = scanner.take(new RegExp(`${START}(${NUMBER})kw\\b`));
  const cv = scanner.take(new RegExp(`${START}${fractionalPower}cv\\b`));
  const hp = scanner.take(new RegExp(`${START}${fractionalPower}hp\\b`));
  const watts = scanner.take(new RegExp(`${START}(${NUMBER})w\\b`));
  if (kw[0]?.[1]) {
    attributes.potencia_w = round(Number(kw[0][1]) * 1000);
  } else if (cv[0]?.[1]) {
    const value = parseFractional(cv[0][1]);
    if (value) attributes.potencia_w = round(value * 735.5, 1);
  } else if (hp[0]?.[1]) {
    const value = parseFractional(hp[0][1]);
    if (value) attributes.potencia_w = round(value * 745.7, 1);
  } else if (watts[0]?.[1]) {
    attributes.potencia_w = Number(watts[0][1]);
  }

  const frequency = scanner.take(new RegExp(`${START}(\\d{2,3}(?:/\\d{2,3})?)hz\\b`));
  if (frequency[0]?.[1]) {
    attributes.frequencia_hz = unique(frequency[0][1].split("/").map(Number)).sort((a, b) => a - b);
  }

  const kelvin = scanner.take(/(?<![a-z0-9.])(\d{4})k\b/);
  if (kelvin[0]?.[1]) {
    const value = Number(kelvin[0][1]);
    if (value >= 1800 && value <= 10000) attributes.temperatura_cor_k = value;
  }

  const protection = scanner.take(/\bip ?(\d{2})\b/);
  if (protection[0]?.[1]) attributes.grau_protecao = `ip${protection[0][1]}`;

  // ── Bitola e número de condutores ─────────────────────────────────────────
  const multiCore = scanner.take(new RegExp(`${START}(\\d{1,2})x(${NUMBER})mm2\\b`));
  if (multiCore[0]) {
    attributes.condutores = Number(multiCore[0][1]);
    attributes.secao_mm2 = Number(multiCore[0][2]);
  }
  const section = scanner.take(new RegExp(`(?<![a-z0-9.x/])(${NUMBER})mm2\\b`));
  if (section[0]?.[1] && attributes.secao_mm2 === undefined) attributes.secao_mm2 = Number(section[0][1]);

  if (isCable && attributes.secao_mm2 === undefined) {
    // Em cabos e terminais é comum escrever "2,5mm" querendo dizer 2,5 mm².
    const multiCoreLoose = scanner.take(new RegExp(`${START}(\\d{1,2})x(${NUMBER})(?:mm)?\\b`));
    const looseCore = multiCoreLoose.find((match) => STANDARD_SECTIONS.has(Number(match[2])));
    if (looseCore) {
      attributes.condutores = Number(looseCore[1]);
      attributes.secao_mm2 = Number(looseCore[2]);
    } else {
      const loose = scanner.take(new RegExp(`(?<![a-z0-9.x/])(${NUMBER})mm\\b`));
      const standard = loose.find((match) => STANDARD_SECTIONS.has(Number(match[1])));
      if (standard?.[1]) {
        attributes.secao_mm2 = Number(standard[1]);
      } else {
        // Sem unidade, apenas valores inequívocos de bitola (não confundíveis com quantidade).
        const bare = scanner.take(/(?<![a-z0-9.x/])(0\.5|0\.75|1\.5|2\.5)(?![a-z0-9./])/);
        if (bare[0]?.[1]) attributes.secao_mm2 = Number(bare[0][1]);
      }
    }
  }

  // ── Disjuntores: "3x32a" e abreviação "c32" ──────────────────────────────────
  if (isDevice) {
    const polesTimesCurrent = scanner.take(new RegExp(`${START}([1-4])x(${NUMBER})a\\b`));
    if (polesTimesCurrent[0]) {
      attributes.polos = Number(polesTimesCurrent[0][1]);
      attributes.corrente_a = Number(polesTimesCurrent[0][2]);
    }
  }

  const curve = scanner.take(/\bcurva ([bcd])\b/);
  if (curve[0]?.[1]) attributes.curva = curve[0][1];
  if (isBreaker) {
    const shorthand = scanner.take(/(?<![a-z0-9./-])([bcd])(\d{1,3})(?![a-z0-9./])/);
    if (shorthand[0]) {
      attributes.curva ??= shorthand[0][1];
      attributes.corrente_a ??= Number(shorthand[0][2]);
    }
    if (attributes.curva === undefined) {
      // "3x40a c" ou "c 40a": letra de curva isolada, vizinha da corrente.
      const adjacent = new RegExp(`${NUMBER}a ([bcd])\\b|\\b([bcd]) ${NUMBER}a\\b`).exec(normalized);
      const letter = adjacent?.[1] ?? adjacent?.[2];
      if (letter) attributes.curva = letter;
    }
  }

  // ── Corrente (faixa de ajuste antes do valor único) ───────────────────────
  const range = scanner.take(new RegExp(`${START}(${NUMBER})\\s?(?:-|a|ate)\\s?(${NUMBER})a\\b`));
  if (range[0]) {
    const low = Number(range[0][1]);
    const high = Number(range[0][2]);
    if (low < high) attributes.faixa_ajuste_a = `${low}-${high}`;
  }
  const currents = scanner.take(new RegExp(`${START}(${NUMBER})a\\b`));
  if (currents[0]?.[1] && attributes.corrente_a === undefined && attributes.faixa_ajuste_a === undefined) {
    attributes.corrente_a = Number(currents[0][1]);
  }

  // ── Polos, configuração e fases ───────────────────────────────────────────
  const poles = scanner.take(/(?<![a-z0-9])([1-4])p((?:\+n)?(?:\+t)?)(?![a-z0-9])/);
  if (poles[0]) {
    const suffix = poles[0][2] ?? "";
    if (suffix) attributes.configuracao_polos = `${poles[0][1]}p${suffix}`;
    else attributes.polos ??= Number(poles[0][1]);
  }
  const phases = scanner.take(/\b(monofasic|bifasic|trifasic)[oa]s?\b/);
  if (phases[0]?.[1]) {
    const count = phases[0][1] === "monofasic" ? 1 : phases[0][1] === "bifasic" ? 2 : 3;
    // Em dispositivos de proteção e manobra, "trifásico" é usado como sinônimo de tripolar.
    if (isDevice && attributes.polos === undefined && attributes.configuracao_polos === undefined) attributes.polos = count;
    else if (!isDevice) attributes.fases = count;
  }

  // ── Sensores e contatos ───────────────────────────────────────────────────
  const output = scanner.take(/\b(pnp|npn)\b/);
  if (output[0]?.[1]) attributes.tipo_saida = output[0][1];

  const contacts = scanner.take(/(?<![a-z0-9])(\d)(na|nf)(?:\s?\+\s?(\d)(na|nf))?(?![a-z0-9])/);
  if (contacts[0]) {
    const [, count1, type1, count2, type2] = contacts[0];
    attributes.contatos = count2 && type2 ? `${count1}${type1}+${count2}${type2}` : `${count1}${type1}`;
  }

  // ── Rosca ────────────────────────────────────────────────────────────────
  const pipeThread = scanner.take(/\b(bspt|bsp|npt)\b/);
  const pgThread = scanner.take(new RegExp(`\\bpg ?(${NUMBER})\\b`));
  const metricThread = scanner.take(/(?<![a-z0-9])m(\d{1,2})(?:x\d(?:\.\d+)?)?(?![a-z0-9])/);
  const metric = metricThread.find((match) => METRIC_THREADS.has(Number(match[1])));
  if (pipeThread[0]?.[1]) attributes.rosca = pipeThread[0][1];
  else if (pgThread[0]?.[1]) attributes.rosca = `pg${pgThread[0][1]}`;
  else if (metric?.[1]) attributes.rosca = `m${metric[1]}`;

  // ── Diâmetro ─────────────────────────────────────────────────────────────
  const inches = scanner.take(/(?<![a-z0-9./])((?:\d+[ .])?\d+\/\d+|\d+(?:\.\d+)?)pol\b/);
  if (inches[0]?.[1]) {
    const value = parseFractional(inches[0][1]);
    if (value && value > 0 && value <= 12) attributes.diametro = `${round(value)}pol`;
  }
  const nominal = scanner.take(/\bdn ?(\d{1,3})\b/);
  if (nominal[0]?.[1] && attributes.diametro === undefined) attributes.diametro = `${Number(nominal[0][1])}mm`;
  if (attributes.diametro === undefined && DIAMETER_CONTEXT.test(normalized)) {
    // Em eletrodutos e conexões é comum omitir o símbolo de polegada: "eletroduto 3/4".
    const bareFraction = scanner.take(/(?<![a-z0-9./])((?:\d+[ .])?\d+\/\d+)(?![a-z0-9./])/);
    const value = bareFraction[0]?.[1] ? parseFractional(bareFraction[0][1]) : null;
    if (value && value > 0 && value <= 12) attributes.diametro = `${round(value)}pol`;
  }

  // ── Dimensões (LxA ou LxAxP) ──────────────────────────────────────────────
  const dimensions = scanner.take(new RegExp(`${START}(${NUMBER})x(${NUMBER})(?:x(${NUMBER}))?(mm|cm)?(?![a-z0-9.])`));
  if (dimensions[0]) {
    const [, a, b, c, unit] = dimensions[0];
    attributes.dimensoes = `${[a, b, c].filter(Boolean).join("x")}${unit ?? ""}`;
  }

  if (attributes.diametro === undefined && DIAMETER_CONTEXT.test(normalized)) {
    const millimeters = scanner.take(new RegExp(`(?<![a-z0-9.x/])(${NUMBER})mm\\b`));
    if (millimeters[0]?.[1]) attributes.diametro = `${Number(millimeters[0][1])}mm`;
  }

  // ── Comprimento ──────────────────────────────────────────────────────────
  const length = scanner.take(new RegExp(`${START}(${NUMBER})m\\b`));
  if (length[0]?.[1]) attributes.comprimento_m = Number(length[0][1]);

  // ── Material e cor (por palavra-chave) ────────────────────────────────────
  const materials: string[] = [];
  for (const [pattern, name] of MATERIAL_PATTERNS) {
    if (scanner.take(pattern).length > 0) materials.push(name);
  }
  if (materials.length === 0 && scanner.take(/\baco\b/).length > 0) materials.push("aco");
  if (materials.length > 0) attributes.material = unique(materials).sort();

  const colors: string[] = [];
  for (const [pattern, name] of COLOR_PATTERNS) {
    if (scanner.take(pattern).length > 0) colors.push(name);
  }
  if (colors.length > 0) attributes.cor = unique(colors).sort();

  return sanitizeAttributes(attributes);
}

/**
 * Combina atributos: valores explícitos (cadastro, IA validada) prevalecem sobre os
 * derivados do texto. Nenhum valor é criado além dos presentes nas duas fontes.
 */
export function mergeAttributes(derived: TechnicalAttributes, explicit: TechnicalAttributes): TechnicalAttributes {
  return sanitizeAttributes({ ...derived, ...explicit });
}
