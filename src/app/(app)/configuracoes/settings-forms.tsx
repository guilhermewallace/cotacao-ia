"use client";

import * as React from "react";
import { LoaderCircle, Save, UserPlus } from "lucide-react";
import { ConfirmActionButton } from "@/components/client/action-button";
import { useAction } from "@/components/client/use-action";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { addMemberAction, removeMemberAction, updateMemberRoleAction, updateOrganizationAction } from "./actions";

export interface OrganizationFormValues {
  name: string;
  legalName: string;
  taxId: string;
  defaultQuotationValidityDays: string;
  documentRetentionDays: string;
}

export function OrganizationForm({ initial }: { initial: OrganizationFormValues }) {
  const { pending, run } = useAction();
  const [values, setValues] = React.useState(initial);
  const set = (key: keyof OrganizationFormValues, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const validity = Number(values.defaultQuotationValidityDays);
  const retention = values.documentRetentionDays.trim() === "" ? null : Number(values.documentRetentionDays);
  const valid =
    values.name.trim().length >= 2 && Number.isInteger(validity) && validity >= 1 && validity <= 365 && (retention === null || (Number.isInteger(retention) && retention >= 1 && retention <= 3650));
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || pending) return;
        run(
          () =>
            updateOrganizationAction({
              name: values.name,
              legalName: values.legalName || null,
              taxId: values.taxId || null,
              defaultQuotationValidityDays: validity,
              documentRetentionDays: retention,
            }),
          { success: "Configurações salvas." },
        );
      }}
    >
      <Field label="Nome da empresa" htmlFor="org-name" hint="Aparece no cabeçalho das cotações.">
        <Input id="org-name" value={values.name} maxLength={160} required onChange={(event) => set("name", event.target.value)} />
      </Field>
      <Field label="Razão social" htmlFor="org-legal">
        <Input id="org-legal" value={values.legalName} maxLength={200} onChange={(event) => set("legalName", event.target.value)} />
      </Field>
      <Field label="CNPJ" htmlFor="org-tax" hint="14 dígitos.">
        <Input id="org-tax" value={values.taxId} maxLength={20} inputMode="numeric" onChange={(event) => set("taxId", event.target.value)} />
      </Field>
      <Field label="Validade padrão das cotações (dias)" htmlFor="org-validity">
        <Input id="org-validity" type="number" min={1} max={365} value={values.defaultQuotationValidityDays} onChange={(event) => set("defaultQuotationValidityDays", event.target.value)} />
      </Field>
      <Field
        label="Retenção de documentos originais (dias)"
        htmlFor="org-retention"
        className="sm:col-span-2"
        hint="LGPD: após esse prazo, anexos, texto das mensagens e texto extraído são excluídos automaticamente; itens e cotações são mantidos. Deixe em branco para não excluir automaticamente."
      >
        <Input id="org-retention" type="number" min={1} max={3650} value={values.documentRetentionDays} placeholder="sem exclusão automática" className="sm:max-w-64" onChange={(event) => set("documentRetentionDays", event.target.value)} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={!valid || !dirty || pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
          Salvar
        </Button>
      </div>
    </form>
  );
}

type RoleOption = { value: string; label: string; description: string };

export function AddMemberForm({ roles }: { roles: RoleOption[] }) {
  const { pending, run } = useAction();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState(roles[roles.length - 2]?.value ?? roles[0]?.value ?? "SELLER");
  const valid = name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || pending) return;
        run(() => addMemberAction({ name: name.trim(), email: email.trim(), role }), {
          success: "Membro adicionado.",
          onSuccess: () => {
            setName("");
            setEmail("");
          },
        });
      }}
    >
      <Field label="Nome" htmlFor="member-name" className="min-w-44 flex-1">
        <Input id="member-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="E-mail" htmlFor="member-email" className="min-w-56 flex-1">
        <Input id="member-email" type="email" value={email} maxLength={200} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      <Field label="Papel" htmlFor="member-role">
        <Select id="member-role" value={role} onChange={(event) => setRole(event.target.value)} className="w-40">
          {roles.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={!valid || pending} aria-busy={pending}>
        {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <UserPlus aria-hidden />}
        Adicionar
      </Button>
    </form>
  );
}

export function MemberRowControls({ membershipId, name, role, roles, isSelf }: { membershipId: string; name: string; role: string; roles: RoleOption[]; isSelf: boolean }) {
  const { pending, run } = useAction();
  if (isSelf) return <span className="text-xs text-muted-foreground">Você</span>;
  // O papel atual sempre aparece, mesmo que o usuário não possa atribuí-lo a outros.
  const options = roles.some((option) => option.value === role) ? roles : [...roles, { value: role, label: role, description: "" }];
  return (
    <div className="flex items-center justify-end gap-2">
      <Select
        value={role}
        disabled={pending}
        aria-label={`Papel de ${name}`}
        className="h-8 w-36 text-[13px]"
        onChange={(event) => {
          const next = event.target.value;
          run(() => updateMemberRoleAction(membershipId, next), { success: "Papel atualizado." });
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <ConfirmActionButton
        variant="ghost"
        size="xs"
        action={() => removeMemberAction(membershipId)}
        success="Membro removido."
        title={`Remover ${name} desta empresa?`}
        description="A pessoa perde imediatamente o acesso aos dados desta empresa. O histórico de ações dela é mantido na auditoria."
        confirmLabel="Remover"
        destructive
      >
        Remover
      </ConfirmActionButton>
    </div>
  );
}
