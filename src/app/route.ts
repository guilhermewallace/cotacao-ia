import { loadLandingTemplate } from "@/modules/landing/page";
import { renderLandingPage } from "@/modules/landing/render";
import { whatsappChatUrl } from "@/modules/landing/whatsapp";
import { env } from "@/platform/env";
import { logger, serializeError } from "@/platform/logger";

/**
 * Página pública (landing), servida em "/".
 *
 * É um documento HTML independente do painel — sem React nem Tailwind —, por isso é uma rota e
 * não uma página: assim os estilos dela e os do app nunca se misturam. Nada aqui lê sessão, banco
 * ou dados de empresas; a única configuração é o contato comercial (LANDING_WHATSAPP_*).
 *
 * Quem já tem sessão não chega a esta rota: o proxy (src/proxy.ts) leva direto ao /dashboard.
 */

// As variáveis de ambiente são lidas em tempo de execução (a mesma imagem serve qualquer ambiente).
export const dynamic = "force-dynamic";

const LOGIN_PATH = "/login";

export async function GET(): Promise<Response> {
  try {
    const config = env();
    const template = await loadLandingTemplate({ fresh: config.NODE_ENV === "development" });
    const html = renderLandingPage(template, {
      whatsappUrl: whatsappChatUrl(config.LANDING_WHATSAPP_NUMBER, config.LANDING_WHATSAPP_MESSAGE),
      loginUrl: LOGIN_PATH,
    });
    return new Response(html, {
      // A política de conteúdo desta página é definida em next.config.ts (regra para "/").
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
    });
  } catch (error) {
    // A página pública nunca deve impedir o acesso ao sistema: se ela falhar, vale a tela de login.
    logger({ scope: "landing" }).error({ err: serializeError(error) }, "falha ao montar a página pública");
    // Location relativo: vale atrás de qualquer proxy, sem depender do host visto pelo servidor.
    return new Response(null, { status: 307, headers: { Location: LOGIN_PATH, "Cache-Control": "no-store" } });
  }
}
