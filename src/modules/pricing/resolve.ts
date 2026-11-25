import type { Prisma } from "@/generated/prisma/client";
import type { PriceSource } from "@/generated/prisma/enums";
import type { TenantDbOrTx } from "@/modules/tenancy/tenant-db";

/**
 * Resolução de preços.
 *
 * Os preços vêm EXCLUSIVAMENTE do catálogo da organização, nesta ordem:
 *   1. lista de preços do cliente (ativa e vigente);
 *   2. lista de preços padrão da organização (ativa e vigente);
 *   3. preço base do produto no catálogo.
 * Sem preço em nenhuma fonte, o resultado é `null` e o vendedor informa o valor
 * manualmente (registrado como MANUAL). A IA nunca participa deste cálculo.
 */

export interface ResolvedPrice {
  unitPrice: Prisma.Decimal | null;
  source: PriceSource | null;
  priceListId: string | null;
  priceListName: string | null;
}

const NO_PRICE: ResolvedPrice = { unitPrice: null, source: null, priceListId: null, priceListName: null };

function isInForce(list: { isActive: boolean; validFrom: Date | null; validUntil: Date | null }, date: Date): boolean {
  if (!list.isActive) return false;
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (list.validFrom && list.validFrom > day) return false;
  if (list.validUntil && list.validUntil < day) return false;
  return true;
}

export async function resolvePrices(
  db: TenantDbOrTx,
  productIds: string[],
  options: { customerId?: string | null; date?: Date } = {},
): Promise<Map<string, ResolvedPrice>> {
  const result = new Map<string, ResolvedPrice>();
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return result;
  const date = options.date ?? new Date();

  // Consultas em sequência: `db` pode ser uma transação, que usa uma única conexão.
  const customer = options.customerId
    ? await db.customer.findUnique({
        where: { id: options.customerId },
        select: { priceList: { select: { id: true, name: true, isActive: true, validFrom: true, validUntil: true } } },
      })
    : null;
  const defaultList = await db.priceList.findFirst({ where: { isDefault: true }, select: { id: true, name: true, isActive: true, validFrom: true, validUntil: true } });
  const products = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, price: true } });

  // Listas aplicáveis em ordem de precedência.
  const lists = [customer?.priceList, defaultList].filter(
    (list): list is NonNullable<typeof list> => Boolean(list) && isInForce(list as NonNullable<typeof list>, date),
  );
  const uniqueLists = lists.filter((list, index) => lists.findIndex((other) => other.id === list.id) === index);

  const listItems = uniqueLists.length
    ? await db.priceListItem.findMany({
        where: { priceListId: { in: uniqueLists.map((list) => list.id) }, productId: { in: ids } },
        select: { priceListId: true, productId: true, unitPrice: true },
      })
    : [];

  for (const product of products) {
    let resolved: ResolvedPrice = NO_PRICE;
    for (const list of uniqueLists) {
      const item = listItems.find((entry) => entry.priceListId === list.id && entry.productId === product.id);
      if (item) {
        resolved = { unitPrice: item.unitPrice, source: "PRICE_LIST", priceListId: list.id, priceListName: list.name };
        break;
      }
    }
    if (!resolved.unitPrice && product.price) {
      resolved = { unitPrice: product.price, source: "CATALOG", priceListId: null, priceListName: null };
    }
    result.set(product.id, resolved);
  }
  return result;
}

export async function resolvePrice(db: TenantDbOrTx, productId: string, options: { customerId?: string | null; date?: Date } = {}): Promise<ResolvedPrice> {
  const prices = await resolvePrices(db, [productId], options);
  return prices.get(productId) ?? NO_PRICE;
}
