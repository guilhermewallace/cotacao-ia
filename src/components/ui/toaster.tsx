"use client";

import { Toaster as Sonner } from "sonner";

/** Notificações (toasts). Região `aria-live` gerenciada pelo Sonner. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "!rounded-lg !border !border-border !bg-card !text-foreground !shadow-lg !text-[13px]",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          closeButton: "!bg-card !border-border !text-muted-foreground",
        },
      }}
    />
  );
}
