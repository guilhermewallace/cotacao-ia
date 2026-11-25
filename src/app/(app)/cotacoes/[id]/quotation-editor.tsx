"use client";

import * as React from "react";
import { Ban, CircleAlert, Download, FileSpreadsheet, FileText, LoaderCircle, Lock, Plus, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";
import { ActionButton, ConfirmActionButton } from "@/components/client/action-button";
import { DecimalInput } from "@/components/client/decimal-input";
import { ProductSearch, type ProductOption } from "@/components/client/product-search";
import { useAction } from "@/components/client/use-action";
import { PRICE_SOURCE_LABEL } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatQuantity, formatTaxId } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { QuotationUpdateInput, QuotationView } from "@/modules/quotations/service";
import {
  cancelQuotationAction,
  finalizeQuotationAction,
  reopenQuotationAction,
  repriceQuotationAction,
  saveQuotationAction,
  searchProductsForQuotationAction,
} from "./actions";

export type EditorQuotation = Omit<QuotationView, "issueDate" | "validUntil" | "createdAt" | "finalizedAt"> & {
  issueDate: string;
  /** AAAA-MM-DD (valor de <input type="date">). */
  validUntil: string;
  validUntilLabel: string;
};

interface CustomerOption {
  id: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
}

interface LineState {
  quantity: number | null;
  unitPrice: number | null;
  discountPercent: number | null;
}

interface FormState {
  customerId: string | null;
  customerName: string;
  customerTaxId: string;
  customerEmail: string;
  customerPhone: string;
  customerContact: string;
  validUntil: string;
  notes: string;
  paymentTerms: string;
  deliveryTerms: string;
  discountPercent: number | null;
  lines: Record<string, LineState>;
  removed: string[];
  added: Array<{ product: ProductOption; quantity: number | null }>;
}

function initialState(quotation: EditorQuotation): FormState {
  return {
    customerId: quotation.customerId,
    customerName: quotation.customerName,
    customerTaxId: quotation.customerTaxId ?? "",
    customerEmail: quotation.customerEmail ?? "",
    customerPhone: quotation.customerPhone ?? "",
    customerContact: quotation.customerContact ?? "",
    validUntil: quotation.validUntil,
    notes: quotation.notes ?? "",
    paymentTerms: quotation.paymentTerms ?? "",
    deliveryTerms: quotation.deliveryTerms ?? "",
    discountPercent: Number(quotation.discountPercent),
    lines: Object.fromEntries(
      quotation.items.map((item) => [
        item.id,
        { quantity: Number(item.quantity), unitPrice: item.unitPrice === null ? null : Number(item.unitPrice), discountPercent: Number(item.discountPercent) },
      ]),
    ),
    removed: [],
    added: [],
  };
}

/** Prévia no navegador; o valor oficial é sempre recalculado no servidor com aritmética decimal. */
function previewLineTotal(quantity: number | null, unitPrice: number | null, discountPercent: number | null): number {
  if (quantity === null || unitPrice === null) return 0;
  return Math.round((quantity * unitPrice * (100 - (discountPercent ?? 0))) / 100 * 100 + Number.EPSILON) / 100;
}

