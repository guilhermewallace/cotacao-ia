import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Variáveis descartadas de propósito usam prefixo "_".
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  // public/landing/engine.js é gerado (npm run landing:build).
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "next-env.d.ts", "src/generated/**", ".data/**", "public/landing/engine.js"]),
]);

export default eslintConfig;
