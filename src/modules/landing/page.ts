import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Página pública (landing): um documento HTML independente do painel, sem React nem Tailwind.
 *
 *   src/modules/landing/page.html           modelo da página (ver render.ts)
 *   public/landing/site.css, site.js        estilo e comportamento, escritos à mão
 *   public/landing/engine.js                motor das demonstrações, GERADO por `npm run landing:build`
 *   src/modules/landing/browser/engine.ts   código-fonte desse motor (os módulos puros do produto)
 *
 * A política de conteúdo da página (sem script embutido, sem chamadas de rede) está em next.config.ts.
 */

/** Lido do disco para continuar sendo um HTML comum, editável sem etapa de build. */
const TEMPLATE_PATH = path.join(process.cwd(), "src", "modules", "landing", "page.html");

let cached: string | undefined;

/** `fresh: true` relê o arquivo a cada chamada (desenvolvimento); senão, lê uma vez por processo. */
export async function loadLandingTemplate(options: { fresh?: boolean } = {}): Promise<string> {
  if (options.fresh || cached === undefined) cached = await readFile(TEMPLATE_PATH, "utf8");
  return cached;
}
