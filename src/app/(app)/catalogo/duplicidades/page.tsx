import type { Metadata } from "next";
import Link from "next/link";
import { CopyCheck } from "lucide-react";
import { EmptyState, PageContainer, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { findDuplicateGroups } from "@/modules/catalog/products";
import { requirePage } from "@/server/session";
import { CatalogTabs } from "../catalog-tabs";

export const metadata: Metadata = { title: "Duplicidades do catálogo" };

export default async function DuplicatesPage() {
  const { ctx } = await requirePage("catalog:read");
  const groups = await findDuplicateGroups(ctx, 50);

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo"
        description="Produtos possivelmente duplicados: mesmo código de fabricante ou descrições quase idênticas. Duplicidades tornam as sugestões ambíguas."
      />
      <CatalogTabs active="duplicates" />
      {groups.length === 0 ? (
        <Card>
          <EmptyState icon={CopyCheck} title="Nenhuma duplicidade encontrada" description="Não há produtos ativos com o mesmo código de fabricante nem com descrições quase idênticas." />
        </Card>
      ) : (
        <ul className="grid gap-3">
          {groups.map((group, index) => (
            <li key={`${group.reason}-${index}`}>
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5">
                  <Badge variant="warning">{group.reason === "MANUFACTURER_CODE" ? "Mesmo código de fabricante" : "Descrições muito parecidas"}</Badge>
                  <span className="text-[13px] text-muted-foreground">{group.detail}</span>
                </div>
                <ul className="divide-y">
                  {group.products.map((product) => (
                    <li key={product.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px]">
                      <span className="w-36 shrink-0 font-mono text-xs">{product.sku}</span>
                      <Link href={`/catalogo/${product.id}`} className="min-w-0 flex-1 font-medium underline-offset-4 hover:underline">
                        {product.description}
                      </Link>
                      <span className="text-muted-foreground">{product.manufacturer ?? "—"}</span>
                      {!product.isActive ? <Badge variant="outline">Inativo</Badge> : null}
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
