"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";
import { ActionButton } from "@/components/client/action-button";
import { DecimalInput } from "@/components/client/decimal-input";
import { useAction } from "@/components/client/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPriceListAction, setDefaultPriceListAction, setPriceListActiveAction, setPriceListItemAction } from "../actions";

export function CreatePriceListForm() {
  const router = useRouter();
  const { pending, run } = useAction();
  const [name, setName] = React.useState("");
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim().length < 2 || pending) return;
        run(() => createPriceListAction({ name: name.trim() }), { success: "Lista de preços criada.", onSuccess: (data) => router.push(`/catalogo/listas-de-precos/${data.id}`) });
      }}
    >
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome da nova lista (ex.: Revendas 2026)" aria-label="Nome da nova lista de preços" maxLength={100} className="w-72" />
      <Button type="submit" disabled={pending || name.trim().length < 2}>
        {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Plus aria-hidden />}
        Criar lista
      </Button>
    </form>
  );
}

export function PriceListRowActions({ id, isDefault, isActive }: { id: string; isDefault: boolean; isActive: boolean }) {
  return (
    <div className="flex items-center justify-end gap-1">
      {!isDefault && isActive ? (
        <ActionButton variant="ghost" size="xs" action={() => setDefaultPriceListAction(id)} success="Lista padrão alterada.">
          Tornar padrão
        </ActionButton>
      ) : null}
      {!isDefault ? (
        <ActionButton variant="ghost" size="xs" action={() => setPriceListActiveAction(id, !isActive)} success={isActive ? "Lista desativada." : "Lista ativada."}>
          {isActive ? "Desativar" : "Ativar"}
        </ActionButton>
      ) : null}
    </div>
  );
}

/** Preço de um produto na lista: grava ao sair do campo; vazio remove o produto da lista. */
export function PriceCell({ priceListId, productId, unitPrice, label, disabled }: { priceListId: string; productId: string; unitPrice: string; label: string; disabled: boolean }) {
  const { pending, run } = useAction();
  return (
    <DecimalInput
      value={unitPrice}
      money
      aria-label={label}
      disabled={disabled || pending}
      className="ml-auto h-8 w-28"
      onCommit={(value) => run(() => setPriceListItemAction(priceListId, productId, value), { success: value === null ? "Produto removido da lista." : "Preço atualizado." })}
    />
  );
}
