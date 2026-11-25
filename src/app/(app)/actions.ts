"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ForbiddenError, UnauthenticatedError } from "@/platform/errors";
import { idSchema } from "@/platform/ids";
import { toActionError, type ActionResult } from "@/server/actions";
import { ACTIVE_ORG_COOKIE, getSession } from "@/server/session";

/** Troca a empresa ativa. Só aceita empresas das quais o usuário é membro. */
export async function switchOrganizationAction(organizationId: string): Promise<ActionResult> {
  try {
    const id = idSchema.parse(organizationId);
    const session = await getSession();
    if (!session) throw new UnauthenticatedError();
    if (!session.memberships.some((membership) => membership.organizationId === id)) throw new ForbiddenError("Você não é membro desta empresa.");

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORG_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    });
  } catch (error) {
    return toActionError(error, "organization.switch");
  }
  // Os registros da tela atual pertencem à empresa anterior: volta ao painel.
  redirect("/dashboard");
}
