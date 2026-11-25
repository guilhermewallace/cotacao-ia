"use client";

import * as React from "react";
import { Download, ExternalLink, FileSpreadsheet, FileText, Image as ImageIcon, MessageSquareText, Mic, Paperclip, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RequestAttachmentView, RequestDetail, RequestItemView } from "@/modules/requests/queries";

/**
 * Painel "Documento original": a mensagem recebida e cada anexo, lado a lado com os itens.
 * Ao focar um item, o painel mostra a origem dele (arquivo, página/linha e trecho).
 * Os arquivos são carregados por /api/attachments/<id>, que confere a autorização e
 * redireciona para uma URL temporária do storage privado.
 */

type Source = { key: string; label: string; attachment: RequestAttachmentView | null };

const KIND_ICON = { PDF: FileText, SPREADSHEET: FileSpreadsheet, IMAGE: ImageIcon, AUDIO: Mic, TEXT: FileText, OTHER: Paperclip } as const;

function Highlighted({ text, excerpt }: { text: string; excerpt: string | null }) {
  const ref = React.useRef<HTMLElement>(null);
  const index = excerpt ? text.indexOf(excerpt) : -1;
  React.useEffect(() => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [excerpt]);
  if (!excerpt || index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark ref={ref} className="rounded-sm bg-warning-soft px-0.5 text-foreground ring-1 ring-warning/30">
        {excerpt}
      </mark>
      {text.slice(index + excerpt.length)}
    </>
  );
}

function referenceLabel(reference: NonNullable<RequestItemView["sourceReference"]>): string {
  const parts: string[] = [];
  if (reference.origin === "message") parts.push("Texto da mensagem");
  if (reference.fileName) parts.push(reference.fileName);
  if (reference.sheet) parts.push(`aba “${reference.sheet}”`);
  if (reference.page) parts.push(`página ${reference.page}`);
  if (reference.row) parts.push(`linha ${reference.row}`);
  return parts.join(" · ");
}

