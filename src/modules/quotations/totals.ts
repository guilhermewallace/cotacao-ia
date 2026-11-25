import { Prisma } from "@/generated/prisma/client";

/**
 * Cálculo de totais da cotação com aritmética decimal exata (sem ponto flutuante).
 *
 *   total da linha = arredonda2(quantidade × preço unitário × (1 − desconto do item %))
 *   subtotal       = soma dos totais das linhas disponíveis
 *   desconto       = arredonda2(subtotal × desconto geral %)
 *   total          = subtotal − desconto
 *
 * Arredondamento "meio para cima" em duas casas, como em documentos comerciais.
 */

export type DecimalInput = Prisma.Decimal | number | string;

export interface LineInput {
  quantity: DecimalInput;
  unitPrice: DecimalInput | null;
  discountPercent?: DecimalInput | null;
  /** Itens não atendidos constam da cotação, mas não somam. */
  available?: boolean;
}

export interface QuotationTotals {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

const HUNDRED = new Prisma.Decimal(100);

export function toDecimal(value: DecimalInput): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function computeLineTotal(line: LineInput): Prisma.Decimal {
  if (line.available === false || line.unitPrice === null) return new Prisma.Decimal(0);
  const discount = toDecimal(line.discountPercent ?? 0);
  const factor = HUNDRED.minus(discount).dividedBy(HUNDRED);
  return roundMoney(toDecimal(line.quantity).times(toDecimal(line.unitPrice)).times(factor));
}

export function computeTotals(lines: LineInput[], discountPercent: DecimalInput = 0): QuotationTotals {
  const subtotal = lines.reduce((sum, line) => sum.plus(computeLineTotal(line)), new Prisma.Decimal(0));
  const discountTotal = roundMoney(subtotal.times(toDecimal(discountPercent)).dividedBy(HUNDRED));
  return { subtotal, discountTotal, total: subtotal.minus(discountTotal) };
}

/** Número da cotação: COT-<ano>-<sequência com 5 dígitos>, sequencial por organização. */
export function formatQuotationNumber(sequence: number, date: Date): string {
  return `COT-${date.getUTCFullYear()}-${String(sequence).padStart(5, "0")}`;
}
