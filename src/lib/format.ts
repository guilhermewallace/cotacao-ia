/**
 * Formatação pt-BR para a interface. Funções puras, seguras em Server e Client Components
 * (locale e fuso sempre explícitos, sem divergência de hidratação).
 */

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const currencyPrecise = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

export function formatCurrency(value: string | number | null | undefined, options: { precise?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return (options.precise ? currencyPrecise : currency).format(number);
}

export function formatInteger(value: number): string {
  return integer.format(value);
}

export function formatQuantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? decimal.format(number) : "—";
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return percent.format(value);
}

/** Converte o que o usuário digitou ("1.234,56", "12,5", "12.5") em número; `null` se vazio; `NaN` se inválido. */
export function parseDecimalInput(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (text === "") return null;
  if (!/^\d[\d.,]*$/.test(text)) return Number.NaN;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text;
  return Number(normalized);
}

/** Número em formato de campo de formulário pt-BR ("12,5"). */
export function toDecimalInput(value: string | number | null | undefined, maximumFractionDigits = 4, minimumFractionDigits = 0): string {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: Math.min(minimumFractionDigits, maximumFractionDigits), maximumFractionDigits, useGrouping: false }).format(number);
}

export function formatTaxId(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return value;
}

export function formatPhone(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  const match = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return match ? `+55 (${match[1]}) ${match[2]}-${match[3]}` : value;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${formatInteger(count)} ${count === 1 ? singular : plural}`;
}
