/** Tipos e utilitários para `params` e `searchParams` das páginas (assíncronos no Next.js 16). */

export type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;

export interface SearchPageProps {
  searchParams: SearchParamsInput;
}

export interface IdPageProps {
  params: Promise<{ id: string }>;
  searchParams: SearchParamsInput;
}

/** Normaliza os parâmetros de busca: um valor por chave, sem strings vazias. */
export async function readSearchParams(input: SearchParamsInput): Promise<Record<string, string | undefined>> {
  const raw = await input;
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    const trimmed = first?.trim();
    if (trimmed) result[key] = trimmed.slice(0, 200);
  }
  return result;
}

export function pageNumber(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 && page < 100_000 ? page : 1;
}

/** Restringe um parâmetro de URL a um conjunto conhecido de valores. */
export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
