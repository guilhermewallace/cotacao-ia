import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileUp, Tags } from "lucide-react";
import { EmptyState, PageContainer, PageHeader, Pagination } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { pageNumber, readSearchParams, type IdPageProps } from "@/lib/params";
import { getPriceList } from "@/modules/catalog/price-lists";
import { can } from "@/modules/identity/permissions";
import { isAppError } from "@/platform/errors";
import { isUuid } from "@/platform/ids";
import { requirePage } from "@/server/session";
import { PriceCell } from "../price-list-controls";

export const metadata: Metadata = { title: "Lista de preços" };

const PAGE_SIZE = 50;

export default async function PriceListPage({ params, searchParams }: IdPageProps) {
  const { ctx } = await requirePage("catalog:read");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await readSearchParams(searchParams);
  const data = await getPriceList(ctx, id, { page: pageNumber(query.page), pageSize: PAGE_SIZE }).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const canWrite = can(ctx, "catalog:write");

  return (
    <PageContainer>
      <PageHeader
        back={{ href: "/catalogo/listas-de-precos", label: "Listas de preços" }}
        title={data.list.name}
        meta={
          <>
            {data.list.isDefault ? <Badge variant="info">Lista padrão</Badge> : null}
            {!data.list.isActive ? <Badge variant="outline">Inativa</Badge> : null}
            <span className="text-[13px] text-muted-foreground">
              {data.total} {data.total === 1 ? "produto com preço" : "produtos com preço"} · {data.list.customerCount} {data.list.customerCount === 1 ? "cliente vinculado" : "clientes vinculados"}
            </span>
          </>
        }
        actions={
          can(ctx, "catalog:import") ? (
            <Link href={`/catalogo/importar?tipo=precos&lista=${data.list.id}`} className={buttonVariants({ variant: "outline" })}>
              <FileUp aria-hidden />
              Importar preços
            </Link>
          ) : null
        }
      />
      <Card className="overflow-hidden">
        {data.items.length === 0 ? (
          <EmptyState icon={Tags} title="Lista sem preços" description="Importe uma planilha com SKU e preço para preencher esta lista." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Un.</TableHead>
                <TableHead className="text-right">Preço de catálogo</TableHead>
                <TableHead className="text-right">Preço nesta lista (R$)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <TableRow key={item.productId}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{item.sku}</TableCell>
                  <TableCell className="max-w-md">
                    <Link href={`/catalogo/${item.productId}`} className="underline-offset-4 hover:underline">
                      {item.description}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.unit}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{formatCurrency(item.catalogPrice, { precise: true })}</TableCell>
                  <TableCell className="text-right">
                    <PriceCell priceListId={data.list.id} productId={item.productId} unitPrice={item.unitPrice} label={`Preço de ${item.description} nesta lista`} disabled={!canWrite} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination
          pathname={`/catalogo/listas-de-precos/${data.list.id}`}
          searchParams={{}}
          page={data.page}
          pageCount={data.pageCount}
          total={data.total}
          pageSize={PAGE_SIZE}
          noun={["produto", "produtos"]}
        />
      </Card>
    </PageContainer>
  );
}
