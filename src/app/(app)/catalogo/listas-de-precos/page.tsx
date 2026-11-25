import type { Metadata } from "next";
import Link from "next/link";
import { Tags } from "lucide-react";
import { EmptyState, PageContainer, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInteger } from "@/lib/format";
import { listPriceLists } from "@/modules/catalog/price-lists";
import { can } from "@/modules/identity/permissions";
import { formatDate } from "@/platform/dates";
import { requirePage } from "@/server/session";
import { CatalogTabs } from "../catalog-tabs";
import { CreatePriceListForm, PriceListRowActions } from "./price-list-controls";

export const metadata: Metadata = { title: "Listas de preços" };

export default async function PriceListsPage() {
  const { ctx } = await requirePage("catalog:read");
  const lists = await listPriceLists(ctx);
  const canWrite = can(ctx, "catalog:write");

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo"
        description="Listas de preços por perfil de cliente. Os preços das cotações vêm exclusivamente destas listas ou do preço de catálogo — nunca são estimados."
        actions={canWrite ? <CreatePriceListForm /> : null}
      />
      <CatalogTabs active="price-lists" />
      <Card className="overflow-hidden">
        {lists.length === 0 ? (
          <EmptyState icon={Tags} title="Nenhuma lista de preços" description="Crie uma lista e importe os preços por planilha, ou use apenas o preço de catálogo dos produtos." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Lista</TableHead>
                <TableHead className="text-right">Produtos com preço</TableHead>
                <TableHead className="text-right">Clientes vinculados</TableHead>
                <TableHead>Vigência</TableHead>
                <TableHead>Atualizada em</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((list) => (
                <TableRow key={list.id}>
                  <TableCell>
                    <Link href={`/catalogo/listas-de-precos/${list.id}`} className="font-medium underline-offset-4 hover:underline">
                      {list.name}
                    </Link>
                    <span className="ml-2 inline-flex gap-1 align-middle">
                      {list.isDefault ? <Badge variant="info">Padrão</Badge> : null}
                      {!list.isActive ? <Badge variant="outline">Inativa</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatInteger(list.itemCount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInteger(list.customerCount)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {list.validFrom || list.validUntil ? `${list.validFrom ? formatDate(list.validFrom) : "…"} a ${list.validUntil ? formatDate(list.validUntil) : "…"}` : "Sem prazo"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(list.updatedAt)}</TableCell>
                  <TableCell>{canWrite ? <PriceListRowActions id={list.id} isDefault={list.isDefault} isActive={list.isActive} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageContainer>
  );
}
