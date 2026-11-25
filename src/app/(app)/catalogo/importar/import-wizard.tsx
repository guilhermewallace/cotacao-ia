"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, FileUp, LoaderCircle, TriangleAlert } from "lucide-react";
import { useAction } from "@/components/client/use-action";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { formatInteger } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ImportAnalysis, ImportMapping, ImportPreview, ImportResult, ImportTarget } from "@/modules/catalog/import";
import { analyzeImportAction, applyImportAction } from "../actions";

type FieldDef = { key: string; label: string; required: boolean };

interface Props {
  fields: Record<ImportTarget, readonly FieldDef[]>;
  priceLists: Array<{ id: string; name: string }>;
  initialTarget: ImportTarget;
  initialPriceListId: string | null;
  maxFileMb: number;
}

const STEPS = ["Arquivo", "Colunas e conferência", "Resultado"];

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" aria-label="Etapas da importação">
      {STEPS.map((label, index) => (
        <li key={label} className="flex items-center gap-2" aria-current={index === current ? "step" : undefined}>
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
              index < current ? "bg-success text-white" : index === current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {index < current ? "✓" : index + 1}
          </span>
          <span className={index === current ? "font-medium" : "text-muted-foreground"}>{label}</span>
          {index < STEPS.length - 1 ? <span aria-hidden className="mx-1 h-px w-6 bg-border" /> : null}
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warning" }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-semibold", tone === "danger" && value > 0 && "text-danger", tone === "warning" && value > 0 && "text-warning")}>{formatInteger(value)}</dd>
    </div>
  );
}

