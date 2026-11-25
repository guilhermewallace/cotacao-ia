"use client";

import * as React from "react";
import { Building2, ChevronsUpDown, FlaskConical, LogOut, Menu } from "lucide-react";
import { useAction } from "@/components/client/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import { signOutAction } from "@/app/login/actions";
import { switchOrganizationAction } from "@/app/(app)/actions";
import { Logo } from "./logo";
import { SidebarNav, type NavKey } from "./nav";

export interface OrgOption {
  id: string;
  name: string;
  roleLabel: string;
  isDemo: boolean;
}

export function OrgSwitcher({ current, options }: { current: OrgOption; options: OrgOption[] }) {
  const { pending, run } = useAction();
  const single = options.length <= 1;

  const trigger = (
    <button
      type="button"
      disabled={pending}
      className="flex w-full items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 text-left shadow-xs transition-colors hover:bg-accent/50 disabled:opacity-60"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Building2 aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-4 font-semibold">{current.name}</span>
        <span className="block truncate text-xs leading-4 text-muted-foreground">{current.roleLabel}</span>
      </span>
      {single ? null : <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );

  if (single) return trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Trocar de empresa</DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuCheckItem
            key={option.id}
            checked={option.id === current.id}
            onSelect={() => {
              if (option.id !== current.id) run(() => switchOrganizationAction(option.id));
            }}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 truncate font-medium">
                {option.name}
                {option.isDemo ? <FlaskConical aria-label="dados fictícios" className="!size-3" /> : null}
              </span>
              <span className="block text-xs text-muted-foreground">{option.roleLabel}</span>
            </span>
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserMenu({ name, email }: { name: string; email: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/70">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/90 text-[11px] font-semibold text-background">
            {initials(name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-4 font-medium">{name}</span>
            <span className="block truncate text-xs leading-4 text-muted-foreground">{email}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut aria-hidden />
              Sair
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Navegação em telas pequenas: a barra lateral vira um painel deslizante. */
export function MobileNav({ allowed, badges, children }: { allowed: NavKey[]; badges?: Partial<Record<NavKey, number>>; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Abrir menu">
          <Menu aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent side="left" className="gap-4 bg-sidebar p-3">
        <DialogTitle className="px-2 pt-1.5">
          <Logo />
        </DialogTitle>
        <DialogDescription className="sr-only">Menu de navegação</DialogDescription>
        {children}
        <SidebarNav allowed={allowed} badges={badges} onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
