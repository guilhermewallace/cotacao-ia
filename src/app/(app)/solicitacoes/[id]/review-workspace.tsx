"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, FileOutput, LoaderCircle, Plus } from "lucide-react";
import { ConfirmActionButton } from "@/components/client/action-button";
import { DecimalInput } from "@/components/client/decimal-input";
import { useAction } from "@/components/client/use-action";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Kbd } from "@/components/ui/misc";
import { formatCurrency } from "@/lib/format";
import type { RequestDetail } from "@/modules/requests/queries";
import {
  acceptSuggestedItemsAction,
  addManualItemAction,
  confirmItemAction,
  createQuotationAction,
  markItemNotFoundAction,
  setRequestCustomerAction,
} from "./actions";
import { ItemCard } from "./item-card";
import { SourcePanel } from "./source-panel";

type Detail = Pick<RequestDetail, "id" | "status" | "items" | "attachments" | "message" | "customer" | "customerHint" | "progress">;

interface Props {
  detail: Detail;
  customers: Array<{ id: string; name: string; priceListName: string | null }>;
  canReview: boolean;
  canQuote: boolean;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || Boolean(target.closest("[role=dialog],[cmdk-root]"));
}

export function ReviewWorkspace({ detail, customers, canReview, canQuote }: Props) {
  const router = useRouter();
  const { items, progress } = detail;
  const editable = canReview && detail.status === "AWAITING_REVIEW";
  const [activeId, setActiveId] = React.useState<string | null>(() => (items.find((item) => item.status === "PENDING") ?? items[0])?.id ?? null);
  const itemRefs = React.useRef(new Map<string, HTMLLIElement>());
  const shortcut = useAction();
  const quotation = useAction();
  const customer = useAction();

  const active = items.find((item) => item.id === activeId) ?? null;
  const strongPending = items.filter((item) => item.status === "PENDING" && item.matchOutcome === "SUGGESTED" && item.candidates.length > 0).length;
  const estimatedTotal = items.reduce((sum, item) => {
    if (item.status !== "CONFIRMED" || item.quantity === null || item.unitPrice === null) return sum;
    return sum + Math.round(Number(item.quantity) * Number(item.unitPrice) * 100) / 100;
  }, 0);
  const missingQuantity = items.filter((item) => item.status === "CONFIRMED" && item.quantity === null).length;
  const readyToQuote = progress.pending === 0 && progress.confirmed > 0 && missingQuantity === 0;

  // Quando o item ativo acaba de ser decidido (um a um ou em lote), segue para o próximo pendente.
  // Calculado durante a renderização, com os dados já atualizados pelo servidor.
  const activeStatus = active?.status ?? null;
  const [tracked, setTracked] = React.useState({ id: activeId, status: activeStatus });
  if (tracked.id !== activeId || tracked.status !== activeStatus) {
    setTracked({ id: activeId, status: activeStatus });
    if (tracked.id === activeId && tracked.status === "PENDING" && activeStatus !== "PENDING") {
      const index = items.findIndex((item) => item.id === activeId);
      const next = [...items.slice(index + 1), ...items.slice(0, Math.max(index, 0))].find((item) => item.status === "PENDING");
      if (next) setActiveId(next.id);
    }
  }

  // Mantém o item ativo visível quando ele MUDA (não rola a página se ele já estiver na tela).
  // Na abertura da tela nada é rolado: em telas pequenas o cabeçalho e o documento vêm primeiro.
  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (activeId) itemRefs.current.get(activeId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  // Atalhos de teclado para revisar sem tirar a mão do teclado.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || items.length === 0) return;
      const index = items.findIndex((item) => item.id === activeId);
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        event.preventDefault();
        const target = items[Math.min(items.length - 1, Math.max(0, index + (key === "j" ? 1 : -1)))];
        if (target) setActiveId(target.id);
        return;
      }
      const current = items[index];
      if (!editable || !current || current.status !== "PENDING" || shortcut.pending) return;
      if (key === "a" && current.candidates[0]) {
        event.preventDefault();
        const productId = current.candidates[0].productId;
        shortcut.run(() => confirmItemAction(current.id, productId));
      } else if (key === "n") {
        event.preventDefault();
        shortcut.run(() => markItemNotFoundAction(current.id));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, editable, items, shortcut]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="h-[55vh] min-w-0 lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)]">
        <SourcePanel detail={detail} focus={active} />
      </div>

      <section aria-label="Itens solicitados" className="min-w-0">
        {/* Barra de revisão: cliente, progresso e ações em lote */}
        <div className="mb-3 rounded-xl border bg-card px-4 py-3 shadow-xs">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <label className="grid min-w-56 flex-1 gap-1.5 text-[13px] font-medium">
              Cliente
              <Select
                value={detail.customer?.id ?? ""}
                disabled={!editable || customer.pending}
                onChange={(event) => {
                  const value = event.target.value || null;
                  customer.run(() => setRequestCustomerAction(detail.id, value), {
                    success: value ? "Cliente definido. Preços recalculados pela lista do cliente." : "Cliente removido. Preços recalculados.",
                  });
                }}
              >
                <option value="">Não identificado</option>
                {customers.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                    {option.priceListName ? ` — ${option.priceListName}` : ""}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {editable && strongPending > 0 ? (
                <ConfirmActionButton
                  variant="outline"
                  action={() => acceptSuggestedItemsAction(detail.id)}
                  success={(data) => (data.confirmed === 1 ? "1 item confirmado." : `${data.confirmed} itens confirmados.`)}
                  title={`Aceitar ${strongPending} ${strongPending === 1 ? "sugestão forte" : "sugestões fortes"}?`}
                  description="Confirma o primeiro candidato de cada item pendente classificado como “sugestão forte”. Itens ambíguos ou sem correspondência não são alterados — esses você decide um a um."
                  confirmLabel="Aceitar sugestões"
                >
                  <CheckCheck aria-hidden />
                  Aceitar sugestões fortes ({strongPending})
                </ConfirmActionButton>
              ) : null}
              {canQuote && detail.status === "AWAITING_REVIEW" ? (
                <Button
                  disabled={!readyToQuote || quotation.pending}
                  aria-busy={quotation.pending}
                  title={readyToQuote ? undefined : "Decida todos os itens e informe as quantidades para gerar a cotação"}
                  onClick={() => quotation.run(() => createQuotationAction(detail.id), { onSuccess: (data) => router.push(`/cotacoes/${data.id}`) })}
                >
                  {quotation.pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <FileOutput aria-hidden />}
                  Gerar cotação
                </Button>
              ) : null}
            </div>
          </div>

          {!detail.customer && detail.customerHint && (detail.customerHint.name || detail.customerHint.taxId || detail.customerHint.email) ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No documento:{" "}
              {[detail.customerHint.name, detail.customerHint.taxId ? `CNPJ/CPF ${detail.customerHint.taxId}` : null, detail.customerHint.contactName, detail.customerHint.email, detail.customerHint.phone]
                .filter(Boolean)
                .join(" · ")}
              . Selecione o cliente correspondente ou cadastre-o em Clientes.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-[13px]">
            <div
              className="flex h-1.5 w-40 gap-0.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.total - progress.pending}
              aria-label="Progresso da revisão"
            >
              {progress.total > 0 ? <div className="bg-primary" style={{ width: `${((progress.total - progress.pending) / progress.total) * 100}%` }} /> : null}
            </div>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">
                {progress.total - progress.pending} de {progress.total}
              </span>{" "}
              revisados · {progress.confirmed} {progress.confirmed === 1 ? "confirmado" : "confirmados"} · {progress.notFound} não{" "}
              {progress.notFound === 1 ? "encontrado" : "encontrados"} · {progress.pending} {progress.pending === 1 ? "pendente" : "pendentes"}
            </p>
            {progress.confirmed > 0 ? (
              <p className="ml-auto text-muted-foreground">
                Total parcial <span className="font-semibold text-foreground tabular-nums">{formatCurrency(estimatedTotal)}</span>
              </p>
            ) : null}
          </div>
          {missingQuantity > 0 && progress.pending === 0 ? (
            <p className="mt-2 text-xs text-warning">
              Informe a quantidade de {missingQuantity} {missingQuantity === 1 ? "item confirmado" : "itens confirmados"} para gerar a cotação.
            </p>
          ) : null}
        </div>

        {editable && items.length > 0 ? (
          <p className="mb-2 hidden items-center gap-1.5 px-1 text-xs text-muted-foreground lg:flex">
            Atalhos: <Kbd>J</Kbd>
            <Kbd>K</Kbd> navegar · <Kbd>A</Kbd> aceitar 1º candidato · <Kbd>N</Kbd> não encontrado
          </p>
        ) : null}

        {items.length > 0 ? (
          <ol className="grid gap-3">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                ref={(element) => {
                  if (element) itemRefs.current.set(item.id, element);
                  else itemRefs.current.delete(item.id);
                }}
                item={item}
                requestId={detail.id}
                editable={editable}
                active={item.id === activeId}
                onActivate={() => setActiveId(item.id)}
              />
            ))}
          </ol>
        ) : (
          <p className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-[13px] text-muted-foreground">
            Nenhum item foi identificado neste documento.
            {editable ? " Adicione os itens manualmente abaixo ou descarte a solicitação." : ""}
          </p>
        )}

        {editable ? <AddItemForm requestId={detail.id} onAdded={setActiveId} /> : null}
      </section>
    </div>
  );
}

