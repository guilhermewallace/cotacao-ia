import nextEnv from "@next/env";

/**
 * Carrega .env / .env.local com as mesmas regras do Next.js, para que scripts e o
 * worker enxerguem exatamente a mesma configuração da aplicação web.
 * Importe este módulo ANTES de qualquer outro que leia variáveis de ambiente.
 */
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
