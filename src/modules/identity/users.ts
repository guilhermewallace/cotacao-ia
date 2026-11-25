import { z } from "zod";
import type { MembershipRole } from "@/generated/prisma/enums";
import { recordAudit } from "@/modules/audit/audit";
import type { AuthIdentity } from "@/modules/identity/auth/types";
import { assertCan, canManageRole } from "@/modules/identity/permissions";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { getPrisma } from "@/platform/db";
import { ConflictError, ForbiddenError, isUniqueViolation, NotFoundError, ValidationError } from "@/platform/errors";
import { parseId } from "@/platform/ids";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  isDemo: boolean;
  role: MembershipRole;
}

/**
 * Converte a identidade autenticada no usuário da nossa base.
 *
 * Um usuário só existe aqui se foi convidado para alguma organização. No primeiro
 * acesso via Supabase, a conta é vinculada pelo e-mail — desde que o provedor
 * confirme que o e-mail foi verificado, para que ninguém assuma um convite alheio.
 */
export async function resolveUser(identity: AuthIdentity): Promise<SessionUser | null> {
  const prisma = getPrisma();
  const select = { id: true, email: true, name: true, isActive: true, authProviderId: true } as const;

  if (identity.userId) {
    const user = await prisma.user.findUnique({ where: { id: identity.userId }, select });
    return user?.isActive ? { id: user.id, email: user.email, name: user.name } : null;
  }
  if (!identity.providerUserId) return null;

  const linked = await prisma.user.findUnique({ where: { authProviderId: identity.providerUserId }, select });
  if (linked) return linked.isActive ? { id: linked.id, email: linked.email, name: linked.name } : null;

  if (!identity.emailVerified) return null;
  const invited = await prisma.user.findUnique({ where: { email: identity.email.toLowerCase() }, select });
  if (!invited || !invited.isActive || invited.authProviderId) return null;

  await prisma.user.update({ where: { id: invited.id }, data: { authProviderId: identity.providerUserId } });
  return { id: invited.id, email: invited.email, name: invited.name };
}

export async function listMemberships(userId: string): Promise<MembershipSummary[]> {
  const rows = await getPrisma().membership.findMany({
    where: { userId },
    select: { role: true, organization: { select: { id: true, name: true, slug: true, isDemo: true } } },
    orderBy: { organization: { name: "asc" } },
  });
  return rows.map((row) => ({
    organizationId: row.organization.id,
    organizationName: row.organization.name,
    organizationSlug: row.organization.slug,
    isDemo: row.organization.isDemo,
    role: row.role,
  }));
}

export async function recordLogin(userId: string): Promise<void> {
  await getPrisma().user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

// ───────────────────────────── Membros da organização ─────────────────────────────

export interface MemberView {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  lastLoginAt: Date | null;
  isSelf: boolean;
}

export async function listMembers(ctx: TenantContext): Promise<MemberView[]> {
  assertCan(ctx, "members:manage");
  const rows = await tenantDb(ctx.organizationId).membership.findMany({
    include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return rows.map((row) => ({
    membershipId: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    role: row.role,
    lastLoginAt: row.user.lastLoginAt,
    isSelf: row.userId === ctx.userId,
  }));
}

const roleSchema = z.enum(["OWNER", "ADMIN", "SELLER", "VIEWER"]);

export const memberInputSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome").max(120),
  email: z.email("E-mail inválido").max(200),
  role: roleSchema,
});

/**
 * Adiciona um membro à organização. Se a pessoa ainda não tem conta, o registro é
 * criado e será vinculado ao login (mesmo e-mail) no primeiro acesso.
 */
export async function addMember(ctx: TenantContext, input: z.input<typeof memberInputSchema>): Promise<void> {
  assertCan(ctx, "members:manage");
  const data = memberInputSchema.parse(input);
  if (!canManageRole(ctx.role, null, data.role)) throw new ForbiddenError("Somente proprietários podem conceder o papel de proprietário.");
  const email = data.email.trim().toLowerCase();
  const prisma = getPrisma();

  try {
    await prisma.$transaction(async (tx) => {
      const user = (await tx.user.findUnique({ where: { email }, select: { id: true } })) ?? (await tx.user.create({ data: { email, name: data.name }, select: { id: true } }));
      const membership = await tx.membership.create({ data: { organizationId: ctx.organizationId, userId: user.id, role: data.role } });
      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          actorType: ctx.actorType,
          actorUserId: ctx.userId,
          action: "member.add",
          entityType: "Membership",
          entityId: membership.id,
          metadata: { email, role: data.role },
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Esta pessoa já é membro da organização.");
    throw error;
  }
}

async function assertNotLastOwner(ctx: TenantContext, membershipId: string): Promise<void> {
  const owners = await tenantDb(ctx.organizationId).membership.findMany({ where: { role: "OWNER" }, select: { id: true } });
  if (owners.length === 1 && owners[0]?.id === membershipId) {
    throw new ValidationError("A organização precisa de ao menos um proprietário.");
  }
}

export async function updateMemberRole(ctx: TenantContext, membershipId: string, role: MembershipRole): Promise<void> {
  assertCan(ctx, "members:manage");
  const id = parseId(membershipId, "Membro");
  const newRole = roleSchema.parse(role);
  const db = tenantDb(ctx.organizationId);

  const membership = await db.membership.findUnique({ where: { id }, select: { role: true } });
  if (!membership) throw new NotFoundError("Membro");
  if (!canManageRole(ctx.role, membership.role, newRole)) throw new ForbiddenError("Somente proprietários podem alterar o papel de proprietários.");
  if (membership.role === "OWNER" && newRole !== "OWNER") await assertNotLastOwner(ctx, id);

  await db.$transaction(async (tx) => {
    await tx.membership.update({ where: { id }, data: { role: newRole } });
    await recordAudit(ctx, { action: "member.role_change", entityType: "Membership", entityId: id, metadata: { before: membership.role, after: newRole } }, tx);
  });
}

export async function removeMember(ctx: TenantContext, membershipId: string): Promise<void> {
  assertCan(ctx, "members:manage");
  const id = parseId(membershipId, "Membro");
  const db = tenantDb(ctx.organizationId);

  const membership = await db.membership.findUnique({ where: { id }, select: { role: true, userId: true } });
  if (!membership) throw new NotFoundError("Membro");
  if (!canManageRole(ctx.role, membership.role, null)) throw new ForbiddenError("Somente proprietários podem remover proprietários.");
  if (membership.role === "OWNER") await assertNotLastOwner(ctx, id);

  await db.$transaction(async (tx) => {
    await tx.membership.delete({ where: { id } });
    await recordAudit(ctx, { action: "member.remove", entityType: "Membership", entityId: id, metadata: { userId: membership.userId } }, tx);
  });
}
