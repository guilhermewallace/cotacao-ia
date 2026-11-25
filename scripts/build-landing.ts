/**
 * Gera public/landing/engine.js: o motor das demonstrações da página pública.
 *
 * O motor é src/modules/landing/browser/engine.ts — os módulos puros do produto (normalização,
 * atributos técnicos, pontuação) mais o catálogo fictício — empacotado para o navegador.
 * O arquivo gerado é versionado. Rode este script sempre que mudar regras de leitura ou de
 * correspondência; o teste tests/unit/landing.test.ts acusa quando o arquivo ficou para trás.
 *
 * Uso: npm run landing:build
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

export const LANDING_ENGINE_ENTRY = "src/modules/landing/browser/engine.ts";
export const LANDING_ENGINE_OUTPUT = "public/landing/engine.js";

/** Teto de tamanho: evita que uma dependência pesada entre na página por engano. */
export const LANDING_ENGINE_MAX_BYTES = 90 * 1024;

const BANNER = "/* Gerado por `npm run landing:build` a partir de src/modules/landing/browser/engine.ts. Não edite. */";

/** Empacota o motor e devolve o JavaScript, sem gravar nada. */
export async function bundleLandingEngine(root: string = process.cwd()): Promise<string> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [LANDING_ENGINE_ENTRY],
    tsconfig: "tsconfig.json",
    bundle: true,
    format: "iife",
    globalName: "CotacaoEngine",
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "none",
    banner: { js: BANNER },
    write: false,
    metafile: true,
    logLevel: "silent",
  });

  const packages = Object.keys(result.metafile.inputs).filter((file) => file.includes("node_modules"));
  if (packages.length > 0) {
    throw new Error(`O motor da página pública só pode usar módulos próprios, sem pacotes. Encontrado: ${packages.slice(0, 3).join(", ")}`);
  }
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error("O empacotamento do motor da página pública não gerou saída.");
  const bytes = Buffer.byteLength(code);
  if (bytes > LANDING_ENGINE_MAX_BYTES) {
    throw new Error(`O motor da página pública ficou com ${bytes} bytes (teto: ${LANDING_ENGINE_MAX_BYTES}). Confira o que passou a ser importado.`);
  }
  return code;
}

async function main(): Promise<void> {
  const code = await bundleLandingEngine();
  writeFileSync(path.resolve(process.cwd(), LANDING_ENGINE_OUTPUT), code);
  console.log(`gerado: ${LANDING_ENGINE_OUTPUT} (${(Buffer.byteLength(code) / 1024).toFixed(1)} KB)`);
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
