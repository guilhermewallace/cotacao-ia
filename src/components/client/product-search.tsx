"use client";

import * as React from "react";
import { Command } from "cmdk";
import { LoaderCircle, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ActionResult } from "@/components/client/use-action";
import { formatCurrency } from "@/lib/format";

export interface ProductOption {
  id: string;
  sku: string;
  description: string;
  manufacturer: string | null;
  unit: string;
  price: string | null;
  priceListName: string | null;
}

/**
 * Busca manual no catálogo (popover com resultados conforme digita).
 * A busca roda no servidor (texto completo + similaridade), sempre restrita à empresa da sessão.
 */
export function ProductSearch({
  search,
  onSelect,
  children,
  align = "start",
}: {
  search: (query: string) => Promise<ActionResult<ProductOption[]>>;
  onSelect: (product: ProductOption) => void;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<ProductOption[]>([]);
  const [state, setState] = React.useState<"idle" | "loading" | "error">("idle");
  const requestRef = React.useRef(0);

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timerRef.current), []);

  function onQueryChange(value: string) {
    setQuery(value);
    clearTimeout(timerRef.current);
    const text = value.trim();
    const current = ++requestRef.current;
    if (text.length < 2) {
      setResults([]);
      setState("idle");
      return;
    }
    setState("loading");
    // pequena espera para não disparar uma busca a cada tecla
    timerRef.current = setTimeout(async () => {
      try {
        const result = await search(text);
        if (requestRef.current !== current) return; // resposta de uma busca antiga
        setResults(result.ok ? result.data : []);
        setState(result.ok ? "idle" : "error");
      } catch {
        if (requestRef.current === current) setState("error");
      }
    }, 220);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onQueryChange("");
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-[min(34rem,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false} label="Buscar produto no catálogo">
          <div className="flex items-center gap-2 border-b px-3">
            <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              value={query}
              onValueChange={onQueryChange}
              placeholder="SKU, código do fabricante ou descrição…"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            {state === "loading" ? <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" /> : null}
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-1">
            {query.trim().length < 2 ? (
              <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Digite ao menos 2 caracteres.</p>
            ) : state === "error" ? (
              <p className="px-3 py-6 text-center text-[13px] text-danger">Não foi possível buscar agora. Tente novamente.</p>
            ) : results.length === 0 && state === "idle" ? (
              <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Nenhum produto ativo encontrado para “{query.trim()}”.</p>
            ) : null}
            {results.map((product) => (
              <Command.Item
                key={product.id}
                value={product.id}
                onSelect={() => {
                  setOpen(false);
                  onQueryChange("");
                  onSelect(product);
                }}
                className="flex cursor-default items-start gap-3 rounded-md px-2.5 py-2 text-[13px] data-[selected=true]:bg-accent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block leading-5 font-medium">{product.description}</span>
                  <span className="block text-xs text-muted-foreground">
                    <span className="font-mono">{product.sku}</span>
                    {product.manufacturer ? ` · ${product.manufacturer}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block leading-5 tabular-nums">{product.price === null ? "Sem preço" : formatCurrency(product.price)}</span>
                  <span className="block text-xs text-muted-foreground">por {product.unit}</span>
                </span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
