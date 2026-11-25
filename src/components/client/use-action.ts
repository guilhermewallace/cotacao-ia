"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/** Formato devolvido pelas Server Actions (ver src/server/actions.ts). */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; code: string };

interface RunOptions<T> {
  /** Mensagem de sucesso (toast). Omitir para ações cujo efeito já é visível na tela. */
  success?: string | ((data: T) => string | undefined);
  onSuccess?: (data: T) => void;
  onError?: (message: string) => void;
}

/**
 * Executa Server Actions com estado de carregamento e tratamento uniforme de erros:
 * mensagens do servidor viram toast; sessão expirada leva ao login.
 */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = useCallback(
    <T>(action: () => Promise<ActionResult<T>>, options: RunOptions<T> = {}) => {
      startTransition(async () => {
        let result: ActionResult<T>;
        try {
          result = await action();
        } catch {
          toast.error("Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.");
          options.onError?.("network");
          return;
        }
        if (result.ok) {
          const message = typeof options.success === "function" ? options.success(result.data) : options.success;
          if (message) toast.success(message);
          options.onSuccess?.(result.data);
          return;
        }
        if (result.code === "UNAUTHENTICATED") {
          router.push("/login");
          return;
        }
        toast.error(result.error);
        options.onError?.(result.error);
      });
    },
    [router],
  );

  return { pending, run };
}
