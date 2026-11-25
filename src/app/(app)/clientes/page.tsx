import type { Metadata } from "next";
import { Plus, Search, Users } from "lucide-react";
import { EmptyState, PageContainer, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPhone, formatTaxId } from "@/lib/format";
import { readSearchParams, type SearchPageProps } from "@/lib/params";
import { listPriceLists } from "@/modules/catalog/price-lists";
import { listCustomers } from "@/modules/customers/customers";
import { can } from "@/modules/identity/permissions";
import { requirePage } from "@/server/session";
import { CustomerDialog, EMPTY_CUSTOMER } from "./customer-dialog";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: SearchPageProps) {
  const { ctx } = await requirePage("customer:read");
  const params = await readSearchParams(searchParams);
  const canWrite = can(ctx, "customer:write");
  const [customers, priceLists] = await Promise.all([
    listCustomers(ctx, { query: params.q, limit: 300 }),
    canWrite ? listPriceLists(ctx) : Promise.resolve([]),
  ]);
  const listOptions = priceLists.filter((list) => list.isActive).map((list) => ({ id: list.id, name: list.name, isDefault: list.isDefault }));

  return (
    <PageContainer>
      <PageHeader
        title="Clientes"
        description="Cadastro simples de clientes para identificar remetentes e aplicar a lista de preços correta nas cotações."
        actions={
          canWrite ? (
            <CustomerDialog initial={EMPTY_CUSTOMER} priceLists={listOptions}>
              <Button>
                <Plus aria-hidden />
                Novo cliente
              </Button>
            </CustomerDialog>
          ) : null
        }
      />
      <Card className="overflow-hidden">
        <form method="get" action="/clientes" role="search" className="border-b px-3 py-2.5">
          <div className="relative max-w-sm">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" name="q" defaultValue={params.q} placeholder="Buscar por nome, CNPJ, e-mail ou telefone" aria-label="Buscar clientes" className="h-8 pl-8 text-[13px]" />
          </div>
        </form>
        {customers.length === 0 ? (
          params.q ? (
            <EmptyState icon={Search} title="Nenhum cliente encontrado" description="Tente outro termo de busca." />
          ) : (
            <EmptyState icon={Users} title="Nenhum cliente cadastrado" description="Cadastre clientes para que as solicitações sejam associadas automaticamente pelo e-mail ou telefone do remetente." />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Cliente</TableHead>
                <TableHead>CNPJ / CPF</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Lista de preços</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="max-w-72">
                    <span className="font-medium">{customer.name}</span>
                    {customer.legalName ? <span className="block truncate text-xs text-muted-foreground">{customer.legalName}</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{formatTaxId(customer.taxId)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.contactName ?? "—"}
                    <span className="block text-xs">
                      {[customer.email, customer.phone ? formatPhone(customer.phone) : null].filter(Boolean).join(" · ")}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{customer.priceListName ?? "Padrão"}</TableCell>
                  <TableCell className="text-right">
                    {canWrite ? (
                      <CustomerDialog
                        initial={{
                          id: customer.id,
                          name: customer.name,
                          legalName: customer.legalName ?? "",
                          taxId: customer.taxId ?? "",
                          email: customer.email ?? "",
                          phone: customer.phone ?? "",
                          contactName: customer.contactName ?? "",
                          notes: customer.notes ?? "",
                          priceListId: customer.priceListId ?? "",
                        }}
                        priceLists={listOptions}
                      >
                        <Button variant="ghost" size="xs">
                          Editar
                        </Button>
                      </CustomerDialog>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageContainer>
  );
}
