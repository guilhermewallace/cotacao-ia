import type { Metadata } from "next";
import { Bot, CircleAlert, CircleCheck, FlaskConical, HardDrive, ListChecks, Mail, MessageCircle, type LucideIcon } from "lucide-react";
import { CopyButton } from "@/components/client/helpers";
import { PageContainer, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { getAiStatus } from "@/modules/ai";
import { getEmailIntegration, getWhatsAppIntegration } from "@/modules/integrations/integrations";
import { formatDateTime } from "@/platform/dates";
import { env, isDevOnlySecret } from "@/platform/env";
import { requirePage } from "@/server/session";
import { EmailControls, SimulatorButtons, WhatsAppForm } from "./integration-forms";

export const metadata: Metadata = { title: "Integrações" };

function IntegrationHeader({ icon: Icon, title, description, badge }: { icon: LucideIcon; title: string; description: string; badge: React.ReactNode }) {
  return (
    <CardHeader>
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon aria-hidden className="size-4.5 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </div>
      {badge}
    </CardHeader>
  );
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md border bg-muted/50 px-2.5 py-1.5 font-mono text-xs break-all">{value}</code>
        <CopyButton value={value} />
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ServerFlag({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[13px]">
      {ok ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />}
      <span>{children}</span>
    </li>
  );
}

export default async function IntegrationsPage() {
  const { ctx, membership } = await requirePage("integrations:manage");
  const [whatsapp, email] = await Promise.all([getWhatsAppIntegration(ctx), getEmailIntegration(ctx)]);
  const ai = getAiStatus();
  const config = env();
  // "Pronto" exige os segredos REAIS do aplicativo da Meta — os valores locais do simulador não contam.
  const whatsappServerReady = whatsapp.serverReady && !isDevOnlySecret(config.WHATSAPP_APP_SECRET) && !isDevOnlySecret(config.WHATSAPP_VERIFY_TOKEN);

  const whatsappBadge = whatsapp.simulated ? (
    <Badge variant="info">
      <FlaskConical aria-hidden />
      Simulada (demonstração)
    </Badge>
  ) : whatsapp.status === "ACTIVE" ? (
    <Badge variant={whatsappServerReady ? "success" : "warning"}>{whatsappServerReady ? "Configurada" : "Configuração incompleta"}</Badge>
  ) : whatsapp.status === "ERROR" ? (
    <Badge variant="danger">Com erro</Badge>
  ) : (
    <Badge variant="outline">Não configurada</Badge>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Integrações"
        description="Canais de entrada e serviços externos. Credenciais ficam cifradas no banco ou em variáveis de ambiente do servidor — nunca são exibidas por inteiro."
      />

      <div className="grid gap-4">
        {/* ───────────── WhatsApp ───────────── */}
        <Card>
          <IntegrationHeader
            icon={MessageCircle}
            title="WhatsApp Business (Cloud API oficial da Meta)"
            description="Recebe mensagens de texto, documentos, imagens e áudios enviados ao número da empresa."
            badge={whatsappBadge}
          />
          <CardContent className="grid gap-5">
            {whatsapp.simulated ? (
              <Alert variant="info">
                <FlaskConical aria-hidden />
                <span>
                  Esta integração foi criada pelo ambiente de demonstração com um número <strong className="font-semibold">fictício</strong> ({whatsapp.displayPhoneNumber}).{" "}
                  <strong className="font-semibold">Não há conexão com a Meta</strong>: as mensagens chegam apenas pelo simulador local, abaixo. Ao salvar credenciais reais, a
                  simulação é substituída.
                </span>
              </Alert>
            ) : null}
            {whatsapp.lastError ? (
              <Alert variant="danger" role="alert">
                <CircleAlert aria-hidden />
                <span>Último erro: {whatsapp.lastError}</span>
              </Alert>
            ) : null}

            <WhatsAppForm
              key={`${whatsapp.phoneNumberId}-${whatsapp.accessTokenMask}`}
              initial={{
                phoneNumberId: whatsapp.simulated ? "" : (whatsapp.phoneNumberId ?? ""),
                displayPhoneNumber: whatsapp.simulated ? "" : (whatsapp.displayPhoneNumber ?? ""),
                businessAccountId: whatsapp.businessAccountId ?? "",
              }}
              configured={whatsapp.configured && !whatsapp.simulated}
              tokenMask={whatsapp.simulated ? null : whatsapp.accessTokenMask}
            />

            <div className="grid gap-3 border-t pt-4">
              <CopyRow
                label="URL de callback do webhook (cadastre no painel da Meta)"
                value={whatsapp.webhookUrl}
                hint="Assine o campo “messages”. A URL precisa ser pública e HTTPS; em desenvolvimento, use um túnel."
              />
              <ul className="grid gap-1.5">
                <ServerFlag ok={Boolean(config.WHATSAPP_VERIFY_TOKEN) && !isDevOnlySecret(config.WHATSAPP_VERIFY_TOKEN)}>
                  {isDevOnlySecret(config.WHATSAPP_VERIFY_TOKEN)
                    ? "Token de verificação com valor local de desenvolvimento — "
                    : config.WHATSAPP_VERIFY_TOKEN
                      ? "Token de verificação definido no servidor — "
                      : "Token de verificação não definido no servidor — "}
                  variável <code className="font-mono text-xs">WHATSAPP_VERIFY_TOKEN</code>; informe o mesmo valor no painel da Meta.
                </ServerFlag>
                <ServerFlag ok={Boolean(config.WHATSAPP_APP_SECRET) && !isDevOnlySecret(config.WHATSAPP_APP_SECRET)}>
                  {isDevOnlySecret(config.WHATSAPP_APP_SECRET)
                    ? "Chave secreta com valor local de desenvolvimento (serve só ao simulador; não é a chave do seu aplicativo na Meta) — "
                    : config.WHATSAPP_APP_SECRET
                      ? "Chave secreta do aplicativo definida no servidor — "
                      : "Chave secreta do aplicativo não definida no servidor — "}
                  variável <code className="font-mono text-xs">WHATSAPP_APP_SECRET</code>, usada para validar a assinatura de cada notificação.
                </ServerFlag>
              </ul>
              <p className="text-xs text-muted-foreground">
                {whatsapp.lastEventAt
                  ? `Última notificação recebida em ${formatDateTime(whatsapp.lastEventAt)}.`
                  : "Nenhuma notificação recebida ainda. O status “Configurada” indica apenas que as credenciais foram gravadas — a conexão só é comprovada quando a primeira notificação chegar."}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ───────────── E-mail ───────────── */}
        <Card>
          <IntegrationHeader
            icon={Mail}
            title="E-mail de entrada"
            description="Cada empresa tem um endereço exclusivo. Os e-mails enviados a ele (com anexos) viram solicitações de cotação."
            badge={
              email.simulated ? (
                <Badge variant="info">
                  <FlaskConical aria-hidden />
                  Simulada (demonstração)
                </Badge>
              ) : (
                <Badge variant={email.enabled ? "success" : "outline"}>{email.enabled ? "Ativada" : "Desativada"}</Badge>
              )
            }
          />
          <CardContent className="grid gap-5">
            {email.simulated ? (
              <Alert variant="info">
                <FlaskConical aria-hidden />
                <span>
                  No ambiente de demonstração <strong className="font-semibold">nenhum provedor de e-mail está conectado</strong> e o domínio abaixo não recebe mensagens reais. Use o
                  simulador local para ver o fluxo.
                </span>
              </Alert>
            ) : null}
            <CopyRow
              label="Endereço de recebimento desta empresa"
              value={email.address}
              hint="Divulgue este endereço aos clientes ou crie um redirecionamento a partir do e-mail comercial (ex.: cotacoes@suaempresa.com.br)."
            />
            <EmailControls enabled={email.enabled} />
            <div className="grid gap-2 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground">Provedores de recebimento (webhook) — configurados por variáveis de ambiente</p>
              <ul className="grid gap-2">
                {email.providers.map((provider) => (
                  <li key={provider.id} className="rounded-lg border px-3 py-2.5">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">{provider.label}</span>
                      <Badge variant={provider.configured ? "success" : "outline"}>{provider.configured ? "Credenciais definidas no servidor" : "Sem credenciais no servidor"}</Badge>
                    </div>
                    <code className="block font-mono text-xs break-all text-muted-foreground">{provider.webhookUrl}</code>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                {email.lastEventAt ? `Último e-mail recebido em ${formatDateTime(email.lastEventAt)}.` : "Nenhum e-mail recebido ainda."} Não há integração por OAuth com Gmail ou Outlook
                nesta versão.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ───────────── Simulador ───────────── */}
        {membership.isDemo ? (
          <Card className="border-info/30">
            <IntegrationHeader
              icon={FlaskConical}
              title="Simulador local de canais"
              description="Gera uma notificação fictícia no formato real do canal, assina com o segredo local e a entrega ao webhook de verdade — nada sai nem entra pela internet."
              badge={<Badge variant="info">Somente demonstração</Badge>}
            />
            <CardContent>
              <SimulatorButtons whatsapp={whatsapp.simulated && Boolean(config.WHATSAPP_APP_SECRET)} email={email.enabled && Boolean(config.EMAIL_WEBHOOK_SECRET)} />
              {!config.WHATSAPP_APP_SECRET || !config.EMAIL_WEBHOOK_SECRET ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Para habilitar os botões, defina <code className="font-mono">WHATSAPP_APP_SECRET</code> e <code className="font-mono">EMAIL_WEBHOOK_SECRET</code> no{" "}
                  <code className="font-mono">.env</code> (qualquer valor local).
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* ───────────── IA e infraestrutura ───────────── */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <IntegrationHeader icon={Bot} title="Inteligência artificial" description="Extração dos itens dos documentos." badge={null} />
            <CardContent className="grid gap-2 text-[13px]">
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant={ai.isMock ? "info" : "success"}>{ai.isMock ? "Provedor simulado" : ai.provider === "anthropic" ? "Anthropic" : "OpenAI"}</Badge>
                {ai.isMock ? null : <code className="font-mono text-xs">{ai.model}</code>}
              </p>
              <p className="text-muted-foreground">
                {ai.isMock
                  ? "Extração determinística local, sem chamadas externas: respostas preparadas para os documentos de exemplo e regras simples para os demais. Não representa a qualidade de um modelo real."
                  : "A chave de API fica apenas no servidor. O modelo extrai os itens; a busca no catálogo e a validação técnica são determinísticas."}
              </p>
              <p className="text-xs text-muted-foreground">
                Transcrição de áudio: {ai.transcription === "none" ? "desativada" : ai.transcription === "mock" ? "simulada" : "OpenAI"}. Configure em{" "}
                <code className="font-mono">AI_PROVIDER</code> / <code className="font-mono">TRANSCRIPTION_PROVIDER</code>.
              </p>
            </CardContent>
          </Card>
          <Card>
            <IntegrationHeader icon={ListChecks} title="Fila de processamento" description="Jobs assíncronos com repetição e recuperação." badge={null} />
            <CardContent className="grid gap-2 text-[13px]">
              <p>
                <Badge variant={config.QUEUE_DRIVER === "bullmq" ? "success" : "info"}>{config.QUEUE_DRIVER === "bullmq" ? "Redis + BullMQ" : "Em linha (sem worker)"}</Badge>
              </p>
              <p className="text-muted-foreground">
                {config.QUEUE_DRIVER === "bullmq"
                  ? "Os documentos são processados pelo worker (npm run worker). Se ele estiver parado, as solicitações ficam “na fila”."
                  : "Processamento no próprio servidor web, sem Redis. Indicado apenas para demonstração e testes."}
              </p>
            </CardContent>
          </Card>
          <Card>
            <IntegrationHeader icon={HardDrive} title="Armazenamento de arquivos" description="Object storage privado com URLs temporárias." badge={null} />
            <CardContent className="grid gap-2 text-[13px]">
              <p>
                <Badge variant={config.STORAGE_DRIVER === "s3" ? "success" : "info"}>{config.STORAGE_DRIVER === "s3" ? "Compatível com S3" : "Disco local"}</Badge>
              </p>
              <p className="text-muted-foreground">
                {config.STORAGE_DRIVER === "s3"
                  ? `Bucket “${config.S3_BUCKET}”. Os arquivos nunca são públicos; cada acesso gera uma URL válida por ${config.SIGNED_URL_TTL_SECONDS} segundos.`
                  : `Arquivos em disco no servidor, servidos por URL assinada válida por ${config.SIGNED_URL_TTL_SECONDS} segundos. Indicado apenas para desenvolvimento.`}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
