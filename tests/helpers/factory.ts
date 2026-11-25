import { randomUUID } from "node:crypto";
import { buildDemoCatalog } from "@/demo/catalog";
import { seedCatalog } from "@/demo/seed";
import type { MembershipRole } from "@/generated/prisma/enums";
import { createOrganization } from "@/modules/identity/organizations";
import { waitForInlineJobs } from "@/modules/processing/queue";
import { userContext, type TenantContext } from "@/modules/tenancy/context";
import { getPrisma } from "@/platform/db";

/**
 * Fábricas para os testes de integração. Cada teste cria as suas próprias organizações
 * (com identificadores únicos), então os arquivos não interferem entre si.
 */

export interface TestOrganization {
  id: string;
  slug: string;
  owner: TenantContext;
  admin: TenantContext;
  seller: TenantContext;
  viewer: TenantContext;
  /** SKU → id dos produtos criados por `withDemoCatalog`. */
  products: Map<string, string>;
}

export async function createTestOrganization(label: string, options: { withDemoCatalog?: boolean } = {}): Promise<TestOrganization> {
  const suffix = randomUUID().slice(0, 8);
  const slug = `${label}-${suffix}`.toLowerCase();
  const prisma = getPrisma();
  const { organizationId, ownerId } = await createOrganization({ name: `${label} ${suffix}`, slug, ownerEmail: `dono-${suffix}@${label}.example`, ownerName: `Dono ${label}` });

  const member = async (role: MembershipRole): Promise<TenantContext> => {
    const user = await prisma.user.create({ data: { email: `${role.toLowerCase()}-${suffix}@${label}.example`, name: `${role} ${label}` } });
    await prisma.membership.create({ data: { organizationId, userId: user.id, role } });
    return userContext({ organizationId, userId: user.id, role });
  };

  const organization: TestOrganization = {
    id: organizationId,
    slug,
    owner: userContext({ organizationId, userId: ownerId, role: "OWNER" }),
    admin: await member("ADMIN"),
    seller: await member("SELLER"),
    viewer: await member("VIEWER"),
    products: new Map(),
  };
  if (options.withDemoCatalog) organization.products = await seedCatalog(organizationId, buildDemoCatalog());
  return organization;
}

/** ID de produto pelo SKU do catálogo de demonstração (falha cedo se o SKU não existir). */
export function productId(organization: TestOrganization, sku: string): string {
  const id = organization.products.get(sku);
  if (!id) throw new Error(`SKU ${sku} não existe no catálogo de teste`);
  return id;
}

/** Aguarda o término dos jobs da fila em linha disparados pelo teste. */
export async function settleJobs(): Promise<void> {
  await waitForInlineJobs();
}

/** Captura o erro de uma promessa que DEVE falhar. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("A operação deveria ter falhado, mas foi concluída.");
}
