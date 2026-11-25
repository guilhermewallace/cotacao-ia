import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FIXTURE_ANSWERS } from "@/demo/scenarios";
import type { AiExtraction } from "@/modules/ai/schema";
import type { MockFixtureResolver } from "@/modules/ai/providers/mock";
import { sha256Hex } from "@/platform/crypto";

/**
 * Liga os documentos de exemplo (demo/fixtures) às respostas fixas do provedor mock.
 * O vínculo é feito pelo SHA-256 do arquivo em disco, calculado na primeira chamada —
 * regenerar os documentos não exige atualizar nenhum hash no código.
 */

export function demoFixturesDir(): string {
  return process.env.DEMO_FIXTURES_DIR ? path.resolve(process.env.DEMO_FIXTURES_DIR) : path.resolve(process.cwd(), "demo", "fixtures");
}

let cache: Map<string, AiExtraction> | undefined;

function loadAnswers(): Map<string, AiExtraction> {
  if (cache) return cache;
  cache = new Map();
  const directory = demoFixturesDir();
  for (const [fileName, answer] of Object.entries(FIXTURE_ANSWERS)) {
    const filePath = path.join(directory, fileName);
    if (existsSync(filePath)) cache.set(sha256Hex(readFileSync(filePath)), answer);
  }
  return cache;
}

export function demoFixtureResolver(): MockFixtureResolver {
  return {
    extraction: (sha256) => loadAnswers().get(sha256) ?? null,
    transcription: () => null,
  };
}

export function readDemoFixture(fileName: string): Buffer {
  return readFileSync(path.join(demoFixturesDir(), path.basename(fileName)));
}
