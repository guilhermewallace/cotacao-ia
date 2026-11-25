import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  // `server-only` só existe para o bundler do Next.js; em testes é um módulo vazio.
  "server-only": path.resolve(import.meta.dirname, "tests/helpers/empty-module.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/helpers/setup-env.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/helpers/global-setup.ts"],
          setupFiles: ["tests/helpers/setup-env.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Os arquivos compartilham o mesmo banco: executados em sequência, para resultados determinísticos.
          fileParallelism: false,
        },
      },
    ],
  },
});
