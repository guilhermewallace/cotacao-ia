import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/platform/db";
import { parseId } from "@/platform/ids";

/**
 * Cliente Prisma com escopo de organização.
 *
 * Toda operação em modelos de tenant recebe `organization_id` automaticamente:
 * leituras e escritas são filtradas, criações são carimbadas e nenhuma atualização
 * consegue mover um registro para outra organização. É a segunda camada de defesa;
 * a primeira são as chaves estrangeiras compostas (organization_id, id) no banco.
 *
 * Consultas SQL brutas (`$queryRaw`) NÃO passam por aqui e devem filtrar
 * `organization_id` explicitamente.
 */

/** Modelos que pertencem a uma organização (possuem `organizationId`). */
export const TENANT_MODELS: ReadonlySet<Prisma.ModelName> = new Set<Prisma.ModelName>([
  "Membership",
  "Customer",
  "Product",
  "ProductAlias",
  "PriceList",
  "PriceListItem",
  "Integration",
  "InboundMessage",
  "Attachment",
  "ChannelEvent",
  "QuotationRequest",
  "RequestedItem",
  "ProductMatch",
  "Quotation",
  "QuotationItem",
  "ProcessingJob",
  "AuditLog",
]);

type Args = Record<string, unknown>;

function withOrganization(where: unknown, organizationId: string): Args {
  return { ...((where as Args | undefined) ?? {}), organizationId };
}

function stampData(data: unknown, organizationId: string): Args {
  return { ...((data as Args | undefined) ?? {}), organizationId };
}

function withoutOrganization(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const { organizationId: _ignored, organization: _relation, ...rest } = data as Args;
  return rest;
}

export function scopeOperationArgs(operation: string, rawArgs: unknown, organizationId: string): Args {
  const args: Args = { ...((rawArgs as Args | undefined) ?? {}) };

  switch (operation) {
    case "findUnique":
    case "findUniqueOrThrow":
    case "findFirst":
    case "findFirstOrThrow":
    case "findMany":
    case "count":
    case "aggregate":
    case "groupBy":
    case "delete":
    case "deleteMany":
      args.where = withOrganization(args.where, organizationId);
      return args;

    case "update":
    case "updateMany":
    case "updateManyAndReturn":
      args.where = withOrganization(args.where, organizationId);
      args.data = withoutOrganization(args.data);
      return args;

    case "create":
      args.data = stampData(args.data, organizationId);
      return args;

    case "createMany":
    case "createManyAndReturn": {
      const rows = Array.isArray(args.data) ? args.data : [args.data];
      args.data = rows.map((row) => stampData(row, organizationId));
      return args;
    }

    case "upsert":
      args.where = withOrganization(args.where, organizationId);
      args.create = stampData(args.create, organizationId);
      args.update = withoutOrganization(args.update);
      return args;

    default:
      // Falha fechada: uma operação desconhecida nunca roda sem escopo.
      throw new Error(`Operação "${operation}" não é suportada pelo cliente com escopo de organização.`);
  }
}

function createTenantClient(organizationId: string) {
  return getPrisma().$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model as Prisma.ModelName)) {
            return query(args);
          }
          return query(scopeOperationArgs(operation, args, organizationId) as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof createTenantClient>;

/** Cliente de transação obtido dentro de `tenantDb(...).$transaction(async (tx) => ...)`. */
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

/** Aceita tanto o cliente quanto uma transação já aberta. */
export type TenantDbOrTx = TenantDb | TenantTx;

export function tenantDb(organizationId: string): TenantDb {
  return createTenantClient(parseId(organizationId, "Organização"));
}
