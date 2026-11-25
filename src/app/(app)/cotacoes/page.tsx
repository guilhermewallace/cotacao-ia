import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { EmptyState, hrefWith, LinkTabs, PageContainer, PageHeader, Pagination } from "@/components/page";
import { QuotationStatusBadge } from "@/components/status";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { oneOf, pageNumber, readSearchParams, type SearchPageProps } from "@/lib/params";
import { listQuotations } from "@/modules/quotations/service";
import { formatDate } from "@/platform/dates";
import { requirePage } from "@/server/session";

export const metadata: Metadata = { title: "Cotações" };

const STATUSES = ["all", "DRAFT", "FINALIZED", "CANCELED"] as const;
const PATH = "/cotacoes";

export default async function QuotationsPage({ searchParams }: SearchPageProps) {
  const { ctx } = await requirePage("quotation:read");
  const params = await readSearchParams(searchParams);
  const status = oneOf(params.status, STATUSES, "all");
  const query = params.q;
  const result = await listQuotations(ctx, { status, query, page: pageNumber(params.page), pageSize: 20 });
  const filters = { status: status === "all" ? undefined : status, q: query };
  const tab = (value: (typeof STATUSES)[number], label: string) => ({
    href: hrefWith(PATH, { q: query }, { status: value === "all" ? undefined : value }),
    label,
    active: status === value,
  });

  return (
    <PageContainer>
      <PageHeader title="Cotações" description="Histórico de cotações geradas a partir das solicitações revisadas." />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5">
          <LinkTabs label="Filtrar por status" items={[tab("all", "Todas"), tab("DRAFT", "Rascunhos"), tab("FINALIZED", "Finalizadas"), tab("CANCELED", "Canceladas")]} />
          <form method="get" action={PATH} role="search" className="relative w-full sm:w-auto">
            {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" name="q" defaultValue={query} placeholder="Buscar por número ou cliente" aria-label="Buscar cotações" className="h-8 w-full pl-8 text-[13px] sm:w-64" />
          </form>
        </div>

        {result.items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Número</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead className="text-right">Itens</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((quotation) => (
                <TableRow key={quotation.id}>
                  <TableCell>
                    <Link href={`/cotacoes/${quotation.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                      {quotation.number}
                    </Link>
                    {quotation.createdByName ? <span className="block text-xs text-muted-foreground">por {quotation.createdByName}</span> : null}
                  </TableCell>
                  <TableCell className="max-w-64 truncate">{quotation.customerName}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(quotation.issueDate)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(quotation.validUntil)}</TableCell>
                  <TableCell className="text-right tabular-nums">{quotation.itemCount}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatCurrency(quotation.total)}</TableCell>
                  <TableCell>
                    <QuotationStatusBadge status={quotation.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : query || status !== "all" ? (
          <EmptyState icon={Search} title="Nenhuma cotação encontrada" description="Ajuste a busca ou o filtro de status." />
        ) : (
          <EmptyState
            icon={FileText}
            title="Nenhuma cotação ainda"
            description="As cotações são geradas a partir de uma solicitação revisada, na caixa de entrada."
          />
        )}

        <Pagination pathname={PATH} searchParams={filters} page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} noun={["cotação", "cotações"]} />
      </Card>
    </PageContainer>
  );
}
