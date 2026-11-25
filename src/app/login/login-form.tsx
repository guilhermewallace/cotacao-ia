"use client";

import { useActionState } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { signInAction, type LoginState } from "./actions";

const INITIAL: LoginState = { error: null, email: "" };

export function LoginForm({ next, defaultEmail }: { next: string | null; defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState(signInAction, { ...INITIAL, email: defaultEmail ?? "" });
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.error ? (
        <Alert variant="danger" role="alert">
          <TriangleAlert aria-hidden />
          <span>{state.error}</span>
        </Alert>
      ) : null}
      <Field label="E-mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" defaultValue={state.email} required autoFocus />
      </Field>
      <Field label="Senha" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending} className="mt-1 w-full">
        {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
        Entrar
      </Button>
    </form>
  );
}
