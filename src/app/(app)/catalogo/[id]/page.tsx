import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { IdPageProps } from "@/lib/params";
import { getProduct, listProductFacets } from "@/modules/catalog/products";
import { can } from "@/modules/identity/permissions";
import { describeAttributes } from "@/modules/normalization/attributes";
import { isAppError } from "@/platform/errors";
import { isUuid } from "@/platform/ids";
import { requirePage } from "@/server/session";
import { AliasManager, ProductForm, ToggleActiveButton } from "../product-form";

export const metadata: Metadata = { title: "Produto" };

export default async function ProductPage({ params }: IdPageProps) {
  const { ctx } = await requirePage("catalog:read");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [product, facets] = await Promise.all([
    getProduct(ctx, id).catch((error: unknown) => {
      if (isAppError(error) && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
    listProductFacets(ctx),
  ]);
  const canWrite = can(ctx, "catalog:write");
  const attributes = describeAttributes(product.attributes);

  return (
    <PageContainer>
      <PageHeader
        back={{ href: "/catalogo", label: "Catálogo" }}
        title={product.description}
        meta={
          <>
            <span className="font-mono text-[13px] text-muted-foreground">{product.sku}</span>
            <Badge variant={product.isActive ? "success" : "outline"}>{product.isActive ? "Ativo" : "Inativo"}</Badge>
          </>
        }
        actions={canWrite ? <ToggleActiveButton productId={product.id} isActive={product.isActive} /> : null}
      />

      <div className="grid gap-4">
        <ProductForm
          key={product.updatedAt.toISOString()}
          initial={{
            id: product.id,
            sku: product.sku,
            description: product.description,
            manufacturer: product.manufacturer ?? "",
            manufacturerCode: product.manufacturerCode ?? "",
            category: product.category ?? "",
            unit: product.unit,
            price: product.price === null ? null : Number(product.price),
            isActive: product.isActive,
          }}
          categories={facets.categories}
          manufacturers={facets.manufacturers}
          readOnly={!canWrite}
        />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Atributos técnicos</CardTitle>
              <CardDescription>
                Usados para validar a compatibilidade: um produto só é sugerido quando os atributos críticos do pedido conferem (ex.: 32 A nunca é confundido com 40 A).
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {attributes.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {attributes.map((attribute) => (
                  <li key={attribute.key}>
                    <Badge variant="outline" className="py-1 text-[13px] font-normal">
                      <span className="text-muted-foreground">{attribute.label}:</span> <span className="text-foreground">{attribute.value}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">Nenhum atributo técnico foi identificado na descrição. Descrições mais completas melhoram as sugestões.</p>
            )}
          </CardContent>
        </Card>

        <AliasManager productId={product.id} aliases={product.aliases} readOnly={!canWrite} />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Preços em listas</CardTitle>
              <CardDescription>A lista do cliente tem prioridade; depois a lista padrão; por último o preço de catálogo.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {product.priceListPrices.length > 0 ? (
              <ul className="divide-y rounded-lg border">
                {product.priceListPrices.map((entry) => (
                  <li key={entry.priceListId} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                    <Link href={`/catalogo/listas-de-precos/${entry.priceListId}`} className="font-medium underline-offset-4 hover:underline">
                      {entry.priceListName}
                      {entry.isDefault ? (
                        <Badge variant="info" className="ml-2">
                          Padrão
                        </Badge>
                      ) : null}
                    </Link>
                    <span className="tabular-nums">{formatCurrency(entry.unitPrice, { precise: true })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">Este produto não está em nenhuma lista de preços.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