function AddItemForm({ requestId, onAdded }: { requestId: string; onAdded: (id: string) => void }) {
  const { pending, run } = useAction();
  const [description, setDescription] = React.useState("");
  const [quantity, setQuantity] = React.useState<number | null>(null);
  const [unit, setUnit] = React.useState("");
  const [formKey, setFormKey] = React.useState(0);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (description.trim().length < 3 || pending) return;
    run(() => addManualItemAction(requestId, { description: description.trim(), quantity, unit: unit.trim() || null }), {
      success: "Item adicionado. As sugestões do catálogo já foram calculadas.",
      onSuccess: (data) => {
        setDescription("");
        setQuantity(null);
        setUnit("");
        setFormKey((key) => key + 1);
        setTimeout(() => onAdded(data.id), 150);
      },
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-dashed bg-card px-4 py-3">
      <p className="mb-2 text-[13px] font-medium">Adicionar item que a extração não captou</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Descrição como no pedido (ex.: disjuntor tripolar 40A curva C)"
          aria-label="Descrição do item"
          maxLength={500}
          className="h-8 min-w-64 flex-1"
        />
        <DecimalInput key={formKey} value={quantity} onCommit={setQuantity} fractionDigits={3} placeholder="Qtd." aria-label="Quantidade" className="h-8 w-20" />
        <Input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="un" aria-label="Unidade" maxLength={12} className="h-8 w-16" />
        <Button type="submit" variant="outline" size="sm" disabled={pending || description.trim().length < 3}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Plus aria-hidden />}
          Adicionar
        </Button>
      </div>
    </form>
  );
}
