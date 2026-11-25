"use client";

import * as React from "react";
import { Check, ChevronDown, CircleAlert, PenLine, RotateCcw, Search, SearchX, Trash2, X } from "lucide-react";
import { ConfirmActionButton } from "@/components/client/action-button";
import { DecimalInput } from "@/components/client/decimal-input";
import { ProductSearch } from "@/components/client/product-search";
import { useAction } from "@/components/client/use-action";
import { ItemStatusBadge, MatchOutcomeBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { formatCurrency, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CandidateView, RequestItemView } from "@/modules/requests/queries";
import {
  confirmItemAction,
  markItemNotFoundAction,
  removeItemAction,
  reopenItemAction,
  searchCatalogAction,
  setItemPriceAction,
  updateItemQuantityAction,
} from "./actions";

const VISIBLE_CANDIDATES = 3;

function priceSourceText(item: RequestItemView): string {
  if (item.priceSource === "PRICE_LIST") return item.catalogPriceListName ? `Lista de preços “${item.catalogPriceListName}”` : "Lista de preços";
  if (item.priceSource === "CATALOG") return "Preço de catálogo";
  if (item.priceSource === "MANUAL") return "Informado manualmente";
  return "Sem preço cadastrado";
}

function CandidateRow({
  candidate,
  primary,
  disabled,
  editable,
  onAccept,
}: {
  candidate: CandidateView;
  primary: boolean;
  disabled: boolean;
  editable: boolean;
  onAccept: () => void;
}) {
  return (
    <li className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2.5", primary && "border-primary/40 bg-primary/[0.03]")}>
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-[13px] leading-5 font-medium">{candidate.description}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{candidate.sku}</span>
          {candidate.manufacturer ? ` · ${candidate.manufacturer}` : ""}
        </p>
        {candidate.reasons.length > 0 ? (
          <ul className="mt-1.5 grid gap-0.5" aria-label="Por que foi sugerido">
            {candidate.reasons.slice(0, 5).map((reason) => (
              <li key={reason} className="flex items-start gap-1.5 text-xs leading-4 text-muted-foreground">
                <Check aria-hidden className="mt-0.5 size-3 shrink-0 text-success" />
                {reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[13px] leading-5 font-medium tabular-nums">
          {candidate.price === null ? <span className="font-normal text-muted-foreground">Sem preço</span> : formatCurrency(candidate.price, { precise: true })}
        </p>
        <p className="text-[11px] text-muted-foreground">
          por {candidate.unit}
          {candidate.priceListName ? ` · ${candidate.priceListName}` : ""}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">aderência {Math.round(candidate.score * 100)}%</p>
      </div>
      {editable ? (
        <Button size="sm" variant={primary ? "default" : "outline"} disabled={disabled} onClick={onAccept} className="shrink-0">
          <Check aria-hidden />
          {primary ? "Aceitar" : "Selecionar"}
        </Button>
      ) : null}
    </li>
  );
}

function RejectedRow({ candidate, itemId, editable }: { candidate: CandidateView; itemId: string; editable: boolean }) {
  const divergences = candidate.incompatibilities.map((entry) => `${entry.label}: pedido ${entry.requested} × produto ${entry.product ?? "não informado"}`);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-dashed px-3 py-2">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-[13px] leading-5 text-muted-foreground">{candidate.description}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{candidate.sku}</span>
          {candidate.manufacturer ? ` · ${candidate.manufacturer}` : ""}
        </p>
        <ul className="mt-1 grid gap-0.5">
          {divergences.map((text) => (
            <li key={text} className="flex items-start gap-1 text-xs text-danger">
              <X aria-hidden className="mt-0.5 size-3 shrink-0" />
              {text}
            </li>
          ))}
        </ul>
      </div>
      {editable ? (
        <ConfirmActionButton
          variant="ghost"
          size="xs"
          action={() => confirmItemAction(itemId, candidate.productId)}
          title="Selecionar produto com divergência técnica?"
          description={
            <>
              <span className="block font-medium text-foreground">{candidate.description}</span>
              <span className="mt-1 block">Este produto difere do que foi pedido:</span>
              <span className="mt-1 block text-danger">{divergences.join("; ")}</span>
              <span className="mt-2 block">A escolha ficará registrada na auditoria como decisão do revisor.</span>
            </>
          }
          confirmLabel="Selecionar mesmo assim"
        >
          Usar mesmo assim
        </ConfirmActionButton>
      ) : null}
    </li>
  );
}

export function ItemCard({
  item,
  requestId,
  editable,
  active,
  onActivate,
  ref,
}: {
  item: RequestItemView;
  requestId: string;
  editable: boolean;
  active: boolean;
  onActivate: () => void;
  ref?: React.Ref<HTMLLIElement>;
}) {
  const { pending, run } = useAction();
  const [showAll, setShowAll] = React.useState(false);
  const [showRejected, setShowRejected] = React.useState(false);
  const [unit, setUnit] = React.useState(item.unit ?? "");

  const quantityNumber = item.quantity === null ? null : Number(item.quantity);
  const lineTotal = quantityNumber !== null && item.unitPrice !== null ? Math.round(quantityNumber * Number(item.unitPrice) * 100) / 100 : null;
  const isPending = item.status === "PENDING";
  const visibleCandidates = showAll ? item.candidates : item.candidates.slice(0, VISIBLE_CANDIDATES);
  const search = React.useCallback((query: string) => searchCatalogAction(requestId, query), [requestId]);

  const confirm = (productId: string) => run(() => confirmItemAction(item.id, productId));
  const commitUnit = () => {
    const next = unit.trim();
    if (next === (item.unit ?? "")) return;
    run(() => updateItemQuantityAction(item.id, quantityNumber, next || null));
  };

  return (
    <li
      ref={ref}
      data-item-id={item.id}
      onFocusCapture={onActivate}
      onClick={onActivate}
      className={cn(
        "scroll-mt-4 rounded-xl border bg-card shadow-xs transition-shadow",
        active ? "border-ring/60 ring-[3px] ring-ring/15" : "",
        pending && "opacity-80",
      )}
      aria-current={active ? "true" : undefined}
    >
      {/* Cabeçalho: o que o cliente pediu, exatamente como veio */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 pt-3.5 pb-3">
        <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground tabular-nums">
          {item.lineNumber}
        </span>
        <div className="min-w-0 flex-1 basis-72">
          <p className="text-sm leading-5 font-medium break-words">
            <span className="sr-only">Item {item.lineNumber}: </span>
            {item.originalDescription}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {item.attributes.map((attribute) => (
              <Badge key={attribute.key} variant="outline" className="font-normal" title={attribute.label}>
                <span className="text-muted-foreground/80">{attribute.label}:</span> <span className="text-foreground">{attribute.value}</span>
              </Badge>
            ))}
            {item.manufacturer ? (
              <Badge variant="outline" className="font-normal">
                <span className="text-muted-foreground/80">Fabricante:</span> <span className="text-foreground">{item.manufacturer}</span>
              </Badge>
            ) : null}
            {item.manufacturerCode ? (
              <Badge variant="outline" className="font-normal">
                <span className="text-muted-foreground/80">Cód.:</span> <span className="font-mono text-foreground">{item.manufacturerCode}</span>
              </Badge>
            ) : null}
            {item.isManual ? <Badge variant="neutral">Adicionado manualmente</Badge> : null}
          </div>
          {item.notes ? (
            <p className="mt-1.5 flex items-start gap-1 text-xs text-warning">
              <CircleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
              {item.notes}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isPending ? <MatchOutcomeBadge outcome={item.matchOutcome} /> : <ItemStatusBadge status={item.status} />}
          {editable ? (
            <ConfirmActionButton
              variant="ghost"
              size="icon-xs"
              aria-label={`Remover item ${item.lineNumber}`}
              action={() => removeItemAction(item.id)}
              title="Remover este item?"
              description="O item deixa de fazer parte da solicitação e não constará na cotação. Use “Não encontrado” se quiser registrar que o item foi pedido mas não é atendido."
              confirmLabel="Remover item"
              destructive
            >
              <Trash2 aria-hidden />
            </ConfirmActionButton>
          ) : null}
        </div>
      </div>

      {/* Quantidade — nunca inventada: fica em branco se o pedido não informar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-2.5">
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          Quantidade
          {editable ? (
            <DecimalInput
              value={item.quantity}
              fractionDigits={3}
              aria-label={`Quantidade do item ${item.lineNumber}`}
              placeholder="—"
              className={cn("h-8 w-24", item.quantity === null && "border-warning")}
              disabled={pending}
              onCommit={(value) => run(() => updateItemQuantityAction(item.id, value, item.unit))}
            />
          ) : (
            <span className="font-medium text-foreground tabular-nums">{formatQuantity(item.quantity)}</span>
          )}
        </label>
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          Unidade
          {editable ? (
            <Input
              value={unit}
              maxLength={12}
              aria-label={`Unidade do item ${item.lineNumber}`}
              placeholder="un"
              className="h-8 w-16"
              disabled={pending}
              onChange={(event) => setUnit(event.target.value)}
              onBlur={commitUnit}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          ) : (
            <span className="font-medium text-foreground">{item.unit ?? "—"}</span>
          )}
        </label>
        {item.quantity === null ? (
          <p className="flex items-center gap-1 text-xs text-warning">
            <CircleAlert aria-hidden className="size-3" />
            O pedido não informa a quantidade.
          </p>
        ) : item.extractedQuantity !== null && Number(item.extractedQuantity) !== quantityNumber ? (
          <p className="text-xs text-muted-foreground">no documento: {formatQuantity(item.extractedQuantity)}</p>
        ) : null}
      </div>

      {/* Decisão */}
      <div className="border-t px-4 py-3">
        {item.status === "CONFIRMED" && item.selectedProduct ? (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1 basis-64">
              <p className="text-[13px] leading-5 font-medium">{item.selectedProduct.description}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{item.selectedProduct.sku}</span>
                {item.selectedProduct.manufacturer ? ` · ${item.selectedProduct.manufacturer}` : ""}
              </p>
            </div>
            <div className="shrink-0">
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                Preço unit.
                {editable ? (
                  <span className="relative">
                    <span aria-hidden className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-muted-foreground">
                      R$
                    </span>
                    <DecimalInput
                      value={item.unitPrice}
                      money
                      aria-label={`Preço unitário do item ${item.lineNumber}`}
                      placeholder="0,00"
                      className={cn("h-8 w-32 pl-7", item.unitPrice === null && "border-warning")}
                      disabled={pending}
                      onCommit={(value) => run(() => setItemPriceAction(item.id, value))}
                    />
                  </span>
                ) : (
                  <span className="font-medium text-foreground tabular-nums">{formatCurrency(item.unitPrice, { precise: true })}</span>
                )}
                <span className="text-xs">/ {item.selectedProduct.unit}</span>
              </label>
              <p className={cn("mt-1 text-xs", item.unitPrice === null ? "text-warning" : "text-muted-foreground")}>
                {item.unitPrice === null ? "Produto sem preço cadastrado — informe o preço." : priceSourceText(item)}
                {item.priceSource === "MANUAL" && item.catalogPrice !== null ? ` · catálogo: ${formatCurrency(item.catalogPrice, { precise: true })}` : ""}
              </p>
              {editable && item.priceSource === "MANUAL" && item.catalogPrice !== null ? (
                <button type="button" className="mt-0.5 text-xs text-primary underline-offset-2 hover:underline" disabled={pending} onClick={() => run(() => setItemPriceAction(item.id, null))}>
                  Voltar ao preço do catálogo
                </button>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-muted-foreground">Total do item</p>
              <p className="text-sm font-semibold tabular-nums">{lineTotal === null ? "—" : formatCurrency(lineTotal)}</p>
            </div>
            {editable ? (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => reopenItemAction(item.id))} className="shrink-0">
                <PenLine aria-hidden />
                Alterar
              </Button>
            ) : null}
          </div>
        ) : item.status === "NOT_FOUND" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <SearchX aria-hidden className="size-4" />
              Sem produto correspondente. Constará na cotação como item não atendido.
            </p>
            {editable ? (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => reopenItemAction(item.id))}>
                <RotateCcw aria-hidden />
                Reabrir
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-2.5">
            {item.candidates.length > 0 ? (
              <ul className="grid gap-1.5" aria-label={`Candidatos para o item ${item.lineNumber}`}>
                {visibleCandidates.map((candidate, index) => (
                  <CandidateRow
                    key={candidate.productId}
                    candidate={candidate}
                    primary={index === 0 && item.matchOutcome === "SUGGESTED"}
                    disabled={pending}
                    editable={editable}
                    onAccept={() => confirm(candidate.productId)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                Nenhum produto compatível foi encontrado no catálogo
                {item.rejected.length > 0 ? " — os mais parecidos foram descartados por divergência técnica." : "."}
              </p>
            )}

            {item.candidates.length > VISIBLE_CANDIDATES ? (
              <button type="button" className="justify-self-start text-xs text-primary underline-offset-2 hover:underline" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Mostrar menos" : `Mostrar mais ${item.candidates.length - VISIBLE_CANDIDATES}`}
              </button>
            ) : null}

            {item.rejected.length > 0 ? (
              <div>
                <button
                  type="button"
                  aria-expanded={showRejected}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowRejected(!showRejected)}
                >
                  <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", showRejected && "rotate-180")} />
                  {item.rejected.length === 1 ? "1 produto parecido descartado" : `${item.rejected.length} produtos parecidos descartados`} por incompatibilidade técnica
                </button>
                {showRejected ? (
                  <ul className="mt-1.5 grid gap-1.5">
                    {item.rejected.map((candidate) => (
                      <RejectedRow key={candidate.productId} candidate={candidate} itemId={item.id} editable={editable} />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {editable ? (
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <ProductSearch search={search} onSelect={(product) => confirm(product.id)}>
                  <Button variant="outline" size="sm" disabled={pending}>
                    <Search aria-hidden />
                    Buscar no catálogo
                  </Button>
                </ProductSearch>
                <Tooltip label="Registra que o item foi pedido, mas não há produto para ele">
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => markItemNotFoundAction(item.id))}>
                    <SearchX aria-hidden />
                    Não encontrado
                  </Button>
                </Tooltip>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}
