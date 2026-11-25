"use client";

import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { useAction } from "@/components/client/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { createCustomerAction, updateCustomerAction } from "./actions";

export interface CustomerFormValues {
  id?: string;
  name: string;
  legalName: string;
  taxId: string;
  email: string;
  phone: string;
  contactName: string;
  notes: string;
  priceListId: string;
}

export const EMPTY_CUSTOMER: CustomerFormValues = { name: "", legalName: "", taxId: "", email: "", phone: "", contactName: "", notes: "", priceListId: "" };

export function CustomerDialog({
  initial,
  priceLists,
  children,
}: {
  initial: CustomerFormValues;
  priceLists: Array<{ id: string; name: string; isDefault: boolean }>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState(initial);
  const { pending, run } = useAction();
  const set = (key: keyof CustomerFormValues, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const isNew = !initial.id;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (values.name.trim().length < 2 || pending) return;
    const input = {
      name: values.name,
      legalName: values.legalName || null,
      taxId: values.taxId || null,
      email: values.email || null,
      phone: values.phone || null,
      contactName: values.contactName || null,
      notes: values.notes || null,
      priceListId: values.priceListId || null,
    };
    const done = { success: isNew ? "Cliente cadastrado." : "Cliente atualizado.", onSuccess: () => setOpen(false) };
    if (initial.id) {
      const id = initial.id;
      run(() => updateCustomerAction(id, input), done);
    } else {
      run(() => createCustomerAction(input), done);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setValues(initial);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{isNew ? "Novo cliente" : "Editar cliente"}</DialogTitle>
            <DialogDescription>
              E-mail e telefone são usados para reconhecer automaticamente o cliente nas solicitações recebidas por e-mail e WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="customer-name" className="sm:col-span-2">
              <Input id="customer-name" value={values.name} maxLength={160} required autoFocus onChange={(event) => set("name", event.target.value)} />
            </Field>
            <Field label="Razão social" htmlFor="customer-legal">
              <Input id="customer-legal" value={values.legalName} maxLength={200} onChange={(event) => set("legalName", event.target.value)} />
            </Field>
            <Field label="CNPJ / CPF" htmlFor="customer-tax">
              <Input id="customer-tax" value={values.taxId} maxLength={20} inputMode="numeric" onChange={(event) => set("taxId", event.target.value)} />
            </Field>
            <Field label="Contato" htmlFor="customer-contact">
              <Input id="customer-contact" value={values.contactName} maxLength={120} onChange={(event) => set("contactName", event.target.value)} />
            </Field>
            <Field label="E-mail" htmlFor="customer-email">
              <Input id="customer-email" type="email" value={values.email} maxLength={200} onChange={(event) => set("email", event.target.value)} />
            </Field>
            <Field label="Telefone / WhatsApp" htmlFor="customer-phone" hint="Com DDD. Ex.: (11) 99999-0000">
              <Input id="customer-phone" value={values.phone} maxLength={30} inputMode="tel" onChange={(event) => set("phone", event.target.value)} />
            </Field>
            <Field label="Lista de preços" htmlFor="customer-price-list" hint="Sem lista própria, vale a lista padrão.">
              <Select id="customer-price-list" value={values.priceListId} onChange={(event) => set("priceListId", event.target.value)}>
                <option value="">Lista padrão da empresa</option>
                {priceLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                    {list.isDefault ? " (padrão)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Observações" htmlFor="customer-notes" className="sm:col-span-2">
              <Textarea id="customer-notes" value={values.notes} maxLength={1000} rows={2} onChange={(event) => set("notes", event.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || values.name.trim().length < 2} aria-busy={pending}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
              {isNew ? "Cadastrar" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
