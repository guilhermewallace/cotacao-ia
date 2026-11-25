import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, FileText, FlaskConical, LoaderCircle, TriangleAlert } from "lucide-react";
import { ActionButton, ConfirmActionButton } from "@/components/client/action-button";
import { AutoRefresh } from "@/components/client/helpers";
import { PageContainer, PageHeader } from "@/components/page";
import { ChannelLabel, LegibilityBadge, QuotationStatusBadge, RequestStatusBadge } from "@/components/status";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import type { IdPageProps } from "@/lib/params";
import { listCustomers } from "@/modules/customers/customers";
import { can } from "@/modules/identity/permissions";
import { getRequestDetail } from "@/modules/requests/queries";
import { formatDateTime } from "@/platform/dates";
import { isAppError } from "@/platform/errors";
import { isUuid } from "@/platform/ids";
import { requirePage } from "@/server/session";
import { deleteRequestDocumentsAction, discardRequestAction, reprocessRequestAction, restoreRequestAction } from "./actions";
import { ReviewWorkspace } from "./review-workspace";

export const metadata: Metadata = { title: "Solicitação" };

export default async function RequestPage({ params }: IdPageProps) {
  const { ctx } = await requirePage("inbox:read");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  // Um ID de outra empresa é indistinguível de um ID inexistente: 404.
  const detail = await getRequestDetail(ctx, id).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  const canReview = can(ctx, "request:review");
  const canQuote = can(ctx, "quotation:write");
  const customers = canReview && can(ctx, "customer:read") ? await listCustomers(ctx, { limit: 300 }) : [];
  const inProgress = detail.status === "RECEIVED" || detail.status === "PROCESSING";
  const untouched = detail.progress.confirmed + detail.progress.notFound === 0;
  const sender = detail.message.senderName ?? detail.message.senderAddress;
  const hasDocuments = detail.attachments.some((attachment) => attachment.status === "STORED") || Boolean(detail.message.text);
  const mockExtraction = detail.extractionProvider === "mock";

  return (
    <PageContainer wide>
      <AutoRefresh active={inProgress} intervalMs={2000} />
      <PageHeader
        back={{ href: "/caixa-de-entrada", label: "Caixa de entrada" }}
        title={detail.title ?? "Solicitação de cotação"}
        meta={
          <>
            <RequestStatusBadge status={detail.status} />
            <ChannelLabel channel={detail.message.channel} />
            {sender ? <span className="text-[13px] text-muted-foreground">{sender}</span> : null}
            <span className="text-[13px] text-muted-foreground">Recebida em {formatDateTime(detail.receivedAt)}</span>
            <LegibilityBadge legibility={detail.legibility} />
          </>
        }
        actions={
          canReview ? (
            <>
              {(detail.status === "AWAITING_REVIEW" || detail.status === "FAILED") && untouched ? (
                <ConfirmActionButton
                  variant="outline"
                  action={reprocessRequestAction.bind(null, detail.id)}
                  success="Reprocessamento iniciado."
                  title="Reprocessar esta solicitação?"
                  description="A extração dos itens e a busca no catálogo serão refeitas a partir do documento original."
                  confirmLabel="Reprocessar"
                >
                  Reprocessar
                </ConfirmActionButton>
              ) : null}
              {detail.status === "AWAITING_REVIEW" || detail.status === "FAILED" ? (
                <ConfirmActionButton
                  variant="destructive-outline"
                  action={discardRequestAction.bind(null, detail.id)}
                  success="Solicitação descartada."
                  title="Descartar esta solicitação?"
                  description="Ela sai da fila de revisão e não gera cotação. É possível restaurá-la depois, no filtro “Descartadas”."
                  confirmLabel="Descartar"
                  destructive
                >
                  Descartar
                </ConfirmActionButton>
              ) : null}
              {detail.status === "DISCARDED" ? (
                <ActionButton variant="outline" action={restoreRequestAction.bind(null, detail.id)} success="Solicitação restaurada.">
                  Restaurar
                </ActionButton>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="mb-4 grid gap-2">
        {detail.quotations.map((quotation) => (
          <Alert key={quotation.id} variant="success" className="items-center">
            <FileText aria-hidden />
            <span className="flex flex-1 flex-wrap items-center gap-2">
              Esta solicitação gerou a cotação <strong className="font-semibold">{quotation.number}</strong>
              <QuotationStatusBadge status={quotation.status} />
            </span>
            <Link href={`/cotacoes/${quotation.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Abrir cotação
            </Link>
          </Alert>
        ))}

        {inProgress ? (
          <Alert variant="info" className="items-center">
            <LoaderCircle aria-hidden className="animate-spin" />
            <span>
              {detail.status === "RECEIVED" ? "Na fila de processamento." : "Lendo o documento, extraindo os itens e buscando no catálogo."} Esta tela é atualizada
              automaticamente.
            </span>
          </Alert>
        ) : null}

        {detail.status === "FAILED" ? (
          <Alert variant="danger" role="alert">
            <TriangleAlert aria-hidden />
            <span>
              <strong className="font-semibold">Não foi possível processar esta solicitação.</strong>{" "}
              {detail.message.error ?? "Tente reprocessar. Se o erro persistir, verifique o arquivo original."}
            </span>
          </Alert>
        ) : null}

        {detail.warnings.length > 0 ? (
          <Alert variant="warning">
            <CircleAlert aria-hidden />
            <div>
              <p className="font-medium">Atenção na conferência</p>
              <ul className="mt-0.5 list-disc pl-4">
                {detail.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          </Alert>
        ) : null}

        {mockExtraction && !inProgress ? (
          <Alert variant="neutral">
            <FlaskConical aria-hidden />
            <span>
              Itens extraídos pelo <strong className="font-semibold">provedor de IA simulado</strong> (determinístico, sem serviço externo). Configure Anthropic ou OpenAI em
              Integrações para extração real.
            </span>
          </Alert>
        ) : null}
      </div>

      {inProgress ? null : (
        <ReviewWorkspace
          detail={{
            id: detail.id,
            status: detail.status,
            items: detail.items,
            attachments: detail.attachments,
            message: detail.message,
            customer: detail.customer,
            customerHint: detail.customerHint,
            progress: detail.progress,
          }}
          customers={customers.map(({ id: customerId, name, priceListName }) => ({ id: customerId, name, priceListName }))}
          canReview={canReview}
          canQuote={canQuote}
        />
      )}

      {can(ctx, "settings:manage") && hasDocuments && !inProgress ? (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-medium">Documentos e privacidade (LGPD)</h2>
            <p className="text-xs text-muted-foreground">
              Exclui definitivamente os arquivos originais e o texto da mensagem. Os itens extraídos e a cotação são mantidos.
            </p>
          </div>
          <ConfirmActionButton
            variant="destructive-outline"
            size="sm"
            action={deleteRequestDocumentsAction.bind(null, detail.id)}
            success="Documentos originais excluídos."
            title="Excluir os documentos originais?"
            description="Os arquivos anexados e o texto da mensagem serão apagados do armazenamento e não poderão ser recuperados. A ação fica registrada na auditoria."
            confirmLabel="Excluir documentos"
            destructive
          >
            Excluir documentos originais
          </ConfirmActionButton>
        </section>
      ) : null}
    </PageContainer>
  );
}
