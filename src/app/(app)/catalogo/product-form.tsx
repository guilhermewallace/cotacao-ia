"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, Save, X } from "lucide-react";
import { ActionButton } from "@/components/client/action-button";
import { DecimalInput } from "@/components/client/decimal-input";
import { useAction } from "@/components/client/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { addProductAliasAction, createProductAction, removeProductAliasAction, setProductActiveAction, updateProductAction } from "./actions";

export interface ProductFormValues {
  id?: string;
  sku: string;
  description: string;
  manufacturer: string;
  manufacturerCode: string;
  category: string;
  unit: string;
  price: number | null;
  isActive: boolean;
}

const UNITS = ["UN", "PC", "M", "CX", "RL", "KG", "CJ", "PAR", "L"];

export function ProductForm({ initial, categories, manufacturers, readOnly }: { initial: ProductFormValues; categories: string[]; manufacturers: string[]; readOnly: boolean }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [values, setValues] = React.useState(initial);
  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const isNew = !initial.id;
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const valid = values.sku.trim().length > 0 && values.description.trim().length >= 3 && values.unit.trim().length > 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;
    const input = {
      sku: values.sku,
      description: values.description,
      manufacturer: values.manufacturer || null,
      manufacturerCode: values.manufacturerCode || null,
      category: values.category || null,
      unit: values.unit,
      price: values.price,
      isActive: values.isActive,
    };
    if (initial.id) {
      const id = initial.id;
      run(() => updateProductAction(id, input), { success: "Produto atualizado." });
    } else {
      run(() => createProductAction(input), { success: "Produto criado.", onSuccess: (data) => router.push(`/catalogo/${data.id}`) });
    }
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Dados do produto</CardTitle>
            <CardDescription>Os atributos técnicos (corrente, tensão, polos, seção…) são identificados automaticamente a partir da descrição.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-6">
          <Field label="SKU / código interno" htmlFor="sku" className="sm:col-span-2">
            <Input id="sku" value={values.sku} maxLength={60} required disabled={readOnly} onChange={(event) => set("sku", event.target.value)} className="font-mono" />
          </Field>
          <Field label="Descrição" htmlFor="description" className="sm:col-span-4" hint="Ex.: Disjuntor DIN tripolar 40A curva C 6kA">
            <Input id="description" value={values.description} maxLength={300} required disabled={readOnly} onChange={(event) => set("description", event.target.value)} />
          </Field>
          <Field label="Fabricante" htmlFor="manufacturer" className="sm:col-span-2">
            <Input id="manufacturer" list="manufacturers" value={values.manufacturer} maxLength={100} disabled={readOnly} onChange={(event) => set("manufacturer", event.target.value)} />
            <datalist id="manufacturers">
              {manufacturers.map((manufacturer) => (
                <option key={manufacturer} value={manufacturer} />
              ))}
            </datalist>
          </Field>
          <Field label="Código do fabricante" htmlFor="manufacturer-code" className="sm:col-span-2">
            <Input id="manufacturer-code" value={values.manufacturerCode} maxLength={80} disabled={readOnly} onChange={(event) => set("manufacturerCode", event.target.value)} className="font-mono" />
          </Field>
          <Field label="Categoria" htmlFor="category" className="sm:col-span-2">
            <Input id="category" list="categories" value={values.category} maxLength={100} disabled={readOnly} onChange={(event) => set("category", event.target.value)} />
            <datalist id="categories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </Field>
          <Field label="Unidade de medida" htmlFor="unit" className="sm:col-span-2">
            <Input id="unit" list="units" value={values.unit} maxLength={12} required disabled={readOnly} onChange={(event) => set("unit", event.target.value.toUpperCase())} />
            <datalist id="units">
              {UNITS.map((unit) => (
                <option key={unit} value={unit} />
              ))}
            </datalist>
          </Field>
          <Field label="Preço de catálogo (R$)" htmlFor="price" className="sm:col-span-2" hint="Opcional. Listas de preços têm prioridade sobre este valor.">
            <DecimalInput id="price" money commitOnChange value={values.price} disabled={readOnly} placeholder="sem preço" className="text-left" onCommit={(value) => set("price", value)} />
          </Field>
          <Field label="Situação" htmlFor="active" className="sm:col-span-2" hint="Produtos inativos não são sugeridos.">
            <Select id="active" value={values.isActive ? "1" : "0"} disabled={readOnly} onChange={(event) => set("isActive", event.target.value === "1")}>
              <option value="1">Ativo</option>
              <option value="0">Inativo</option>
            </Select>
          </Field>
        </CardContent>
        {readOnly ? null : (
          <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
            {!isNew && dirty ? (
              <Button type="button" variant="ghost" onClick={() => setValues(initial)} disabled={pending}>
                Descartar alterações
              </Button>
            ) : null}
            <Button type="submit" disabled={!valid || pending || (!isNew && !dirty)} aria-busy={pending}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
              {isNew ? "Criar produto" : "Salvar"}
            </Button>
          </div>
        )}
      </Card>
    </form>
  );
}

