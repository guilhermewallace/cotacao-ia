import "server-only";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { TenantContext } from "@/modules/tenancy/context";
import { isAppError, type AppErrorCode } from "@/platform/errors";
import { logger, serializeError } from "@/platform/logger";
import { requireContext, type AuthorizedSession } from "@/server/session";

// Mensagens de validação padrão do Zod em português.
z.config(z.locales.pt());

/**
 * Resultado serializável de uma Server Action.
 * Erros esperados viram mensagem para o usuário; erros inesperados são registrados
 * no servidor e devolvidos de forma genérica (nada de stack trace ou SQL no cliente).
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; code: AppErrorCode };

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";

export function toActionError(error: unknown, scope: string): { ok: false; error: string; code: AppErrorCode } {
  if (isAppError(error)) return { ok: false, error: error.message, code: error.code };
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return { ok: false, error: issue?.message ?? "Dados inválidos.", code: "VALIDATION" };
  }
  logger({ scope }).error({ err: serializeError(error) }, "erro inesperado em server action");
  return { ok: false, error: GENERIC_ERROR, code: "INTERNAL" };
}

/**
 * Executa uma Server Action autenticada.
 *
 * - resolve a sessão e o contexto de tenant no servidor (nunca a partir do cliente);
 * - converte exceções em `ActionResult`;
 * - atualiza a rota atual após o sucesso, para a tela refletir o novo estado.
 *
 * A autorização fina (permissões e posse do recurso) é feita pelos serviços de domínio.
 */
export async function runAction<T>(
  scope: string,
  handler: (ctx: TenantContext, session: AuthorizedSession) => Promise<T>,
  options: { refresh?: boolean } = {},
): Promise<ActionResult<T>> {
  try {
    const session = await requireContext();
    const data = await handler(session.ctx, session);
    if (options.refresh !== false) refresh();
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error);
    return toActionError(error, scope);
  }
}
