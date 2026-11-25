import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { MatchOutcomesBar } from "@/components/charts/match-outcomes";
import { RequestsByDayChart } from "@/components/charts/requests-by-day";
import { AutoRefresh } from "@/components/client/helpers";
import { EmptyState, LinkTabs, PageContainer, PageHeader } from "@/components/page";
import { RequestList } from "@/components/request-list";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatInteger, formatPercent } from "@/lib/format";
import { oneOf, readSearchParams, type SearchPageProps } from "@/lib/params";
import { getDashboardData } from "@/modules/dashboard/metrics";
import { formatDuration } from "@/platform/dates";
import { requirePage } from "@/server/session";

export const metadata: Metadata = { title: "Painel" };

const PERIODS = ["7", "30", "90"] as const;

function StatTile({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const content = (
    <>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl leading-8 font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );
  const className = "block rounded-xl border bg-card px-4 py-3.5 shadow-xs";
  return href ? (
    <Link href={href} className={`${className} transition-colors hover:border-ring/50 hover:bg-accent/30`}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

export default async function DashboardPage({ searchParams }: SearchPageProps) {
  const { ctx, membership } = await requirePage("dashboard:read");
  const params = await readSearchParams(searchParams);
  const period = oneOf(params.periodo, PERIODS, "30");
  const data = await getDashboardData(ctx, { periodDays: Number(period) });
  const { kpis } = data;
  const periodLabel = `últimos ${period} dias`;

  return (
    <PageContainer>
      <AutoRefresh active={kpis.processing > 0} />
      <PageHeader title="Painel" description={`Visão geral das solicitações de cotação de ${membership.organizationName}.`} />

      {/* Filtro único, acima de todos os indicadores e gráficos que ele afeta */}
      <LinkTabs
        label="Período"
        className="mb-4"
        items={PERIODS.map((value) => ({
          href: value === "30" ? "/dashboard" : `/dashboard?periodo=${value}`,
          label: `${value} dias`,
          active: value === period,
        }))}
      />

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Solicitações recebidas" value={formatInteger(kpis.received)} hint={periodLabel} />
        <StatTile
          label="Em processamento"
          value={formatInteger(kpis.processing)}
          hint="agora, na fila ou em extração"
          href="/caixa-de-entrada?status=PROCESSING"
        />
        <StatTile
          label="Aguardando revisão"
          value={formatInteger(kpis.awaitingReview)}
          hint="agora, prontas para conferência"
          href="/caixa-de-entrada?status=AWAITING_REVIEW"
        />
        <StatTile
          label="Cotações finalizadas"
          value={formatInteger(kpis.quotationsFinalized)}
          hint={kpis.quotationsFinalized > 0 ? `${formatCurrency(kpis.quotationsFinalizedTotal)} · ${periodLabel}` : periodLabel}
          href="/cotacoes?status=FINALIZED"
        />
        <StatTile
          label="Tempo médio de processamento"
          value={kpis.avgProcessingSeconds === null ? "—" : formatDuration(kpis.avgProcessingSeconds)}
          hint="do recebimento até ficar pronta para revisão"
        />
        <StatTile
          label="Identificação automática"
          value={formatPercent(kpis.identificationRate)}
          hint={
            kpis.itemsExtracted > 0
              ? `${formatInteger(kpis.itemsIdentified)} de ${formatInteger(kpis.itemsExtracted)} itens com sugestão forte`
              : "sem itens extraídos no período"
          }
        />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Solicitações por dia</CardTitle>
              <CardDescription>Recebidas por canal · últimos {data.byDay.length} dias</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <RequestsByDayChart data={data.byDay} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Resultado da identificação</CardTitle>
              <CardDescription>Itens extraídos nos {periodLabel}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <MatchOutcomesBar outcomes={data.matchOutcomes} />
            <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              Toda sugestão passa por revisão humana antes de entrar em uma cotação — nada é aprovado automaticamente.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader className="items-center">
          <CardTitle>Solicitações recentes</CardTitle>
          <Link href="/caixa-de-entrada" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Ver caixa de entrada
            <ArrowRight aria-hidden />
          </Link>
        </CardHeader>
        {data.recent.length > 0 ? (
          <div className="border-t">
            <RequestList items={data.recent} />
          </div>
        ) : (
          <EmptyState
            icon={Inbox}
            title="Nenhuma solicitação ainda"
            description="Envie um arquivo pela caixa de entrada ou conecte o e-mail e o WhatsApp em Integrações."
            className="border-t"
          />
        )}
      </Card>
    </PageContainer>
  );
}
