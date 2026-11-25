import type { MembershipRole } from "@/generated/prisma/enums";
import { parseId } from "@/platform/ids";

/**
 * Contexto de tenant: quem está agindo e em nome de qual organização.
 * É sempre resolvido no servidor (sessão, webhook ou job) — nunca aceito do cliente.
 */
export interface TenantContext {
  readonly organizationId: string;
  readonly actorType: "USER" | "SYSTEM" | "WEBHOOK";
  /** Nulo para atores de sistema (workers, webhooks). */
  readonly userId: string | null;
  /** Papel do usuário na organização. Atores de sistema não têm papel. */
  readonly role: MembershipRole | null;
  readonly request?: { ipAddress?: string | null; userAgent?: string | null };
}

export function userContext(input: {
  organizationId: string;
  userId: string;
  role: MembershipRole;
  request?: TenantContext["request"];
}): TenantContext {
  return {
    organizationId: parseId(input.organizationId, "Organização"),
    actorType: "USER",
    userId: input.userId,
    role: input.role,
    request: input.request,
  };
}

/** Contexto para workers e rotinas internas, sempre restrito a UMA organização. */
export function systemContext(organizationId: string): TenantContext {
  return { organizationId: parseId(organizationId, "Organização"), actorType: "SYSTEM", userId: null, role: null };
}

/** Contexto para eventos recebidos por webhook já autenticado e roteado. */
export function webhookContext(organizationId: string): TenantContext {
  return { organizationId: parseId(organizationId, "Organização"), actorType: "WEBHOOK", userId: null, role: null };
}