export function SourcePanel({ detail, focus }: { detail: Pick<RequestDetail, "message" | "attachments">; focus: RequestItemView | null }) {
  const sources = React.useMemo<Source[]>(() => {
    const list: Source[] = detail.attachments.map((attachment) => ({ key: attachment.id, label: attachment.fileName, attachment }));
    if (detail.message.text) list.push({ key: "message", label: detail.message.subject ? "Mensagem" : "Texto recebido", attachment: null });
    return list;
  }, [detail.attachments, detail.message.subject, detail.message.text]);

  const [selected, setSelected] = React.useState<string | null>(sources[0]?.key ?? null);
  const [mode, setMode] = React.useState<"file" | "text">("file");

  // Ao focar um item, mostra a fonte de onde ele foi extraído.
  const focusKey = focus?.sourceReference ? (focus.sourceAttachmentId ?? (focus.sourceReference.origin === "message" ? "message" : null)) : null;
  const [lastFocusKey, setLastFocusKey] = React.useState<string | null>(null);
  if (focusKey !== lastFocusKey) {
    setLastFocusKey(focusKey);
    if (focusKey && sources.some((source) => source.key === focusKey)) setSelected(focusKey);
  }

  const current = sources.find((source) => source.key === selected) ?? sources[0] ?? null;
  const excerpt = focus?.sourceReference?.excerpt && current && focusKey === current.key ? focus.sourceReference.excerpt : null;
  const attachment = current?.attachment ?? null;
  const canShowFile = Boolean(attachment && attachment.status === "STORED" && attachment.canInline);
  const hasText = Boolean(attachment?.extractedText);
  const showText = attachment ? (canShowFile ? mode === "text" && hasText : hasText) : true;

  return (
    <section aria-label="Documento original" className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
        {sources.length === 0 ? <span className="px-2 py-1 text-[13px] text-muted-foreground">Sem documento</span> : null}
        {sources.map((source) => {
          const Icon = source.attachment ? KIND_ICON[source.attachment.kind] : MessageSquareText;
          const active = source.key === current?.key;
          return (
            <button
              key={source.key}
              type="button"
              onClick={() => setSelected(source.key)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] transition-colors",
                active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{source.label}</span>
            </button>
          );
        })}
      </div>

      {focus?.sourceReference && focusKey === current?.key ? (
        <div className="border-b bg-warning-soft/60 px-3 py-2 text-xs">
          <p className="font-medium text-foreground">
            Origem do item {focus.lineNumber}: <span className="font-normal text-muted-foreground">{referenceLabel(focus.sourceReference)}</span>
          </p>
          {focus.sourceReference.excerpt ? <p className="mt-0.5 font-mono text-[11px] break-words text-foreground">“{focus.sourceReference.excerpt}”</p> : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {!current ? (
          <p className="p-6 text-center text-[13px] text-muted-foreground">Esta solicitação não tem documento nem texto disponível.</p>
        ) : !attachment ? (
          <div className="p-4">
            {detail.message.subject ? <p className="mb-2 text-sm font-medium">{detail.message.subject}</p> : null}
            <pre className="font-sans text-[13px] leading-6 break-words whitespace-pre-wrap">
              <Highlighted text={detail.message.text ?? ""} excerpt={excerpt} />
            </pre>
          </div>
        ) : attachment.status === "PURGED" ? (
          <p className="p-6 text-center text-[13px] text-muted-foreground">
            O arquivo original foi excluído (política de retenção ou exclusão manual). Os itens extraídos foram preservados.
          </p>
        ) : attachment.status !== "STORED" ? (
          <div className="p-4">
            <Alert variant={attachment.status === "PENDING_DOWNLOAD" ? "info" : "danger"}>
              <TriangleAlert aria-hidden />
              <span>
                {attachment.status === "PENDING_DOWNLOAD"
                  ? "O arquivo ainda está sendo baixado do canal de origem."
                  : (attachment.error ?? "Não foi possível obter este arquivo.")}
              </span>
            </Alert>
          </div>
        ) : showText ? (
          <pre className="p-4 font-mono text-xs leading-5 break-words whitespace-pre-wrap">
            <Highlighted text={attachment.extractedText ?? ""} excerpt={excerpt} />
          </pre>
        ) : canShowFile ? (
          attachment.kind === "IMAGE" ? (
            // eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido por URL temporária; não passa pelo otimizador de imagens
            <img src={`/api/attachments/${attachment.id}`} alt={`Documento ${attachment.fileName}`} className="mx-auto block h-auto max-w-full" />
          ) : (
            <iframe src={`/api/attachments/${attachment.id}`} title={`Documento ${attachment.fileName}`} className="block h-full w-full border-0" />
          )
        ) : (
          <p className="p-6 text-center text-[13px] text-muted-foreground">
            Este tipo de arquivo não pode ser exibido aqui. Use “Baixar” para abrir o original.
          </p>
        )}
      </div>

      {attachment && attachment.status === "STORED" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {attachment.fileName}
            {attachment.sizeBytes ? ` · ${formatFileSize(attachment.sizeBytes)}` : ""}
          </p>
          <div className="flex items-center gap-1">
            {canShowFile && hasText ? (
              <button type="button" className={buttonVariants({ variant: "ghost", size: "xs" })} onClick={() => setMode(mode === "file" ? "text" : "file")}>
                <FileText aria-hidden />
                {mode === "file" ? "Ver texto extraído" : "Ver arquivo"}
              </button>
            ) : null}
            {canShowFile ? (
              <a href={`/api/attachments/${attachment.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "xs" })}>
                <ExternalLink aria-hidden />
                Abrir em nova aba
              </a>
            ) : null}
            <a href={`/api/attachments/${attachment.id}?download=1`} className={buttonVariants({ variant: "ghost", size: "xs" })}>
              <Download aria-hidden />
              Baixar
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}
