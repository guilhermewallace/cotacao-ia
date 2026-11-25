import { createServerClient } from "@supabase/ssr";
import { INVALID_CREDENTIALS, type AuthIdentity, type AuthProvider, type CookieStore, type SignInResult } from "@/modules/identity/auth/types";
import { env } from "@/platform/env";
import { logger } from "@/platform/logger";

/**
 * Supabase Auth com sessão em cookies (@supabase/ssr).
 *
 * - O login acontece no servidor (Server Action): a senha nunca passa por JavaScript do navegador
 *   além do envio do formulário, e a chave do Supabase não vai para o bundle do cliente.
 * - `getUser()` valida o token junto ao Supabase Auth a cada requisição — não confiamos
 *   apenas no conteúdo do cookie.
 * - A renovação do token é feita no `proxy.ts`, que pode gravar cookies na resposta.
 */

export function createSupabaseServerClient(cookies: CookieStore) {
  const config = env();
  if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY são obrigatórias quando AUTH_PROVIDER=supabase");
  }
  return createServerClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookies.set(name, value, { ...options, sameSite: typeof options?.sameSite === "string" ? options.sameSite : "lax" });
          }
        } catch {
          // Em Server Components os cookies são somente leitura; a renovação ocorre no proxy.
        }
      },
    },
  });
}

export class SupabaseAuthProvider implements AuthProvider {
  readonly name = "supabase" as const;

  async signIn(credentials: { email: string; password: string }, cookies: CookieStore): Promise<SignInResult> {
    const supabase = createSupabaseServerClient(cookies);
    const { data, error } = await supabase.auth.signInWithPassword({ email: credentials.email.trim().toLowerCase(), password: credentials.password });
    if (error || !data.user?.email) {
      if (error && error.status !== 400) logger().warn({ status: error.status, code: error.code }, "falha no login via Supabase");
      return { ok: false, message: INVALID_CREDENTIALS };
    }
    return {
      ok: true,
      identity: { providerUserId: data.user.id, email: data.user.email.toLowerCase(), emailVerified: Boolean(data.user.email_confirmed_at) },
    };
  }

  async getIdentity(cookies: CookieStore): Promise<AuthIdentity | null> {
    const supabase = createSupabaseServerClient(cookies);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email) return null;
    return { providerUserId: data.user.id, email: data.user.email.toLowerCase(), emailVerified: Boolean(data.user.email_confirmed_at) };
  }

  async signOut(cookies: CookieStore): Promise<void> {
    const supabase = createSupabaseServerClient(cookies);
    await supabase.auth.signOut();
  }
}
