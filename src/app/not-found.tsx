import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted">
        <FileQuestion aria-hidden className="size-5 text-muted-foreground" />
      </div>
      <h1 className="text-lg font-semibold">Página não encontrada</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">O endereço não existe ou o registro não pertence à sua empresa.</p>
      <Link href="/dashboard" className={buttonVariants({ className: "mt-5" })}>
        Ir para o painel
      </Link>
    </main>
  );
}
