"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, LoaderCircle, Plus, TriangleAlert, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png";
const EXTENSIONS = new Set(["pdf", "xlsx", "xls", "csv", "jpg", "jpeg", "png"]);

interface Props {
  customers: Array<{ id: string; name: string }>;
  maxFiles: number;
  maxFileMb: number;
}

export function UploadDialog({ customers, maxFiles, maxFileMb }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [files, setFiles] = React.useState<File[]>([]);
  const [note, setNote] = React.useState("");
  const [customerId, setCustomerId] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Uma chave por abertura do diálogo: reenviar (duplo clique, nova tentativa) não duplica a solicitação.
  const [idempotencyKey, setIdempotencyKey] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setFiles([]);
    setNote("");
    setCustomerId("");
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const problems: string[] = [];
    const accepted: File[] = [];
    for (const file of incoming) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!EXTENSIONS.has(extension)) problems.push(`${file.name}: formato não aceito.`);
      else if (file.size > maxFileMb * 1024 * 1024) problems.push(`${file.name}: maior que ${maxFileMb} MB.`);
      else if (file.size === 0) problems.push(`${file.name}: arquivo vazio.`);
      else accepted.push(file);
    }
    setFiles((current) => {
      const merged = [...current];
      for (const file of accepted) {
        if (!merged.some((existing) => existing.name === file.name && existing.size === file.size)) merged.push(file);
      }
      if (merged.length > maxFiles) problems.push(`Envie no máximo ${maxFiles} arquivos por vez.`);
      return merged.slice(0, maxFiles);
    });
    setError(problems.length > 0 ? problems.join(" ") : null);
  }

  async function submit() {
    if (files.length === 0 || sending) return;
    setSending(true);
    setError(null);
    const form = new FormData();
    for (const file of files) form.append("files", file);
    if (note.trim()) form.append("note", note.trim());
    if (customerId) form.append("customerId", customerId);
    form.append("idempotencyKey", idempotencyKey);

    try {
      const response = await fetch("/api/uploads", { method: "POST", body: form });
      const payload = (await response.json().catch(() => null)) as { requestId?: string; error?: string } | null;
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      if (!response.ok || !payload?.requestId) {
        setError(payload?.error ?? "Não foi possível enviar os arquivos. Tente novamente.");
        return;
      }
      toast.success("Solicitação recebida. O processamento começou.");
      setOpen(false);
      router.push(`/solicitacoes/${payload.requestId}`);
    } catch {
      setError("Falha de conexão durante o envio. Verifique sua internet e tente novamente.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (sending) return;
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          Nova solicitação
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova solicitação de cotação</DialogTitle>
          <DialogDescription>
            Envie o pedido do cliente. Os itens são extraídos e comparados com o catálogo; você revisa tudo antes de gerar a cotação.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles(event.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-input bg-muted/40",
            )}
          >
            <UploadCloud aria-hidden className="mb-2 size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Arraste os arquivos para cá</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              PDF, Excel (XLSX, XLS), CSV ou imagem (JPG, PNG) · até {maxFileMb} MB por arquivo · no máximo {maxFiles} arquivos
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => inputRef.current?.click()}>
              Selecionar arquivos
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              aria-label="Selecionar arquivos"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          {files.length > 0 ? (
            <ul className="grid gap-1.5" aria-label="Arquivos selecionados">
              {files.map((file) => (
                <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-[13px]">
                  <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={`Remover ${file.name}`}
                    onClick={() => setFiles((current) => current.filter((item) => item !== file))}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {error ? (
            <Alert variant="danger" role="alert">
              <TriangleAlert aria-hidden />
              <span>{error}</span>
            </Alert>
          ) : null}

          <Field label="Cliente (opcional)" htmlFor="upload-customer" hint="Define a lista de preços usada nas sugestões. Pode ser informado depois.">
            <Select id="upload-customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Identificar depois</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Observações (opcional)" htmlFor="upload-note" hint="Texto que veio junto do pedido. Itens escritos aqui também são extraídos.">
            <Textarea id="upload-note" value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} rows={3} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={files.length === 0 || sending} aria-busy={sending}>
            {sending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
            {sending ? "Enviando…" : "Enviar para processamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
