"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-danger-soft">
        <TriangleAlert aria-hidden className="size-5 text-danger" />
      </div>
      <h1 className="text-lg font-semibold">Algo deu errado</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Não foi possível carregar esta tela. Tente novamente; se o problema continuar, informe o código abaixo ao suporte.
      </p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">Código: {error.digest}</p> : null}
      <Button className="mt-5" onClick={reset}>
        Tentar novamente
      </Button>
    </main>
  );
}
