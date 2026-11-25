import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/platform/env";

/**
 * Cliente Prisma único por processo (web ou worker), criado sob demanda.
 *
 * ATENÇÃO: este cliente NÃO aplica escopo de organização. Código de negócio deve
 * usar `tenantDb(organizationId)` (src/modules/tenancy). O cliente global fica
 * restrito a: resolução de identidade, roteamento de webhooks e manutenção.
 */

const globalStore = globalThis as unknown as { __cotacaoPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!globalStore.__cotacaoPrisma) {
    const { DATABASE_URL, DATABASE_POOL_MAX } = env();
    const adapter = new PrismaPg({ connectionString: DATABASE_URL, max: DATABASE_POOL_MAX });
    globalStore.__cotacaoPrisma = new PrismaClient({ adapter });
  }
  return globalStore.__cotacaoPrisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});

export async function disconnectPrisma(): Promise<void> {
  if (globalStore.__cotacaoPrisma) {
    await globalStore.__cotacaoPrisma.$disconnect();
    globalStore.__cotacaoPrisma = undefined;
  }
}
