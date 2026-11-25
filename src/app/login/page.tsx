import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { Alert } from "@/components/ui/misc";
import { isDemoAuth } from "@/modules/identity/auth";
import { readSearchParams, type SearchPageProps } from "@/lib/params";
import { getSession } from "@/server/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

/** Contas do ambiente de demonstração (criadas pelo seed). Não existem em produção. */
const DEMO_ACCOUNTS = [
  { email: "ana.souza@eletricacentral.example", role: "Proprietária — acesso total" },
  { email: "bruno.lima@eletricacentral.example", role: "Vendedor — revisa e monta cotações" },
  { email: "carla.mendes@eletricacentral.example", role: "Leitura — apenas consulta" },
  { email: "diego.rocha@voltsul.example", role: "Outra empresa (isolamento entre empresas)" },
];

export default async function LoginPage({ searchParams }: SearchPageProps) {
  const session = await getSession();
  if (session) redirect(session.membership ? "/dashboard" : "/sem-acesso");

  const params = await readSearchParams(searchParams);
  const next = params.next ?? null;
  const demo = isDemoAuth();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo className="mb-8 flex justify-center" />
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold tracking-tight">Entrar</h1>
          <p className="mt-1 mb-5 text-sm text-muted-foreground">Acesse o painel de cotações da sua empresa.</p>
          <LoginForm next={next} defaultEmail={demo ? DEMO_ACCOUNTS[0]?.email : undefined} />
        </div>

        {demo ? (
          <Alert variant="info" className="mt-4 flex-col gap-2">
            <p className="flex items-center gap-2 font-medium">
              <FlaskConical aria-hidden className="size-4 text-info" />
              Ambiente de demonstração
            </p>
            <p className="text-muted-foreground">
              Todos os dados são fictícios. Use uma das contas abaixo com a senha definida em <code className="font-mono text-xs">DEMO_PASSWORD</code>{" "}
              (padrão do <code className="font-mono text-xs">.env.example</code>: <code className="font-mono text-xs">demo1234</code>).
            </p>
            <ul className="grid gap-1.5">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email}>
                  <span className="font-mono text-xs break-all">{account.email}</span>
                  <span className="block text-xs text-muted-foreground">{account.role}</span>
                </li>
              ))}
            </ul>
          </Alert>
        ) : (
          <p className="mt-4 text-center text-xs text-muted-foreground">O acesso é concedido por convite do administrador da sua empresa.</p>
        )}
      </div>
    </main>
  );
}
