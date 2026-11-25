import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UserX } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { getSession } from "@/server/session";
import { signOutAction } from "../login/actions";

export const metadata: Metadata = { title: "Sem acesso" };

export default async function NoAccessPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.membership) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo className="mb-8" />
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted">
        <UserX aria-hidden className="size-5 text-muted-foreground" />
      </div>
      <h1 className="text-lg font-semibold">Sua conta ainda não tem acesso a nenhuma empresa</h1>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Você entrou como <span className="font-medium text-foreground">{session.user.email}</span>, mas esta conta não está vinculada a nenhuma empresa.
        Peça ao administrador da sua empresa para adicionar você em Configurações › Membros.
      </p>
      <form action={signOutAction} className="mt-5">
        <Button type="submit" variant="outline">
          Sair
        </Button>
      </form>
    </main>
  );
}
