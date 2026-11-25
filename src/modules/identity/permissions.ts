import type { MembershipRole } from "@/generated/prisma/enums";
import type { TenantContext } from "@/modules/tenancy/context";
import { ForbiddenError } from "@/platform/errors";

/**
 * Papéis e permissões básicas. A verificação acontece sempre no backend
 * (serviços e rotas); a interface apenas esconde o que o usuário não pode fazer.
 */

export const PERMISSIONS = [
  "dashboard:read",
  "inbox:read",
  "inbox:upload",
  "request:review",
  "catalog:read",
  "catalog:write",
  "catalog:import",
  "customer:read",
  "customer:write",
  "quotation:read",
  "quotation:write",
  "quotation:finalize",
  "settings:manage",
  "members:manage",
  "integrations:manage",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = ["dashboard:read", "inbox:read", "catalog:read", "customer:read", "quotation:read"];

const SELLER: Permission[] = [
  ...VIEWER,
  "inbox:upload",
  "request:review",
  "customer:write",
  "quotation:write",
  "quotation:finalize",
];

const ADMIN: Permission[] = [
  ...SELLER,
  "catalog:write",
  "catalog:import",
  "settings:manage",
  "members:manage",
  "integrations:manage",
  "audit:read",
];

const ROLE_PERMISSIONS: Record<MembershipRole, ReadonlySet<Permission>> = {
  VIEWER: new Set(VIEWER),
  SELLER: new Set(SELLER),
  ADMIN: new Set(ADMIN),
  OWNER: new Set(ADMIN),
};

export const ROLE_LABELS: Record<MembershipRole, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  SELLER: "Vendedor",
  VIEWER: "Leitura",
};

export const ROLE_DESCRIPTIONS: Record<MembershipRole, string> = {
  OWNER: "Acesso total, incluindo a gestão de outros proprietários.",
  ADMIN: "Gerencia catálogo, integrações, membros e configurações.",
  SELLER: "Revisa solicitações e cria cotações.",
  VIEWER: "Apenas consulta.",
};

export function roleCan(role: MembershipRole | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * Permissões são sempre de USUÁRIOS com papel na organização.
 *
 * Atores de sistema (workers, webhooks autenticados) executam apenas rotinas internas —
 * ingestão e pipeline — que não passam por `assertCan`. Por menor privilégio, eles NÃO
 * recebem permissões de usuário: um contexto de sistema não consegue, por exemplo,
 * alterar o catálogo ou ler a auditoria, mesmo que algum código o tente por engano.
 */
export function can(ctx: TenantContext, permission: Permission): boolean {
  if (ctx.actorType !== "USER") return false;
  return roleCan(ctx.role, permission);
}

export function assertCan(ctx: TenantContext, permission: Permission): void {
  if (!can(ctx, permission)) {
    throw new ForbiddenError();
  }
}

/** Regras de quem pode alterar o papel de quem. */
export function canManageRole(actorRole: MembershipRole | null, targetCurrentRole: MembershipRole | null, newRole: MembershipRole | null): boolean {
  if (!actorRole || !roleCan(actorRole, "members:manage")) return false;
  const touchesOwner = targetCurrentRole === "OWNER" || newRole === "OWNER";
  return touchesOwner ? actorRole === "OWNER" : true;
}
