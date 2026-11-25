import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/page";
import { readSearchParams, type SearchPageProps } from "@/lib/params";
import { PRICE_LIST_FIELDS, PRODUCT_FIELDS } from "@/modules/catalog/import";
import { listPriceLists } from "@/modules/catalog/price-lists";
import { env } from "@/platform/env";
import { isUuid } from "@/platform/ids";
import { requirePage } from "@/server/session";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Importar catálogo" };

export default async function ImportPage({ searchParams }: SearchPageProps) {
  const { ctx } = await requirePage("catalog:import");
  const params = await readSearchParams(searchParams);
  const priceLists = (await listPriceLists(ctx)).filter((list) => list.isActive).map((list) => ({ id: list.id, name: list.name }));
  const requestedList = isUuid(params.lista) && priceLists.some((list) => list.id === params.lista) ? params.lista : null;

  return (
    <PageContainer>
      <PageHeader
        back={{ href: "/catalogo", label: "Catálogo" }}
        title="Importar planilha"
        description="Importe produtos ou preços em lote. Você confere o resultado antes de qualquer gravação."
      />
      <ImportWizard
        fields={{ products: PRODUCT_FIELDS.map((field) => ({ ...field })), price_list: PRICE_LIST_FIELDS.map((field) => ({ ...field })) }}
        priceLists={priceLists}
        initialTarget={params.tipo === "precos" || requestedList ? "price_list" : "products"}
        initialPriceListId={requestedList}
        maxFileMb={env().MAX_UPLOAD_MB}
      />
    </PageContainer>
  );
}
