"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Inbox, LayoutDashboard, Package, Plug, Settings, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavKey = "dashboard" | "inbox" | "quotations" | "catalog" | "customers" | "integrations" | "settings";

const ITEMS: Array<{ key: NavKey; href: string; label: string; icon: LucideIcon; match: string[]; group: "work" | "admin" }> = [
  { key: "dashboard", href: "/dashboard", label: "Painel", icon: LayoutDashboard, match: ["/dashboard"], group: "work" },
  { key: "inbox", href: "/caixa-de-entrada", label: "Caixa de entrada", icon: Inbox, match: ["/caixa-de-entrada", "/solicitacoes"], group: "work" },
  { key: "quotations", href: "/cotacoes", label: "Cotações", icon: FileText, match: ["/cotacoes"], group: "work" },
  { key: "catalog", href: "/catalogo", label: "Catálogo", icon: Package, match: ["/catalogo"], group: "work" },
  { key: "customers", href: "/clientes", label: "Clientes", icon: Users, match: ["/clientes"], group: "work" },
  { key: "integrations", href: "/integracoes", label: "Integrações", icon: Plug, match: ["/integracoes"], group: "admin" },
  { key: "settings", href: "/configuracoes", label: "Configurações", icon: Settings, match: ["/configuracoes"], group: "admin" },
];

export function SidebarNav({ allowed, badges, onNavigate }: { allowed: NavKey[]; badges?: Partial<Record<NavKey, number>>; onNavigate?: () => void }) {
  const pathname = usePathname();
  const visible = ITEMS.filter((item) => allowed.includes(item.key));
  const groups = [
    { id: "work", label: null, items: visible.filter((item) => item.group === "work") },
    { id: "admin", label: "Administração", items: visible.filter((item) => item.group === "admin") },
  ].filter((group) => group.items.length > 0);

  return (
    <nav aria-label="Navegação principal" className="grid gap-4">
      {groups.map((group) => (
        <div key={group.id} className="grid gap-0.5">
          {group.label ? <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group.label}</p> : null}
          {group.items.map((item) => {
            const active = item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
            const badge = badges?.[item.key];
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors",
                  active ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon aria-hidden className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
                <span className="flex-1 truncate">{item.label}</span>
                {badge ? (
                  <span className="rounded bg-card px-1.5 text-xs text-muted-foreground tabular-nums shadow-xs" title={`${badge} aguardando revisão`}>
                    {badge > 99 ? "99+" : badge}
                    <span className="sr-only"> aguardando revisão</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
