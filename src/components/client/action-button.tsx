"use client";

import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAction, type ActionResult } from "@/components/client/use-action";

type ButtonProps = React.ComponentProps<typeof Button>;

interface ActionButtonProps<T> extends Omit<ButtonProps, "onClick" | "onError"> {
  action: () => Promise<ActionResult<T>>;
  success?: string | ((data: T) => string | undefined);
  onSuccess?: (data: T) => void;
}

/** Botão que dispara uma Server Action, com indicador de carregamento. */
export function ActionButton<T>({ action, success, onSuccess, children, disabled, ...props }: ActionButtonProps<T>) {
  const { pending, run } = useAction();
  return (
    <Button {...props} disabled={disabled || pending} aria-busy={pending} onClick={() => run(action, { success, onSuccess })}>
      {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

interface ConfirmActionProps<T> extends ActionButtonProps<T> {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
}

/** Ação que pede confirmação explícita (descartar, cancelar, remover…). */
export function ConfirmActionButton<T>({ action, success, onSuccess, title, description, confirmLabel, destructive, children, ...props }: ConfirmActionProps<T>) {
  const [open, setOpen] = React.useState(false);
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button {...props}>{children}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Voltar
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            aria-busy={pending}
            onClick={() =>
              run(action, {
                success,
                onSuccess: (data) => {
                  setOpen(false);
                  onSuccess?.(data);
                },
              })
            }
          >
            {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
