import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthProvider } from "@/modules/identity/auth";
import { can, type Permission } from "@/modules/identity/permissions";
import { listMemberships, resolveUser, type MembershipSummary, type SessionUser } from "@/modules/identity/users";
import { userContext, type TenantContext } from "@/modules/tenancy/context";
import { ForbiddenError, UnauthenticatedError } from "@/platform/errors";
import { isUuid } from "@/platform/ids";

/**
 * Sessão e contexto de tenant, sempre resolvidos no servidor.
 *
 * O navegador só guarda (a) o cookie de sessão do provedor de autenticação e
 * (b) a organização ativa escolhida. A organização ativa é uma PREFERÊNCIA: a cada
 * requisição conferimos no banco se o usuário é membro dela e com qual papel.
 * Nenhum identificador de organização enviado pelo cliente é usado para autorizar.
 */

export const ACTIVE_ORG_COOKIE = "cotacao_org";

export interface Session {
  user: SessionUser;
  memberships: MembershipSummary[];
  /** Organização ativa; `null` quando o usuário não pertence a nenhuma. */
  membership: MembershipSummary | null;
}

export interface AuthorizedSession extends Session {
  membership: MembershipSummary;
  ctx: TenantContext;
}

/** Resolve a sessão uma única vez por requisição (deduplicado pelo `cache` do React). */
export const getSession = cache(async (): Promise<Session | null> => {
  const cookieStore = await cookies();
  const identity = await getAuthProvider().getIdentity(cookieStore);
  if (!identity) return null;

  const user = await resolveUser(identity);
  if (!user) return null;

  const memberships = await listMemberships(user.id);
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const membership = (isUuid(preferred) ? memberships.find((item) => item.organizationId === preferred) : undefined) ?? memberships[0] ?? null;
  return { user, memberships, membership };
});

async function requestMetadata(): Promise<TenantContext["request"]> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipAddress: (forwarded || headerList.get("x-real-ip") || null)?.slice(0, 64) ?? null,
    userAgent: headerList.get("user-agent")?.slice(0, 300) ?? null,
  };
}

async function authorize(session: Session): Promise<AuthorizedSession | null> {
  if (!session.membership) return null;
  const ctx = userContext({
    organizationId: session.membership.organizationId,
    userId: session.user.id,
    role: session.membership.role,
    request: await requestMetadata(),
  });
  return { ...session, membership: session.membership, ctx };
}

/**
 * Para páginas (Server Components): garante sessão, organização e, opcionalmente, uma permissão.
 * Redireciona quando algo falta — a verificação de dados continua sendo feita nos serviços.
 */
export async function requirePage(permission?: Permission): Promise<AuthorizedSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  const authorized = await authorize(session);
  if (!authorized) redirect("/sem-acesso");
  if (permission && !can(authorized.ctx, permission)) redirect("/acesso-negado");
  return authorized;
}

/**
 * Para Server Actions e Route Handlers: lança erros de aplicação em vez de redirecionar,
 * para que o chamador receba 401/403 (ou uma mensagem) de forma previsível.
 */
export async function requireContext(permission?: Permission): Promise<AuthorizedSession> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  const authorized = await authorize(session);
  if (!authorized) throw new ForbiddenError("Sua conta não está vinculada a nenhuma empresa.");
  if (permission && !can(authorized.ctx, permission)) throw new ForbiddenError();
  return authorized;
}
