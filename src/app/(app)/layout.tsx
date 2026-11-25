import type * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { can } from "@/modules/identity/permissions";
import { countRequestsByStatus } from "@/modules/requests/queries";
import { requirePage } from "@/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePage();
  const awaitingReview = can(session.ctx, "inbox:read") ? (await countRequestsByStatus(session.ctx)).AWAITING_REVIEW : 0;
  return (
    <AppShell session={session} awaitingReview={awaitingReview}>
      {children}
    </AppShell>
  );
}
