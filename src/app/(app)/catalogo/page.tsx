import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, Package, Plus, Search } from "lucide-react";
import { AutoSubmitSelect } from "@/components/client/helpers";
import { EmptyState, PageContainer, PageHeader, Pagination } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { oneOf, pageNumber, readSearchParams, type SearchPageProps } from "@/lib/params";
import { listProductFacets, listProducts } from "@/modules/catalog/products";
import { can } from "@/modules/identity/permissions";
import { requirePage } from "@/server/session";
import { CatalogTabs } from "./catalog-tabs";

export const metadata: Metadata = { title: "Catálogo" };

const PATH = "/catalogo";
const STATUSES = ["active", "inactive", "all"] as const;

export default async function CatalogPage({ searchParams }: SearchPageProps) {
  const { ctx } = await requirePage("catalog:read");
  const params = await readSearchParams(searchParams);
  const status = oneOf(params.status, STATUSES, "active");
  const filters = { q: params.q, categoria: params.categoria, fabricante: params.fabricante, status: status === "active" ? undefined : status };

  const [result, facets] = await Promise.all([
    listProducts(ctx, { query: params.q, category: params.categoria, manufacturer: params.fabricante, status, page: pageNumber(params.page), pageSize: 25 }),
    listProductFacets(ctx),
  ]);
  const hasFilters = Boolean(params.q || params.categoria || params.fabricante || status !== "active");

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo"
        description="Produtos, sinônimos e códigos de fabricante usados para identificar os itens das solicitações."
        actions={
          <>
            {can(ctx, "catalog:import") ? (
              <Link href="/catalogo/importar" className={buttonVariants({ variant: "outline" })}>
                <FileUp aria-hidden />
                Importar planilha
              </Link>
            ) : null}
            {can(ctx, "catalog:write") ? (
              <Link href="/catalogo/novo" className={buttonVariants()}>
                <Plus aria-hidden />
                Novo produto
              </Link>
            ) : null}
          </>
        }
      />
      <CatalogTabs active="products" />

      <Card className="overflow-hidden">
        <form method="get" action={PATH} role="search" className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <div className="relative min-w-56 flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" name="q" defaultValue={params.q} placeholder="Buscar por SKU, descrição, sinônimo ou código do fabricante" aria-label="Buscar produtos" className="h-8 pl-8 text-[13px]" />
          </div>
          <AutoSubmitSelect name="categoria" defaultValue={params.categoria ?? ""} aria-label="Categoria" className="h-8 w-44 text-[13px]">
            <option value="">Todas as categorias</option>
            {facets.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </AutoSubmitSelect>
          <AutoSubmitSelect name="fabricante" defaultValue={params.fabricante ?? ""} aria-label="Fabricante" className="h-8 w-44 text-[13px]">
            <option value="">Todos os fabricantes</option>
            {facets.manufacturers.map((manufacturer) => (
              <option key={manufacturer} value={manufacturer}>
                {manufacturer}
              </option>
            ))}
          </AutoSubmitSelect>
          <AutoSubmitSelect name="status" defaultValue={status} aria-label="Situação" className="h-8 w-32 text-[13px]">
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
            <option value="all">Todos</option>
          </AutoSubmitSelect>
          <Button type="submit" variant="outline" size="sm">
            Filtrar
          </Button>
          {hasFilters ? (
            <Link href={PATH} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Limpar
            </Link>
          ) : null}
        </form>

        {result.items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>SKU</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Fabricante</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Un.</TableHead>
                <TableHead className="text-right">Preço de catálogo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{product.sku}</TableCell>
                  <TableCell className="max-w-md">
                    <Link href={`/catalogo/${product.id}`} className="font-medium underline-offset-4 hover:underline">
                      {product.description}
                    </Link>
                    {!product.isActive ? (
                      <Badge variant="outline" className="ml-2 align-middle">
                        Inativo
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {product.manufacturer ?? "—"}
                    {product.manufacturerCode ? <span className="block font-mono text-xs">{product.manufacturerCode}</span> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{product.category ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{product.unit}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {product.price === null ? <span className="text-muted-foreground">sem preço</span> : formatCurrency(product.price, { precise: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : hasFilters ? (
          <EmptyState icon={Search} title="Nenhum produto encontrado" description="Ajuste a busca ou limpe os filtros." />
        ) : (
          <EmptyState
            icon={Package}
            title="O catálogo está vazio"
            description="Importe uma planilha de produtos (CSV ou Excel) ou cadastre os produtos manualmente."
            action={
              can(ctx, "catalog:import") ? (
                <Link href="/catalogo/importar" className={buttonVariants()}>
                  <FileUp aria-hidden />
                  Importar planilha
                </Link>
              ) : null
            }
          />
        )}

        <Pagination pathname={PATH} searchParams={filters} page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} noun={["produto", "produtos"]} />
      </Card>
    </PageContainer>
  );
}
