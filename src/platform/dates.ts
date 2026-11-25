/**
 * Datas e horas no fuso da operação. O produto atende distribuidoras no Brasil;
 * o fuso padrão é America/Sao_Paulo (ajustável por APP_TIMEZONE).
 * Formatação sempre com fuso explícito — o resultado não depende do servidor.
 */

export const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/Sao_Paulo";

/** Data local (AAAA-MM-DD) de um instante, no fuso da operação. */
export function localDateString(date: Date = new Date(), timeZone: string = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Converte "AAAA-MM-DD" em Date à meia-noite UTC — a representação de colunas DATE. */
export function dateOnly(isoDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`Data inválida: ${isoDate}`);
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Data inválida: ${isoDate}`);
  return date;
}

export function todayDateOnly(now: Date = new Date()): Date {
  return dateOnly(localDateString(now));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Colunas DATE: dd/mm/aaaa, lidas em UTC para não deslocar o dia. */
export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function toDateInputValue(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/** Instantes: dd/mm/aaaa hh:mm no fuso da operação. */
export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** "há 5 min", "há 3 h", "ontem", ou a data — relativo a `now`. */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const diffSeconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (diffSeconds < 60) return "agora há pouco";
  if (diffSeconds < 3600) return `há ${Math.floor(diffSeconds / 60)} min`;
  if (diffSeconds < 86_400 && localDateString(date) === localDateString(now)) return `há ${Math.floor(diffSeconds / 3600)} h`;
  if (localDateString(date) === localDateString(addDays(now, -1))) return "ontem";
  if (diffSeconds < 7 * 86_400) return `há ${Math.max(Math.floor(diffSeconds / 86_400), 2)} dias`;
  return formatDate(dateOnly(localDateString(date)));
}

/** Duração em linguagem natural: 42 s, 3 min 10 s, 1 h 05 min. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(Math.round(seconds), 0);
  if (total < 60) return `${total} s`;
  if (total < 3600) return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, "0")} s`;
  return `${Math.floor(total / 3600)} h ${String(Math.floor((total % 3600) / 60)).padStart(2, "0")} min`;
}