export function ImportWizard({ fields, priceLists, initialTarget, initialPriceListId, maxFileMb }: Props) {
  const router = useRouter();
  const [target, setTarget] = React.useState<ImportTarget>(initialTarget);
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [mapping, setMapping] = React.useState<ImportMapping>({ columns: {}, attributeColumns: [] });
  const [analysis, setAnalysis] = React.useState<ImportAnalysis | null>(null);
  const [updateExisting, setUpdateExisting] = React.useState(true);
  const [priceListId, setPriceListId] = React.useState(initialPriceListId ?? priceLists[0]?.id ?? "new");
  const [newListName, setNewListName] = React.useState("");
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const analyze = useAction();
  const apply = useAction();
  const step = result ? 2 : preview ? 1 : 0;

  async function upload() {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("target", target);
    try {
      const response = await fetch("/api/catalog/imports", { method: "POST", body: form });
      const payload = (await response.json().catch(() => null)) as (ImportPreview & { error?: string }) | null;
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      if (!response.ok || !payload?.importId) {
        setError(payload?.error ?? "Não foi possível ler a planilha. Verifique o arquivo e tente novamente.");
        return;
      }
      setPreview(payload);
      setMapping(payload.mapping);
      setAnalysis(payload.analysis);
    } catch {
      setError("Falha de conexão durante o envio.");
    } finally {
      setUploading(false);
    }
  }

  function changeMapping(next: ImportMapping) {
    if (!preview) return;
    setMapping(next);
    analyze.run(() => analyzeImportAction(preview.importId, next), { onSuccess: setAnalysis });
  }

  function restart() {
    setPreview(null);
    setAnalysis(null);
    setResult(null);
    setFile(null);
    setError(null);
  }

  // ───────────── Etapa 3: resultado ─────────────
  if (result) {
    return (
      <>
        <Stepper current={step} />
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 aria-hidden className="size-5 text-success" />
              <CardTitle>Importação concluída</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Criados" value={result.created} />
              <Stat label="Atualizados" value={result.updated} />
              <Stat label="Ignorados" value={result.skipped} />
              <Stat label="Com erro" value={result.errors} tone="danger" />
              {target === "products" ? <Stat label="Sinônimos criados" value={result.aliasesCreated} /> : null}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={result.priceListId ? `/catalogo/listas-de-precos/${result.priceListId}` : "/catalogo"} className={buttonVariants()}>
                {result.priceListId ? "Ver lista de preços" : "Ver catálogo"}
              </Link>
              <Button variant="outline" onClick={restart}>
                Importar outro arquivo
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  // ───────────── Etapa 1: arquivo ─────────────
  if (!preview) {
    return (
      <>
        <Stepper current={step} />
        <Card>
          <CardHeader>
            <div>
              <CardTitle>O que você quer importar?</CardTitle>
              <CardDescription>CSV (separado por vírgula ou ponto e vírgula) ou Excel (XLSX, XLS), com cabeçalho na primeira linha · até {maxFileMb} MB.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Tipo de importação</legend>
              {(
                [
                  { value: "products", title: "Produtos do catálogo", text: "Cria produtos novos e atualiza os existentes pelo SKU. Aceita sinônimos e colunas de atributos." },
                  { value: "price_list", title: "Lista de preços", text: "Define preços por SKU em uma lista (nova ou existente). Não altera o cadastro dos produtos." },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className={cn("flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 transition-colors", target === option.value ? "border-primary bg-primary/[0.04]" : "hover:bg-accent/40")}
                >
                  <input type="radio" name="target" value={option.value} checked={target === option.value} onChange={() => setTarget(option.value)} className="mt-1 accent-[var(--primary)]" />
                  <span>
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="block text-[13px] text-muted-foreground">{option.text}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <Field label="Arquivo" htmlFor="import-file">
              <Input id="import-file" type="file" accept=".csv,.xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="h-auto py-1.5" />
            </Field>

            {error ? (
              <Alert variant="danger" role="alert">
                <TriangleAlert aria-hidden />
                <span>{error}</span>
              </Alert>
            ) : null}

            <div>
              <Button onClick={upload} disabled={!file || uploading} aria-busy={uploading}>
                {uploading ? <LoaderCircle aria-hidden className="animate-spin" /> : <FileUp aria-hidden />}
                {uploading ? "Lendo a planilha…" : "Enviar e conferir"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  // ───────────── Etapa 2: colunas e conferência ─────────────
  const currentFields = fields[preview.target];
  const usedColumns = new Set(Object.values(mapping.columns).filter((value): value is number => value !== null && value !== undefined));
  const missingRequired = currentFields.filter((field) => field.required && (mapping.columns[field.key] === null || mapping.columns[field.key] === undefined));
  const needsListName = preview.target === "price_list" && priceListId === "new" && newListName.trim().length < 2;
  const canApply = analysis !== null && analysis.stats.valid > 0 && missingRequired.length === 0 && !needsListName && !analyze.pending && !apply.pending;

  return (
    <>
      <Stepper current={step} />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Correspondência das colunas</CardTitle>
              <CardDescription>
                {preview.fileName}
                {preview.sheetName ? ` · aba “${preview.sheetName}”` : ""} · {formatInteger(preview.totalRows)} {preview.totalRows === 1 ? "linha" : "linhas"}. As colunas foram reconhecidas pelo
                cabeçalho; ajuste se necessário.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {currentFields.map((field) => (
                <Field key={field.key} label={`${field.label}${field.required ? " *" : ""}`} htmlFor={`map-${field.key}`}>
                  <Select
                    id={`map-${field.key}`}
                    value={mapping.columns[field.key] ?? ""}
                    aria-invalid={field.required && (mapping.columns[field.key] ?? null) === null}
                    onChange={(event) => {
                      const column = event.target.value === "" ? null : Number(event.target.value);
                      changeMapping({
                        columns: { ...mapping.columns, [field.key]: column },
                        attributeColumns: mapping.attributeColumns.filter((index) => index !== column),
                      });
                    }}
                  >
                    <option value="">— não importar —</option>
                    {preview.headers.map((header, index) => (
                      <option key={index} value={index}>
                        {header || `Coluna ${index + 1}`}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            {preview.target === "products" && preview.headers.some((_, index) => !usedColumns.has(index)) ? (
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium">Colunas com atributos técnicos (opcional)</legend>
                <p className="mb-2 text-xs text-muted-foreground">Ex.: “Tensão”, “Corrente”, “Polos”. O valor é lido junto com a descrição para identificar os atributos do produto.</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {preview.headers.map((header, index) =>
                    usedColumns.has(index) ? null : (
                      <label key={index} className="flex items-center gap-1.5 text-[13px]">
                        <input
                          type="checkbox"
                          className="accent-[var(--primary)]"
                          checked={mapping.attributeColumns.includes(index)}
                          onChange={(event) =>
                            changeMapping({
                              ...mapping,
                              attributeColumns: event.target.checked ? [...mapping.attributeColumns, index] : mapping.attributeColumns.filter((value) => value !== index),
                            })
                          }
                        />
                        {header || `Coluna ${index + 1}`}
                      </label>
                    ),
                  )}
                </div>
              </fieldset>
            ) : null}

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <caption className="sr-only">Amostra das primeiras linhas do arquivo</caption>
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    {preview.headers.map((header, index) => (
                      <th key={index} scope="col" className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">
                        {header || `Coluna ${index + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t">
                      {preview.headers.map((_, index) => (
                        <td key={index} className="max-w-56 truncate px-2.5 py-1.5">
                          {row[index] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="items-center">
            <div>
              <CardTitle>Conferência</CardTitle>
              <CardDescription>Nada foi gravado ainda. Linhas com erro são ignoradas; as demais são importadas.</CardDescription>
            </div>
            {analyze.pending ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                Reanalisando…
              </span>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            {analysis ? (
              <>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="Linhas" value={analysis.stats.totalRows} />
                  <Stat label="Válidas" value={analysis.stats.valid} />
                  <Stat label="A criar" value={analysis.stats.toCreate} />
                  <Stat label="A atualizar" value={analysis.stats.toUpdate} />
                  <Stat label="Com erro" value={analysis.stats.errors} tone="danger" />
                  <Stat label="Avisos" value={analysis.stats.warnings} tone="warning" />
                </dl>
                {analysis.issues.length > 0 ? (
                  <div className="max-h-64 overflow-y-auto rounded-lg border">
                    <ul className="divide-y text-[13px]">
                      {analysis.issues.map((issue, index) => (
                        <li key={index} className="flex items-start gap-2 px-3 py-1.5">
                          <Badge variant={issue.severity === "error" ? "danger" : "warning"} className="mt-0.5">
                            {issue.severity === "error" ? <TriangleAlert aria-hidden /> : <CircleAlert aria-hidden />}
                            {issue.severity === "error" ? "Erro" : "Aviso"}
                          </Badge>
                          <span className="w-16 shrink-0 text-muted-foreground tabular-nums">linha {issue.row}</span>
                          <span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                    {analysis.issuesTruncated ? <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">Há mais ocorrências; apenas as primeiras são exibidas.</p> : null}
                  </div>
                ) : null}
              </>
            ) : null}

            {missingRequired.length > 0 ? (
              <Alert variant="danger" role="alert">
                <TriangleAlert aria-hidden />
                <span>Indique a coluna de: {missingRequired.map((field) => field.label).join(", ")}.</span>
              </Alert>
            ) : null}

            {preview.target === "products" ? (
              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" className="mt-0.5 accent-[var(--primary)]" checked={updateExisting} onChange={(event) => setUpdateExisting(event.target.checked)} />
                <span>
                  Atualizar produtos que já existem (mesmo SKU)
                  <span className="block text-xs text-muted-foreground">Desmarcado, os SKUs já cadastrados são ignorados. Células vazias nunca apagam dados existentes.</span>
                </span>
              </label>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Lista de preços de destino" htmlFor="price-list">
                  <Select id="price-list" value={priceListId} onChange={(event) => setPriceListId(event.target.value)}>
                    {priceLists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                    <option value="new">Criar nova lista…</option>
                  </Select>
                </Field>
                {priceListId === "new" ? (
                  <Field label="Nome da nova lista" htmlFor="new-list">
                    <Input id="new-list" value={newListName} maxLength={100} onChange={(event) => setNewListName(event.target.value)} placeholder="Ex.: Construtoras 2026" />
                  </Field>
                ) : null}
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                disabled={!canApply}
                aria-busy={apply.pending}
                onClick={() =>
                  apply.run(
                    () =>
                      applyImportAction(
                        preview.importId,
                        mapping,
                        preview.target === "products" ? { updateExisting } : priceListId === "new" ? { newPriceListName: newListName.trim() } : { priceListId },
                      ),
                    { onSuccess: setResult },
                  )
                }
              >
                {apply.pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
                {analysis ? `Importar ${formatInteger(analysis.stats.valid)} ${analysis.stats.valid === 1 ? "linha válida" : "linhas válidas"}` : "Importar"}
              </Button>
              <Button variant="outline" onClick={restart} disabled={apply.pending}>
                Escolher outro arquivo
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
