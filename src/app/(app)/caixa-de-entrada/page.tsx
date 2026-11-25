import type { Metadata } from "next";
import { Inbox, Search } from "lucide-react";
import { AutoRefresh, AutoSubmitSelect } from "@/components/client/helpers";
import { EmptyState, hrefWith, LinkTabs, PageContainer, PageHeader, Pagination } from "@/components/page";
import { RequestList } from "@/components/request-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { oneOf, pageNumber, readSearchParams, type SearchPageProps } from "@/lib/params";
import { listCustomers } from "@/modules/customers/customers";
import { can } from "@/modules/identity/permissions";
import { MAX_UPLOAD_FILES } from "@/modules/inbox/upload";
import { countRequestsByStatus, listRequests } from "@/modules/requests/queries";
import { env } from "@/platform/env";
import { requirePage } from "@/server/session";
import { UploadDialog } from "./upload-dialog";

export const metadata: Metadata = { title: "Caixa de entrada" };

const STATUSES = ["all", "AWAITING_REVIEW", "PROCESSING", "QUOTED", "FAILED", "DISCARDED"] as const;
const CHANNELS = ["all", "UPLOAD", "EMAIL", "WHATSAPP"] as const;
const PATH = "/caixa-de-entrada";

export default async function InboxPage({ searchParams }: SearchPageProps) {
  const { ctx } = await requirePage("inbox:read");
  const params = await readSearchParams(searchParams);
  const status = oneOf(params.status, STATUSES, "all");
  const channel = oneOf(params.canal, CHANNELS, "all");
  const query = params.q;
  const canUpload = can(ctx, "inbox:upload");

  const [result, counts, customers] = await Promise.all([
    listRequests(ctx, { status, channel, query, page: pageNumber(params.page), pageSize: 20 }),
    countRequestsByStatus(ctx),
    canUpload && can(ctx, "customer:read") ? listCustomers(ctx, { limit: 300 }) : Promise.resolve([]),
  ]);

  const inProgress = counts.RECEIVED + counts.PROCESSING;
  const filters = { status: status === "all" ? undefined : status, canal: channel === "all" ? undefined : channel, q: query };
  const tab = (value: (typeof STATUSES)[number], label: string, count?: number) => ({
    href: hrefWith(PATH, { canal: filters.canal, q: query }, { status: value === "all" ? undefined : value }),
    label,
    count,
    active: status === value,
  });
  const hasFilters = Boolean(query) || channel !== "all" || status !== "all";

  return (
    <PageContainer>
      <AutoRefresh active={inProgress > 0} />
      <PageHeader
        title="Caixa de entrada"
        description="Solicitações de cotação recebidas por upload, e-mail e WhatsApp, todas no mesmo fluxo de processamento."
        actions={canUpload ? <UploadDialog customers={customers.map(({ id, name }) => ({ id, name }))} maxFiles={MAX_UPLOAD_FILES} maxFileMb={env().MAX_UPLOAD_MB} /> : null}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5">
          <LinkTabs
            label="Filtrar por status"
            items={[
              tab("all", "Todas"),
              tab("AWAITING_REVIEW", "Aguardando revisão", counts.AWAITING_REVIEW),
              tab("PROCESSING", "Em processamento", inProgress),
              tab("QUOTED", "Cotadas"),
              tab("FAILED", "Com falha", counts.FAILED || undefined),
              tab("DISCARDED", "Descartadas"),
            ]}
          />
          <form method="get" action={PATH} className="flex w-full flex-wrap items-center gap-2 sm:w-auto" role="search">
            {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" name="q" defaultValue={query} placeholder="Buscar cliente, remetente ou item" aria-label="Buscar solicitações" className="h-8 w-full pl-8 text-[13px] sm:w-60" />
            </div>
            <AutoSubmitSelect name="canal" defaultValue={channel} aria-label="Canal" className="h-8 w-36 text-[13px]">
              <option value="all">Todos os canais</option>
              <option value="UPLOAD">Upload</option>
              <option value="EMAIL">E-mail</option>
              <option value="WHATSAPP">WhatsApp</option>
            </AutoSubmitSelect>
            <Button type="submit" variant="outline" size="sm" className="sr-only focus:not-sr-only">
              Filtrar
            </Button>
          </form>
        </div>

        {result.items.length > 0 ? (
          <RequestList items={result.items} />
        ) : hasFilters ? (
          <EmptyState icon={Search} title="Nenhuma solicitação encontrada" description="Ajuste os filtros ou limpe a busca para ver todas as solicitações." />
        ) : (
          <EmptyState
            icon={Inbox}
            title="Sua caixa de entrada está vazia"
            description="Envie um pedido em PDF, planilha ou imagem para começar. E-mail e WhatsApp podem ser conectados em Integrações."
          />
        )}

        <Pagination
          pathname={PATH}
          searchParams={filters}
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          pageSize={result.pageSize}
          noun={["solicitação", "solicitações"]}
        />
      </Card>
    </PageContainer>
  );
}
