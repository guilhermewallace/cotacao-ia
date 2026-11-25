"use client";

import * as React from "react";
import { LoaderCircle, Mail, MessageCircle, Save } from "lucide-react";
import { ActionButton, ConfirmActionButton } from "@/components/client/action-button";
import { useAction } from "@/components/client/use-action";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  disconnectWhatsAppIntegrationAction,
  rotateInboundEmailKeyAction,
  saveWhatsAppIntegrationAction,
  setEmailIntegrationEnabledAction,
  simulateEmailAction,
  simulateWhatsAppAction,
} from "./actions";

export function WhatsAppForm({
  initial,
  configured,
  tokenMask,
}: {
  initial: { phoneNumberId: string; displayPhoneNumber: string; businessAccountId: string };
  configured: boolean;
  tokenMask: string | null;
}) {
  const { pending, run } = useAction();
  const [values, setValues] = React.useState(initial);
  const [token, setToken] = React.useState("");
  const valid = /^\d{5,25}$/.test(values.phoneNumberId.trim()) && (configured || token.trim().length > 0);

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || pending) return;
        run(
          () =>
            saveWhatsAppIntegrationAction({
              phoneNumberId: values.phoneNumberId.trim(),
              displayPhoneNumber: values.displayPhoneNumber.trim() || undefined,
              businessAccountId: values.businessAccountId.trim() || undefined,
              accessToken: token.trim() || undefined,
            }),
          { success: "Integração com WhatsApp salva.", onSuccess: () => setToken("") },
        );
      }}
    >
      <Field label="ID do número de telefone (Phone Number ID)" htmlFor="wa-phone-id" hint="Em Meta for Developers › WhatsApp › Configuração da API.">
        <Input id="wa-phone-id" value={values.phoneNumberId} inputMode="numeric" maxLength={25} onChange={(event) => setValues({ ...values, phoneNumberId: event.target.value })} className="font-mono" />
      </Field>
      <Field label="Número exibido (opcional)" htmlFor="wa-display">
        <Input id="wa-display" value={values.displayPhoneNumber} maxLength={30} placeholder="+55 11 99999-0000" onChange={(event) => setValues({ ...values, displayPhoneNumber: event.target.value })} />
      </Field>
      <Field label="ID da conta WhatsApp Business (opcional)" htmlFor="wa-waba">
        <Input id="wa-waba" value={values.businessAccountId} inputMode="numeric" maxLength={25} onChange={(event) => setValues({ ...values, businessAccountId: event.target.value })} className="font-mono" />
      </Field>
      <Field
        label="Token de acesso"
        htmlFor="wa-token"
        hint={tokenMask ? `Token atual: ${tokenMask}. Deixe em branco para manter.` : "Use um token permanente de usuário do sistema. É gravado cifrado e nunca volta a ser exibido."}
      >
        <Input id="wa-token" type="password" value={token} autoComplete="off" maxLength={1000} placeholder={tokenMask ? "••••••••" : ""} onChange={(event) => setToken(event.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" disabled={!valid || pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
          Salvar
        </Button>
        {configured ? (
          <ConfirmActionButton
            type="button"
            variant="destructive-outline"
            action={disconnectWhatsAppIntegrationAction}
            success="Integração com WhatsApp removida."
            title="Desconectar o WhatsApp?"
            description="As mensagens deste número deixam de ser recebidas e o token gravado é apagado. O histórico de solicitações é mantido."
            confirmLabel="Desconectar"
            destructive
          >
            Desconectar
          </ConfirmActionButton>
        ) : null}
      </div>
    </form>
  );
}

export function EmailControls({ enabled }: { enabled: boolean }) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <label className="flex items-center gap-2.5 text-[13px] font-medium">
        <Switch checked={enabled} disabled={pending} onCheckedChange={(checked) => run(() => setEmailIntegrationEnabledAction(checked), { success: checked ? "Recebimento por e-mail ativado." : "Recebimento por e-mail desativado." })} />
        Receber solicitações por e-mail
      </label>
      <ConfirmActionButton
        variant="outline"
        size="sm"
        action={rotateInboundEmailKeyAction}
        success={(data) => `Novo endereço: ${data.address}`}
        title="Gerar um novo endereço de recebimento?"
        description="O endereço atual deixa de funcionar imediatamente. Use quando o endereço tiver sido exposto ou estiver recebendo spam. Você precisará informar o novo endereço aos clientes."
        confirmLabel="Gerar novo endereço"
      >
        Gerar novo endereço
      </ConfirmActionButton>
    </div>
  );
}

export function SimulatorButtons({ whatsapp, email }: { whatsapp: boolean; email: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton variant="outline" disabled={!whatsapp} action={simulateWhatsAppAction} success={(data) => `Mensagem simulada recebida: ${data.sample}. Veja na caixa de entrada.`}>
        <MessageCircle aria-hidden />
        Simular mensagem de WhatsApp
      </ActionButton>
      <ActionButton variant="outline" disabled={!email} action={simulateEmailAction} success={(data) => `E-mail simulado recebido: ${data.sample}. Veja na caixa de entrada.`}>
        <Mail aria-hidden />
        Simular e-mail recebido
      </ActionButton>
    </div>
  );
}
