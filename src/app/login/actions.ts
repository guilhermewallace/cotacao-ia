"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthProvider } from "@/modules/identity/auth";
import { INVALID_CREDENTIALS } from "@/modules/identity/auth/types";
import { listMemberships, recordLogin, resolveUser } from "@/modules/identity/users";
import { logger, serializeError } from "@/platform/logger";
import { rateLimit } from "@/server/http";
import { ACTIVE_ORG_COOKIE } from "@/server/session";

export interface LoginState {
  error: string | null;
  email: string;
}

const credentialsSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

/** Só aceita destinos internos (evita redirecionamento aberto). */
function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/dashboard";
  return value.startsWith("/login") ? "/dashboard" : value;
}

export async function signInAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const emailRaw = String(formData.get("email") ?? "").trim();
  const parsed = credentialsSchema.safeParse({ email: emailRaw, password: formData.get("password") });
  if (!parsed.success) return { error: "Informe um e-mail válido e a senha.", email: emailRaw };

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || headerList.get("x-real-ip") || "desconhecido";
  // Limite por IP e por conta: reduz tentativas de força bruta.
  const byIp = rateLimit(`login:ip:${ip}`, 20, 300);
  const byAccount = rateLimit(`login:email:${parsed.data.email.toLowerCase()}`, 8, 300);
  if (!byIp.allowed || !byAccount.allowed) {
    return { error: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.", email: emailRaw };
  }

  const cookieStore = await cookies();
  const provider = getAuthProvider();
  let destination: string;
  try {
    const result = await provider.signIn(parsed.data, cookieStore);
    if (!result.ok) return { error: result.message, email: emailRaw };

    const user = await resolveUser(result.identity);
    if (!user) {
      // Autenticou no provedor, mas não foi convidado para nenhuma empresa.
      await provider.signOut(cookieStore);
      return { error: INVALID_CREDENTIALS, email: emailRaw };
    }
    await recordLogin(user.id);
    const memberships = await listMemberships(user.id);
    destination = memberships.length === 0 ? "/sem-acesso" : safeNext(formData.get("next"));
  } catch (error) {
    logger({ scope: "auth" }).error({ err: serializeError(error) }, "falha inesperada no login");
    return { error: "Não foi possível entrar agora. Tente novamente em instantes.", email: emailRaw };
  }
  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  await getAuthProvider().signOut(cookieStore);
  cookieStore.delete(ACTIVE_ORG_COOKIE);
  redirect("/login");
}
