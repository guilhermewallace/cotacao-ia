import { Prisma } from "@/generated/prisma/client";
import { assertCan } from "@/modules/identity/permissions";
import { listRequests, type RequestListItem } from "@/modules/requests/queries";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { addDays, APP_TIMEZONE, localDateString } from "@/platform/dates";
import { getPrisma } from "@/platform/db";

/**
 * Indicadores do dashboard comercial.
 *
 * - "Em processamento" e "Aguardando revisão" são fotografias do momento (fila atual).
 * - Os demais indicadores consideram o período selecionado (padrão: últimos 30 dias).
 * - Identificação automática = itens para os quais o motor encontrou uma sugestão forte
 *   e única ÷ itens extraídos. Mede o motor, antes de qualquer revisão humana.
 */

export interface DashboardData {
  periodDays: number;
  kpis: {
    received: number;
    processing: number;
    awaitingReview: number;
    quotationsFinalized: number;
    quotationsFinalizedTotal: string;
    avgProcessingSeconds: number | null;
    identificationRate: number | null;
    itemsExtracted: number;
    itemsIdentified: number;
  };
  /** Solicitações recebidas por dia e por canal (dia no fuso da operação). */
  byDay: Array<{ date: string; upload: number; email: number; whatsapp: number }>;
  /** Resultado do matching dos itens do período. */
  matchOutcomes: { suggested: number; ambiguous: number; noMatch: number };
  recent: RequestListItem[];
}

export async function getDashboardData(ctx: TenantContext, options: { periodDays?: number; now?: Date } = {}): Promise<DashboardData> {
  assertCan(ctx, "dashboard:read");
  const periodDays = Math.min(Math.max(options.periodDays ?? 30, 1), 365);
  const now = options.now ?? new Date();
  const since = addDays(now, -periodDays);
  const db = tenantDb(ctx.organizationId);
  const prisma = getPrisma();
  const org = ctx.organizationId;

  const [received, processing, awaitingReview, finalized, timing, outcomes, perDay, recent] = await Promise.all([
    db.quotationRequest.count({ where: { receivedAt: { gte: since } } }),
    db.quotationRequest.count({ where: { status: { in: ["RECEIVED", "PROCESSING"] } } }),
    db.quotationRequest.count({ where: { status: "AWAITING_REVIEW" } }),
    db.quotation.aggregate({ where: { status: "FINALIZED", finalizedAt: { gte: since } }, _count: { _all: true }, _sum: { total: true } }),
    prisma.$queryRaw<Array<{ avg_seconds: number | null }>>(Prisma.sql`
      SELECT avg(extract(epoch FROM (processed_at - received_at)))::float8 AS avg_seconds
      FROM quotation_requests
      WHERE organization_id = ${org}::uuid AND processed_at IS NOT NULL AND received_at >= ${since}
    `),
    prisma.$queryRaw<Array<{ outcome: string; total: bigint }>>(Prisma.sql`
      SELECT i.match_outcome::text AS outcome, count(*) AS total
      FROM requested_items i
      JOIN quotation_requests r ON r.organization_id = i.organization_id AND r.id = i.quotation_request_id
      WHERE i.organization_id = ${org}::uuid AND r.received_at >= ${since} AND NOT i.is_manual
      GROUP BY i.match_outcome
    `),
    prisma.$queryRaw<Array<{ day: string; channel: string; total: bigint }>>(Prisma.sql`
      SELECT to_char(r.received_at AT TIME ZONE ${APP_TIMEZONE}, 'YYYY-MM-DD') AS day, m.channel::text AS channel, count(*) AS total
      FROM quotation_requests r
      JOIN inbound_messages m ON m.organization_id = r.organization_id AND m.id = r.inbound_message_id
      WHERE r.organization_id = ${org}::uuid AND r.received_at >= ${since}
      GROUP BY 1, 2
    `),
    listRequests(ctx, { pageSize: 6 }),
  ]);

  const matchOutcomes = { suggested: 0, ambiguous: 0, noMatch: 0 };
  for (const row of outcomes) {
    if (row.outcome === "SUGGESTED") matchOutcomes.suggested = Number(row.total);
    else if (row.outcome === "AMBIGUOUS") matchOutcomes.ambiguous = Number(row.total);
    else matchOutcomes.noMatch = Number(row.total);
  }
  const itemsExtracted = matchOutcomes.suggested + matchOutcomes.ambiguous + matchOutcomes.noMatch;

  // Série diária contínua (dias sem solicitações aparecem com zero).
  const chartDays = Math.min(periodDays, 30);
  const counts = new Map<string, { upload: number; email: number; whatsapp: number }>();
  for (const row of perDay) {
    const entry = counts.get(row.day) ?? { upload: 0, email: 0, whatsapp: 0 };
    if (row.channel === "UPLOAD") entry.upload = Number(row.total);
    else if (row.channel === "EMAIL") entry.email = Number(row.total);
    else entry.whatsapp = Number(row.total);
    counts.set(row.day, entry);
  }
  const byDay: DashboardData["byDay"] = [];
  for (let offset = chartDays - 1; offset >= 0; offset -= 1) {
    const date = localDateString(addDays(now, -offset));
    byDay.push({ date, ...(counts.get(date) ?? { upload: 0, email: 0, whatsapp: 0 }) });
  }

  return {
    periodDays,
    kpis: {
      received,
      processing,
      awaitingReview,
      quotationsFinalized: finalized._count._all,
      quotationsFinalizedTotal: (finalized._sum.total ?? new Prisma.Decimal(0)).toFixed(2),
      avgProcessingSeconds: timing[0]?.avg_seconds ?? null,
      identificationRate: itemsExtracted > 0 ? matchOutcomes.suggested / itemsExtracted : null,
      itemsExtracted,
      itemsIdentified: matchOutcomes.suggested,
    },
    byDay,
    matchOutcomes,
    recent: recent.items,
  };
}