export function QuotationEditor({
  quotation,
  customers,
  canWrite,
  canFinalize,
}: {
  quotation: EditorQuotation;
  customers: CustomerOption[];
  canWrite: boolean;
  canFinalize: boolean;
}) {
  const initial = React.useMemo(() => initialState(quotation), [quotation]);
  const [form, setForm] = React.useState<FormState>(initial);
  const save = useAction();
  const editable = canWrite && quotation.status === "DRAFT";
  const dirty = editable && JSON.stringify(form) !== JSON.stringify(initial);
  const patch = (changes: Partial<FormState>) => setForm((current) => ({ ...current, ...changes }));
  const patchLine = (id: string, changes: Partial<LineState>) =>
    setForm((current) => ({ ...current, lines: { ...current.lines, [id]: { ...(current.lines[id] as LineState), ...changes } } }));

  // Aviso do navegador ao sair com alterações não salvas.
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const visibleItems = quotation.items.filter((item) => !form.removed.includes(item.id));
  const search = React.useCallback((query: string) => searchProductsForQuotationAction(quotation.id, query), [quotation.id]);

  // Totais: gravados (quando não há edição pendente) ou prévia.
  const previewSubtotal =
    visibleItems.reduce((sum, item) => {
      if (!item.available) return sum;
      const line = form.lines[item.id];
      return sum + (line ? previewLineTotal(line.quantity, line.unitPrice, line.discountPercent) : 0);
    }, 0) + form.added.reduce((sum, entry) => sum + previewLineTotal(entry.quantity, entry.product.price === null ? null : Number(entry.product.price), 0), 0);
  const previewDiscount = Math.round(previewSubtotal * (form.discountPercent ?? 0) + Number.EPSILON) / 100;
  const totals = dirty
    ? { subtotal: previewSubtotal, discount: previewDiscount, total: previewSubtotal - previewDiscount }
    : { subtotal: Number(quotation.subtotal), discount: Number(quotation.discountTotal), total: Number(quotation.total) };

  const availableItems = visibleItems.filter((item) => item.available);
  const missingPrice = availableItems.filter((item) => form.lines[item.id]?.unitPrice === null).length;
  const invalidQuantity = availableItems.some((item) => !form.lines[item.id]?.quantity) || form.added.some((entry) => !entry.quantity);
  const canSave = dirty && !invalidQuantity && form.customerName.trim().length >= 2 && !save.pending;

  function submit() {
    if (!canSave) return;
    const payload: QuotationUpdateInput = {
      customerId: form.customerId,
      customerName: form.customerName,
      customerTaxId: form.customerTaxId,
      customerEmail: form.customerEmail,
      customerPhone: form.customerPhone,
      customerContact: form.customerContact,
      validUntil: form.validUntil,
      notes: form.notes,
      paymentTerms: form.paymentTerms,
      deliveryTerms: form.deliveryTerms,
      discountPercent: form.discountPercent ?? 0,
      items: visibleItems.map((item) => {
        const line = form.lines[item.id] as LineState;
        return { id: item.id, quantity: line.quantity ?? Number(item.quantity), unitPrice: line.unitPrice, discountPercent: line.discountPercent ?? 0, notes: item.notes };
      }),
      removedItemIds: form.removed,
      addedItems: form.added.map((entry) => ({ productId: entry.product.id, quantity: entry.quantity ?? 1 })),
    };
    save.run(() => saveQuotationAction(quotation.id, payload), { success: "Cotação salva." });
  }

  function selectCustomer(id: string) {
    const customer = customers.find((option) => option.id === id);
    if (!customer) {
      patch({ customerId: null });
      return;
    }
    patch({
      customerId: customer.id,
      customerName: customer.name,
      customerTaxId: customer.taxId ?? "",
      customerEmail: customer.email ?? "",
      customerPhone: customer.phone ?? "",
      customerContact: customer.contactName ?? "",
    });
  }

  const exportHref = (format: "pdf" | "xlsx" | "csv") => `/api/quotations/${quotation.id}/export?format=${format}`;

  return (
    <div className="grid gap-4">
      {/* Barra de ações */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          {quotation.status === "DRAFT" ? (
            dirty ? (
              <span className="flex items-center gap-1.5 text-warning">
                <CircleAlert aria-hidden className="size-4" />
                Alterações não salvas
              </span>
            ) : (
              <span>Rascunho — confira os dados e finalize para enviar ao cliente.</span>
            )
          ) : (
            <span className="flex items-center gap-1.5">
              <Lock aria-hidden className="size-3.5" />
              {quotation.status === "FINALIZED" ? "Cotação finalizada: o conteúdo está travado." : "Cotação cancelada."}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable ? (
            <>
              {dirty ? (
                <Button variant="ghost" onClick={() => setForm(initial)} disabled={save.pending}>
                  <RotateCcw aria-hidden />
                  Descartar alterações
                </Button>
              ) : null}
              <Button variant={dirty ? "default" : "outline"} onClick={submit} disabled={!canSave} aria-busy={save.pending}>
                {save.pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
                Salvar
              </Button>
            </>
          ) : null}

          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
          {(["pdf", "xlsx", "csv"] as const).map((format) => {
            const Icon = format === "pdf" ? FileText : format === "xlsx" ? FileSpreadsheet : Download;
            const label = format === "pdf" ? "PDF" : format === "xlsx" ? "Excel" : "CSV";
            return dirty ? (
              <span key={format} aria-disabled title="Salve as alterações antes de exportar" className={buttonVariants({ variant: "outline" })}>
                <Icon aria-hidden />
                {label}
              </span>
            ) : (
              <a key={format} href={exportHref(format)} className={buttonVariants({ variant: "outline" })} download>
                <Icon aria-hidden />
                {label}
              </a>
            );
          })}

          {quotation.status === "DRAFT" && canFinalize ? (
            <ConfirmActionButton
              action={() => finalizeQuotationAction(quotation.id)}
              disabled={dirty}
              title={`Finalizar a cotação ${quotation.number}?`}
              description="Depois de finalizada, a cotação fica travada para edição. Se precisar corrigir algo, você poderá reabri-la."
              confirmLabel="Finalizar cotação"
              success="Cotação finalizada."
            >
              Finalizar
            </ConfirmActionButton>
          ) : null}
          {quotation.status === "FINALIZED" && canFinalize ? (
            <ActionButton variant="outline" action={() => reopenQuotationAction(quotation.id)} success="Cotação reaberta para edição.">
              Reabrir
            </ActionButton>
          ) : null}
        </div>
      </div>

      {editable && missingPrice > 0 ? (
        <Alert variant="warning">
          <CircleAlert aria-hidden />
          <span>
            {missingPrice === 1 ? "1 item está sem preço" : `${missingPrice} itens estão sem preço`} no catálogo e nas listas de preços. Informe o preço para poder finalizar —
            nenhum preço é estimado automaticamente.
          </span>
        </Alert>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="grid min-w-0 gap-4">
          <Card className="overflow-hidden">
            <CardHeader className="items-center">
              <CardTitle>Itens</CardTitle>
              {editable ? (
                <div className="flex flex-wrap items-center gap-2">
                  <ConfirmActionButton
                    variant="ghost"
                    size="sm"
                    disabled={dirty}
                    action={() => repriceQuotationAction(quotation.id)}
                    success="Preços atualizados pelo catálogo."
                    title="Atualizar preços pelo catálogo?"
                    description="Os preços dos itens voltam a ser os da lista de preços do cliente (ou do catálogo). Preços informados manualmente serão substituídos."
                    confirmLabel="Atualizar preços"
                  >
                    <RefreshCw aria-hidden />
                    Atualizar preços
                  </ConfirmActionButton>
                  <ProductSearch
                    search={search}
                    align="end"
                    onSelect={(product) => {
                      if (quotation.items.some((item) => item.productId === product.id && !form.removed.includes(item.id)) || form.added.some((entry) => entry.product.id === product.id)) return;
                      patch({ added: [...form.added, { product, quantity: 1 }] });
                    }}
                  >
                    <Button variant="outline" size="sm">
                      <Plus aria-hidden />
                      Adicionar produto
                    </Button>
                  </ProductSearch>
                </div>
              ) : null}
            </CardHeader>
            <div className="border-t">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd.</TableHead>
                    <TableHead>Un.</TableHead>
                    <TableHead className="text-right">Preço unit. (R$)</TableHead>
                    <TableHead className="text-right">Desc. %</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    {editable ? <TableHead className="w-8" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleItems.map((item, index) => {
                    const line = form.lines[item.id] as LineState;
                    const lineTotal = dirty ? previewLineTotal(line.quantity, line.unitPrice, line.discountPercent) : Number(item.lineTotal);
                    return (
                      <TableRow key={item.id} className={cn(!item.available && "bg-muted/40")}>
                        <TableCell className="text-muted-foreground tabular-nums">{index + 1}</TableCell>
                        <TableCell className="min-w-56">
                          <p className={cn("text-[13px] leading-5 font-medium", !item.available && "text-muted-foreground")}>{item.description}</p>
                          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            {item.sku ? <span className="font-mono">{item.sku}</span> : null}
                            {!item.available ? <Badge variant="neutral">Item não atendido</Badge> : null}
                            {item.available && item.priceSource ? <span>{PRICE_SOURCE_LABEL[item.priceSource]}</span> : null}
                          </p>
                        </TableCell>
                        {item.available && editable ? (
                          <>
                            <TableCell className="text-right">
                              <DecimalInput
                                commitOnChange
                                allowEmpty={false}
                                value={line.quantity}
                                fractionDigits={3}
                                aria-label={`Quantidade do item ${index + 1}`}
                                className="ml-auto h-8 w-20"
                                onCommit={(value) => patchLine(item.id, { quantity: value })}
                              />
                            </TableCell>
                            <TableCell className="text-muted-foreground">{item.unit ?? "—"}</TableCell>
                            <TableCell className="text-right">
                              <DecimalInput
                                commitOnChange
                                value={line.unitPrice}
                                money
                                aria-label={`Preço unitário do item ${index + 1}`}
                                placeholder="sem preço"
                                className={cn("ml-auto h-8 w-28", line.unitPrice === null && "border-warning")}
                                onCommit={(value) => patchLine(item.id, { unitPrice: value })}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <DecimalInput
                                commitOnChange
                                value={line.discountPercent}
                                fractionDigits={2}
                                aria-label={`Desconto do item ${index + 1}, em porcentagem`}
                                className="ml-auto h-8 w-16"
                                onCommit={(value) => patchLine(item.id, { discountPercent: value === null ? 0 : Math.min(value, 100) })}
                              />
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-right tabular-nums">{formatQuantity(item.quantity)}</TableCell>
                            <TableCell className="text-muted-foreground">{item.unit ?? "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{item.available ? formatCurrency(item.unitPrice, { precise: true }) : "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{item.available && Number(item.discountPercent) > 0 ? `${formatQuantity(item.discountPercent)}%` : "—"}</TableCell>
                          </>
                        )}
                        <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">{item.available ? formatCurrency(lineTotal) : "—"}</TableCell>
                        {editable ? (
                          <TableCell>
                            <Button variant="ghost" size="icon-xs" aria-label={`Remover item ${index + 1}`} onClick={() => patch({ removed: [...form.removed, item.id] })}>
                              <Trash2 aria-hidden />
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}

                  {form.added.map((entry, index) => (
                    <TableRow key={entry.product.id} className="bg-info-soft/40">
                      <TableCell className="text-muted-foreground tabular-nums">{visibleItems.length + index + 1}</TableCell>
                      <TableCell>
                        <p className="text-[13px] leading-5 font-medium">{entry.product.description}</p>
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{entry.product.sku}</span>
                          <Badge variant="info">Novo — salve para incluir</Badge>
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <DecimalInput
                          commitOnChange
                          allowEmpty={false}
                          value={entry.quantity}
                          fractionDigits={3}
                          aria-label={`Quantidade de ${entry.product.description}`}
                          className="ml-auto h-8 w-20"
                          onCommit={(value) => patch({ added: form.added.map((other) => (other === entry ? { ...other, quantity: value } : other)) })}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{entry.product.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{entry.product.price === null ? "sem preço" : formatCurrency(entry.product.price, { precise: true })}</TableCell>
                      <TableCell className="text-right">—</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(previewLineTotal(entry.quantity, entry.product.price === null ? null : Number(entry.product.price), 0))}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon-xs" aria-label="Remover produto adicionado" onClick={() => patch({ added: form.added.filter((other) => other !== entry) })}>
                          <Trash2 aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {visibleItems.length === 0 && form.added.length === 0 ? <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">Nenhum item na cotação.</p> : null}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Condições e observações</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Condição de pagamento" htmlFor="payment">
                <Input id="payment" value={form.paymentTerms} maxLength={500} disabled={!editable} placeholder="Ex.: 28 dias" onChange={(event) => patch({ paymentTerms: event.target.value })} />
              </Field>
              <Field label="Prazo e condição de entrega" htmlFor="delivery">
                <Input id="delivery" value={form.deliveryTerms} maxLength={500} disabled={!editable} placeholder="Ex.: 5 dias úteis, CIF" onChange={(event) => patch({ deliveryTerms: event.target.value })} />
              </Field>
              <Field label="Observações" htmlFor="notes" className="sm:col-span-2" hint="Aparecem no rodapé da cotação exportada.">
                <Textarea id="notes" value={form.notes} maxLength={4000} rows={3} disabled={!editable} onChange={(event) => patch({ notes: event.target.value })} />
              </Field>
            </CardContent>
          </Card>
        </div>

        <aside className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Cliente</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {editable ? (
                <>
                  {customers.length > 0 ? (
                    <Field label="Cliente cadastrado" htmlFor="customer">
                      <Select id="customer" value={form.customerId ?? ""} onChange={(event) => selectCustomer(event.target.value)}>
                        <option value="">Não vinculado</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}
                  <Field label="Nome / razão social" htmlFor="customer-name" error={form.customerName.trim().length < 2 ? "Informe o cliente" : null}>
                    <Input id="customer-name" value={form.customerName} maxLength={200} onChange={(event) => patch({ customerName: event.target.value })} />
                  </Field>
                  <Field label="CNPJ / CPF" htmlFor="customer-tax">
                    <Input id="customer-tax" value={form.customerTaxId} maxLength={20} inputMode="numeric" onChange={(event) => patch({ customerTaxId: event.target.value })} />
                  </Field>
                  <Field label="Contato" htmlFor="customer-contact">
                    <Input id="customer-contact" value={form.customerContact} maxLength={120} onChange={(event) => patch({ customerContact: event.target.value })} />
                  </Field>
                  <Field label="E-mail" htmlFor="customer-email">
                    <Input id="customer-email" type="email" value={form.customerEmail} maxLength={200} onChange={(event) => patch({ customerEmail: event.target.value })} />
                  </Field>
                  <Field label="Telefone" htmlFor="customer-phone">
                    <Input id="customer-phone" value={form.customerPhone} maxLength={30} inputMode="tel" onChange={(event) => patch({ customerPhone: event.target.value })} />
                  </Field>
                </>
              ) : (
                <dl className="grid gap-2 text-[13px]">
                  <div>
                    <dt className="sr-only">Cliente</dt>
                    <dd className="font-medium">{quotation.customerName}</dd>
                  </div>
                  {quotation.customerTaxId ? <dd className="text-muted-foreground">{formatTaxId(quotation.customerTaxId)}</dd> : null}
                  {quotation.customerContact ? <dd className="text-muted-foreground">{quotation.customerContact}</dd> : null}
                  {quotation.customerEmail ? <dd className="break-all text-muted-foreground">{quotation.customerEmail}</dd> : null}
                  {quotation.customerPhone ? <dd className="text-muted-foreground">{quotation.customerPhone}</dd> : null}
                </dl>
              )}
              {quotation.priceListName ? <p className="text-xs text-muted-foreground">Lista de preços: {quotation.priceListName}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resumo</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Field label="Válida até" htmlFor="valid-until">
                {editable ? (
                  <Input id="valid-until" type="date" value={form.validUntil} onChange={(event) => patch({ validUntil: event.target.value })} />
                ) : (
                  <p id="valid-until" className="text-sm">
                    {quotation.validUntilLabel}
                  </p>
                )}
              </Field>
              {editable ? (
                <Field label="Desconto geral (%)" htmlFor="discount">
                  <DecimalInput
                    id="discount"
                    commitOnChange
                    value={form.discountPercent}
                    fractionDigits={2}
                    className="text-left"
                    onCommit={(value) => patch({ discountPercent: value === null ? 0 : Math.min(value, 100) })}
                  />
                </Field>
              ) : null}
              <dl className="mt-1 grid gap-1.5 border-t pt-3 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">{formatCurrency(totals.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Desconto{Number(form.discountPercent) > 0 ? ` (${formatQuantity(form.discountPercent)}%)` : ""}</dt>
                  <dd className="tabular-nums">{totals.discount > 0 ? `− ${formatCurrency(totals.discount)}` : formatCurrency(0)}</dd>
                </div>
                <div className="flex items-baseline justify-between border-t pt-2">
                  <dt className="font-medium">Total</dt>
                  <dd className="text-lg font-semibold tabular-nums">{formatCurrency(totals.total)}</dd>
                </div>
              </dl>
              {dirty ? <p className="text-xs text-muted-foreground">Prévia. Os totais oficiais são recalculados ao salvar.</p> : null}
            </CardContent>
          </Card>

          {quotation.status === "DRAFT" && canFinalize ? (
            <ConfirmActionButton
              variant="destructive-outline"
              size="sm"
              action={() => cancelQuotationAction(quotation.id)}
              success="Cotação cancelada."
              title={`Cancelar a cotação ${quotation.number}?`}
              description="A cotação deixa de valer e não poderá mais ser editada. O número não é reutilizado."
              confirmLabel="Cancelar cotação"
              destructive
              className="justify-self-start"
            >
              <Ban aria-hidden />
              Cancelar cotação
            </ConfirmActionButton>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
