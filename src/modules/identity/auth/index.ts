import { DemoAuthProvider } from "@/modules/identity/auth/demo-provider";
import { SupabaseAuthProvider } from "@/modules/identity/auth/supabase-provider";
import type { AuthProvider } from "@/modules/identity/auth/types";
import { env } from "@/platform/env";

export type { AuthIdentity, AuthProvider, CookieStore, SignInResult } from "@/modules/identity/auth/types";

let provider: AuthProvider | undefined;

export function getAuthProvider(): AuthProvider {
  provider ??= env().AUTH_PROVIDER === "supabase" ? new SupabaseAuthProvider() : new DemoAuthProvider();
  return provider;
}

export function isDemoAuth(): boolean {
  return env().AUTH_PROVIDER === "demo";
}
