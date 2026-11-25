import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatInteger } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PageContainer({ className, wide, ...props }: React.ComponentProps<"div"> & { wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 py-6 sm:px-6 lg:px-8", wide ? "max-w-[1600px]" : "max-w-6xl", className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  meta?: React.ReactNode;
}) {
  return (
    <header className="mb-5">
      {back ? (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <ChevronLeft aria-hidden className="size-3.5" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl leading-7 font-semibold tracking-tight text-balance">{title}</h1>
          {description ? <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon aria-hidden className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

type SearchParams = Record<string, string | undefined>;

/** Monta uma URL preservando os filtros atuais e trocando apenas o que foi informado. */
export function hrefWith(pathname: string, current: SearchParams, changes: SearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...changes })) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function Pagination({
  pathname,
  searchParams,
  page,
  pageCount,
  total,
  pageSize,
  noun,
}: {
  pathname: string;
  searchParams: SearchParams;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  noun: [singular: string, plural: string];
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const link = (target: number) => hrefWith(pathname, searchParams, { page: target > 1 ? String(target) : undefined });
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
      <p className="text-[13px] text-muted-foreground">
        {formatInteger(first)}–{formatInteger(last)} de {formatInteger(total)} {total === 1 ? noun[0] : noun[1]}
      </p>
      {pageCount > 1 ? (
        <div className="flex items-center gap-2">
          <PageLink href={link(page - 1)} disabled={page <= 1} label="Anterior">
            <ChevronLeft aria-hidden />
            Anterior
          </PageLink>
          <span className="text-[13px] text-muted-foreground">
            Página {page} de {pageCount}
          </span>
          <PageLink href={link(page + 1)} disabled={page >= pageCount} label="Próxima">
            Próxima
            <ChevronRight aria-hidden />
          </PageLink>
        </div>
      ) : null}
    </nav>
  );
}

function PageLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  const className = buttonVariants({ variant: "outline", size: "sm" });
  if (disabled) {
    return (
      <span aria-disabled className={className} aria-label={label}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className} scroll>
      {children}
    </Link>
  );
}

/** Abas baseadas em URL (filtros de status). Funcionam sem JavaScript e são compartilháveis. */
export function LinkTabs({
  items,
  className,
  label,
}: {
  items: Array<{ href: string; label: string; count?: number; active: boolean }>;
  className?: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className={cn("flex gap-1 overflow-x-auto", className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
            item.active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          {item.label}
          {item.count !== undefined ? (
            <span className={cn("rounded px-1 text-xs tabular-nums", item.active ? "bg-card text-foreground" : "bg-muted text-muted-foreground")}>
              {formatInteger(item.count)}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

export function DefinitionList({ items, className }: { items: Array<{ label: string; value: React.ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 text-sm break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
