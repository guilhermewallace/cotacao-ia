import { LinkTabs } from "@/components/page";

export function CatalogTabs({ active }: { active: "products" | "price-lists" | "duplicates" }) {
  return (
    <LinkTabs
      label="Seções do catálogo"
      className="mb-4"
      items={[
        { href: "/catalogo", label: "Produtos", active: active === "products" },
        { href: "/catalogo/listas-de-precos", label: "Listas de preços", active: active === "price-lists" },
        { href: "/catalogo/duplicidades", label: "Duplicidades", active: active === "duplicates" },
      ]}
    />
  );
}