export interface AliasView {
  id: string;
  type: "SYNONYM" | "MANUFACTURER_CODE";
  value: string;
  manufacturer: string | null;
}

/** Sinônimos (como os clientes chamam o produto) e códigos equivalentes de fabricantes. */
export function AliasManager({ productId, aliases, readOnly }: { productId: string; aliases: AliasView[]; readOnly: boolean }) {
  const { pending, run } = useAction();
  const [type, setType] = React.useState<AliasView["type"]>("SYNONYM");
  const [value, setValue] = React.useState("");
  const [manufacturer, setManufacturer] = React.useState("");
  const groups = [
    { type: "SYNONYM" as const, title: "Sinônimos", empty: "Nenhum sinônimo cadastrado." },
    { type: "MANUFACTURER_CODE" as const, title: "Códigos de fabricante equivalentes", empty: "Nenhum código adicional." },
  ];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (value.trim().length < 2 || pending) return;
    run(() => addProductAliasAction(productId, { type, value: value.trim(), manufacturer: type === "MANUFACTURER_CODE" ? manufacturer.trim() || null : null }), {
      onSuccess: () => {
        setValue("");
        setManufacturer("");
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Sinônimos e códigos</CardTitle>
          <CardDescription>Termos e códigos pelos quais este produto também é pedido. Melhoram a identificação nas solicitações.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {groups.map((group) => {
          const items = aliases.filter((alias) => alias.type === group.type);
          return (
            <div key={group.type}>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{group.title}</p>
              {items.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{group.empty}</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {items.map((alias) => (
                    <li key={alias.id}>
                      <Badge variant="neutral" className="gap-1.5 py-1 text-[13px] font-normal">
                        <span className={group.type === "MANUFACTURER_CODE" ? "font-mono" : undefined}>{alias.value}</span>
                        {alias.manufacturer ? <span className="text-muted-foreground">({alias.manufacturer})</span> : null}
                        {readOnly ? null : (
                          <button
                            type="button"
                            disabled={pending}
                            aria-label={`Remover ${alias.value}`}
                            className="rounded text-muted-foreground hover:text-danger"
                            onClick={() => run(() => removeProductAliasAction(productId, alias.id))}
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {readOnly ? null : (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border-t pt-4">
            <Field label="Tipo" htmlFor="alias-type">
              <Select id="alias-type" value={type} onChange={(event) => setType(event.target.value as AliasView["type"])} className="w-48">
                <option value="SYNONYM">Sinônimo</option>
                <option value="MANUFACTURER_CODE">Código de fabricante</option>
              </Select>
            </Field>
            <Field label={type === "SYNONYM" ? "Termo" : "Código"} htmlFor="alias-value" className="min-w-48 flex-1">
              <Input id="alias-value" value={value} maxLength={160} onChange={(event) => setValue(event.target.value)} placeholder={type === "SYNONYM" ? "Ex.: minidisjuntor 3P 40A" : "Ex.: ABC-12345"} />
            </Field>
            {type === "MANUFACTURER_CODE" ? (
              <Field label="Fabricante (opcional)" htmlFor="alias-manufacturer">
                <Input id="alias-manufacturer" value={manufacturer} maxLength={100} onChange={(event) => setManufacturer(event.target.value)} className="w-40" />
              </Field>
            ) : null}
            <Button type="submit" variant="outline" disabled={pending || value.trim().length < 2}>
              <Plus aria-hidden />
              Adicionar
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function ToggleActiveButton({ productId, isActive }: { productId: string; isActive: boolean }) {
  return (
    <ActionButton variant="outline" action={() => setProductActiveAction(productId, !isActive)} success={isActive ? "Produto inativado." : "Produto reativado."}>
      {isActive ? "Inativar" : "Reativar"}
    </ActionButton>
  );
}
