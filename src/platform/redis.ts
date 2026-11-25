import { Redis } from "ioredis";
import { env } from "@/platform/env";

/**
 * Conexões Redis para o BullMQ. Workers exigem `maxRetriesPerRequest: null`
 * (comandos bloqueantes); produtores usam falha rápida para não prender requisições HTTP.
 */
export function createRedisConnection(role: "producer" | "worker"): Redis {
  return new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: role === "worker" ? null : 2,
    enableReadyCheck: true,
    connectTimeout: 5_000,
    lazyConnect: false,
  });
}
