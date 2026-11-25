import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/page";
import { QuotationStatusBadge } from "@/components/status";
import type { IdPageProps } from "@/lib/params";
import { listCustomers } from "@/modules/customers/customers";
import { can } from "@/modules/identity/permissions";
import { getQuotation } from "@/modules/quotations/service";
import { sha256Hex } from "@/platform/crypto";
import { formatDate, toDateInputValue } from "@/platform/dates";
import { isAppError } from "@/platform/errors";
import { isUuid } from "@/platform/ids";
import { requirePage } from "@/server/session";
import { QuotationEditor } from "./quotation-editor";

export const metadata: Metadata = { title: "Cotação" };

export default async function QuotationPage({ params }: IdPageProps) {
  const { ctx } = await requirePage("quotation:read");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const quotation = await getQuotation(ctx, id).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const canWrite = can(ctx, "quotation:write");
  const customers = canWrite && can(ctx, "customer:read") ? await listCustomers(ctx, { limit: 300 }) : [];

  // Remonta o editor sempre que os dados gravados mudarem (salvar, repreçar, finalizar…).
  const { issueDate, validUntil, createdAt, finalizedAt, ...plain } = quotation;
  const view = { ...plain, issueDate: formatDate(issueDate), validUntil: toDateInputValue(validUntil), validUntilLabel: formatDate(validUntil) };
  const version = sha256Hex(JSON.stringify([view, createdAt, finalizedAt])).slice(0, 16);

  return (
    <PageContainer>
      <PageHeader
        back={{ href: "/cotacoes", label: "Cotações" }}
        title={`Cotação ${quotation.number}`}
        meta={
          <>
            <QuotationStatusBadge status={quotation.status} />
            <span className="text-[13px] text-muted-foreground">Emitida em {formatDate(quotation.issueDate)}</span>
            {quotation.createdByName ? <span className="text-[13px] text-muted-foreground">por {quotation.createdByName}</span> : null}
            {quotation.requestId ? (
              <Link href={`/solicitacoes/${quotation.requestId}`} className="text-[13px] text-primary underline-offset-4 hover:underline">
                Ver solicitação de origem
              </Link>
            ) : null}
          </>
        }
      />
      <QuotationEditor
        key={version}
        quotation={view}
        customers={customers.map((customer) => ({
          id: customer.id,
          name: customer.name,
          taxId: customer.taxId,
          email: customer.email,
          phone: customer.phone,
          contactName: customer.contactName,
        }))}
        canWrite={canWrite}
        canFinalize={can(ctx, "quotation:finalize")}
      />
    </PageContainer>
  );
}
