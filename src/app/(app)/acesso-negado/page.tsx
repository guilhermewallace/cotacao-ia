import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { EmptyState, PageContainer } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Acesso negado" };

export default function ForbiddenPage() {
  return (
    <PageContainer>
      <EmptyState
        icon={ShieldAlert}
        title="Você não tem permissão para acessar esta área"
        description="Seu papel nesta empresa não inclui esta funcionalidade. Fale com um administrador se precisar de acesso."
        action={
          <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
            Voltar ao painel
          </Link>
        }
        className="py-24"
      />
    </PageContainer>
  );
}
