import { getPrisma } from "@/platform/db";
import { logger, serializeError } from "@/platform/logger";

/** Verificação de saúde para orquestradores e balanceadores. Não expõe detalhes internos. */
export async function GET(): Promise<Response> {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger({ scope: "api.health" }).error({ err: serializeError(error) }, "banco de dados indisponível");
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
