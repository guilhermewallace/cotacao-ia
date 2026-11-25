import * as React from "react";
import { FlaskConical } from "lucide-react";
import { ROLE_LABELS, roleCan, type Permission } from "@/modules/identity/permissions";
import type { AuthorizedSession } from "@/server/session";
import { Logo } from "./logo";
import { MobileNav, OrgSwitcher, UserMenu, type OrgOption } from "./menus";
import { SidebarNav, type NavKey } from "./nav";

const NAV_PERMISSIONS: Record<NavKey, Permission> = {
  dashboard: "dashboard:read",
  inbox: "inbox:read",
  quotations: "quotation:read",
  catalog: "catalog:read",
  customers: "customer:read",
  integrations: "integrations:manage",
  settings: "settings:manage",
};

export function AppShell({ session, awaitingReview, children }: { session: AuthorizedSession; awaitingReview: number; children: React.ReactNode }) {
  const { membership, memberships, user } = session;
  // A navegação só esconde o que o papel não alcança; a autorização real é feita no servidor.
  const allowed = (Object.keys(NAV_PERMISSIONS) as NavKey[]).filter((key) => roleCan(membership.role, NAV_PERMISSIONS[key]));
  const toOption = (item: typeof membership): OrgOption => ({
    id: item.organizationId,
    name: item.organizationName,
    roleLabel: ROLE_LABELS[item.role],
    isDemo: item.isDemo,
  });
  const current = toOption(membership);
  const options = memberships.map(toOption);
  const badges = { inbox: awaitingReview };

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-md">
        Pular para o conteúdo
      </a>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 border-r border-sidebar-border bg-sidebar p-3 lg:flex">
        <Logo className="px-2 pt-1.5" />
        <OrgSwitcher current={current} options={options} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav allowed={allowed} badges={badges} />
        </div>
        <UserMenu name={user.name} email={user.email} />
      </aside>

      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur lg:hidden">
        <MobileNav allowed={allowed} badges={badges}>
          <OrgSwitcher current={current} options={options} />
        </MobileNav>
        <Logo />
        <div className="ml-auto w-44">
          <UserMenu name={user.name} email={user.email} />
        </div>
      </header>

      <div className="flex min-w-0 flex-1 flex-col">
        {membership.isDemo ? (
          <div role="note" className="flex items-center justify-center gap-2 border-b border-info/15 bg-info-soft px-4 py-1.5 text-center text-xs text-foreground">
            <FlaskConical aria-hidden className="size-3.5 shrink-0 text-info" />
            <span>
              <strong className="font-semibold">Ambiente de demonstração.</strong> Empresa, clientes, produtos, preços e solicitações são fictícios.
            </span>
          </div>
        ) : null}
        <main id="conteudo" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
