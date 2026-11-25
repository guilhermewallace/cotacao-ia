import Link from "next/link";
import { AlertTriangle, ChevronRight, Paperclip } from "lucide-react";
import { CHANNEL, LegibilityBadge, RequestStatusBadge } from "@/components/status";
import type { RequestListItem } from "@/modules/requests/queries";
import { formatDateTime, formatRelative } from "@/platform/dates";

/** Lista de solicitações (caixa de entrada e painel). Cada linha inteira é um link. */
export function RequestList({ items }: { items: RequestListItem[] }) {
  return (
    <ul className="divide-y">
      {items.map((item) => {
        const channel = CHANNEL[item.channel];
        const ChannelIcon = channel.icon;
        const sender = item.customerName ?? item.senderName ?? item.senderAddress;
        return (
          <li key={item.id}>
            <Link
              href={`/solicitacoes/${item.id}`}
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_9rem_11rem_1rem]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.title ?? "Solicitação sem título"}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <ChannelIcon aria-hidden className="size-3.5" />
                    {channel.label}
                  </span>
                  {sender ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="truncate">{sender}</span>
                    </>
                  ) : null}
                  {item.attachmentsCount > 0 ? (
                    <span className="inline-flex items-center gap-0.5" title={`${item.attachmentsCount} anexo(s)`}>
                      <Paperclip aria-hidden className="size-3" />
                      {item.attachmentsCount}
                      <span className="sr-only"> anexo(s)</span>
                    </span>
                  ) : null}
                  <span aria-hidden>·</span>
                  <time dateTime={item.receivedAt.toISOString()} title={formatDateTime(item.receivedAt)}>
                    {formatRelative(item.receivedAt)}
                  </time>
                </p>
                {item.error ? (
                  <p className="mt-1 flex items-start gap-1 text-xs text-danger">
                    <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
                    <span className="line-clamp-1">{item.error}</span>
                  </p>
                ) : null}
              </div>

              <div className="hidden text-[13px] sm:block">
                {item.itemsCount > 0 ? (
                  <>
                    <span className="font-medium tabular-nums">{item.itemsCount}</span> {item.itemsCount === 1 ? "item" : "itens"}
                    <span className="block text-xs text-muted-foreground">
                      {item.identifiedCount} com sugestão forte
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>

              <div className="flex flex-col items-end gap-1 sm:items-start">
                <RequestStatusBadge status={item.status} />
                {item.quotation ? <span className="text-xs text-muted-foreground">{item.quotation.number}</span> : <LegibilityBadge legibility={item.legibility} />}
              </div>

              <ChevronRight aria-hidden className="hidden size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 sm:block" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
