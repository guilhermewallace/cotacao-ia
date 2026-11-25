import { jwtVerify, SignJWT } from "jose";
import { INVALID_CREDENTIALS, type AuthIdentity, type AuthProvider, type CookieStore, type SignInResult } from "@/modules/identity/auth/types";
import { safeEqual } from "@/platform/crypto";
import { getPrisma } from "@/platform/db";
import { env } from "@/platform/env";

/**
 * Autenticação do AMBIENTE DE DEMONSTRAÇÃO.
 *
 * Qualquer usuário cadastrado entra com a senha única DEMO_PASSWORD. A sessão é um
 * JWT (HS256) assinado com SESSION_SECRET, em cookie httpOnly. Não há cadastro,
 * recuperação de senha nem MFA — por isso este provedor é recusado em produção
 * (ver validação em platform/env.ts). Em produção, use Supabase Auth.
 */

export const DEMO_SESSION_COOKIE = "cotacao_demo_session";
const SESSION_HOURS = 12;
const ISSUER = "cotacao-ia:demo";

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export async function createDemoSessionToken(user: { id: string; email: string }): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
}

export async function verifyDemoSessionToken(token: string): Promise<{ userId: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER, algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export class DemoAuthProvider implements AuthProvider {
  readonly name = "demo" as const;

  async signIn(credentials: { email: string; password: string }, cookies: CookieStore): Promise<SignInResult> {
    const config = env();
    const email = credentials.email.trim().toLowerCase();
    const passwordOk = safeEqual(credentials.password, config.DEMO_PASSWORD);
    const user = await getPrisma().user.findUnique({ where: { email }, select: { id: true, email: true, isActive: true } });
    // Resposta única para e-mail inexistente e senha errada (não revela quais contas existem).
    if (!passwordOk || !user || !user.isActive) return { ok: false, message: INVALID_CREDENTIALS };

    cookies.set(DEMO_SESSION_COOKIE, await createDemoSessionToken(user), {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_HOURS * 3600,
    });
    return { ok: true, identity: { providerUserId: null, email: user.email, emailVerified: true, userId: user.id } };
  }

  async getIdentity(cookies: CookieStore): Promise<AuthIdentity | null> {
    const token = cookies.get(DEMO_SESSION_COOKIE)?.value;
    if (!token) return null;
    const session = await verifyDemoSessionToken(token);
    return session ? { providerUserId: null, email: session.email, emailVerified: true, userId: session.userId } : null;
  }

  async signOut(cookies: CookieStore): Promise<void> {
    cookies.delete(DEMO_SESSION_COOKIE);
  }
}
