import nextEnv from "@next/env";
import { defineConfig } from "prisma/config";

// Carrega .env / .env.local com as mesmas regras de precedência do Next.js.
nextEnv.loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma generate` não precisa de banco; os comandos de migration exigem DATABASE_URL.
    url: process.env.DATABASE_URL ?? "",
  },
});
