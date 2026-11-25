/**
 * Abstração do provedor de autenticação.
 *
 * - `supabase`: Supabase Auth (produção).
 * - `demo`: contas locais do ambiente de demonstração, sem serviço externo.
 *
 * O provedor apenas AUTENTICA (quem é a pessoa). A autorização — a quais organizações
 * ela pertence e com qual papel — é sempre decidida pelo nosso banco (Membership).
 */

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  maxAge?: number;
  expires?: Date;
  domain?: string;
}

/** Subconjunto do armazenamento de cookies do Next.js usado pelos provedores. */
export interface CookieStore {
  get(name: string): { value: string } | undefined;
  getAll(): Array<{ name: string; value: string }>;
  set(name: string, value: string, options?: CookieOptions): void;
  delete(name: string): void;
}

export interface AuthIdentity {
  /** ID do usuário no provedor (Supabase); `null` no provedor demo. */
  providerUserId: string | null;
  email: string;
  /** O provedor confirma que o e-mail pertence a quem se autenticou? */
  emailVerified: boolean;
  /** ID do usuário na nossa base, quando o provedor já o conhece (provedor demo). */
  userId?: string;
}

export type SignInResult = { ok: true; identity: AuthIdentity } | { ok: false; message: string };

export interface AuthProvider {
  readonly name: "supabase" | "demo";
  signIn(credentials: { email: string; password: string }, cookies: CookieStore): Promise<SignInResult>;
  /** Identidade da sessão atual, ou `null` se não houver sessão válida. */
  getIdentity(cookies: CookieStore): Promise<AuthIdentity | null>;
  signOut(cookies: CookieStore): Promise<void>;
}

export const INVALID_CREDENTIALS = "E-mail ou senha incorretos.";
