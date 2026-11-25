import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/page";
import { listProductFacets } from "@/modules/catalog/products";
import { requirePage } from "@/server/session";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Novo produto" };

export default async function NewProductPage() {
  const { ctx } = await requirePage("catalog:write");
  const facets = await listProductFacets(ctx);
  return (
    <PageContainer>
      <PageHeader back={{ href: "/catalogo", label: "Catálogo" }} title="Novo produto" />
      <ProductForm
        initial={{ sku: "", description: "", manufacturer: "", manufacturerCode: "", category: "", unit: "UN", price: null, isActive: true }}
        categories={facets.categories}
        manufacturers={facets.manufacturers}
        readOnly={false}
      />
    </PageContainer>
  );
}
