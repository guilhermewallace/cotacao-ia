"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { parseDecimalInput, toDecimalInput } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Campo numérico no formato brasileiro (vírgula decimal).
 *
 * - modo padrão: confirma ao sair do campo ou com Enter, e só dispara `onCommit` quando o
 *   valor realmente mudou (ideal para campos que gravam direto no servidor);
 * - `commitOnChange`: informa cada valor válido enquanto a pessoa digita (formulários com
 *   botão "Salvar").
 *
 * Esc desfaz a edição. Valores inválidos ficam marcados e não são enviados.
 */
export function DecimalInput({
  value,
  onCommit,
  allowEmpty = true,
  fractionDigits = 4,
  money = false,
  commitOnChange = false,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "defaultValue"> & {
  value: string | number | null;
  onCommit: (value: number | null) => void;
  allowEmpty?: boolean;
  fractionDigits?: number;
  /** Valor monetário: exibe sempre ao menos duas casas decimais. */
  money?: boolean;
  commitOnChange?: boolean;
}) {
  const minDigits = money ? 2 : 0;
  const formatted = toDecimalInput(value, fractionDigits, minDigits);
  const [text, setText] = React.useState(formatted);
  const [invalid, setInvalid] = React.useState(false);

  // Sincroniza quando o valor muda por fora (ex.: preço recalculado no servidor),
  // sem atrapalhar a digitação em andamento ("12," continua "12,").
  const [lastFormatted, setLastFormatted] = React.useState(formatted);
  if (formatted !== lastFormatted) {
    setLastFormatted(formatted);
    if (parseDecimalInput(text) !== parseDecimalInput(formatted)) {
      setText(formatted);
      setInvalid(false);
    }
  }

  const isValid = (parsed: number | null) => !Number.isNaN(parsed) && !(parsed === null && !allowEmpty) && !(parsed !== null && parsed < 0);

  function commit(raw: string): boolean {
    const parsed = parseDecimalInput(raw);
    if (!isValid(parsed)) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    if (parsed !== parseDecimalInput(formatted)) onCommit(parsed);
    return true;
  }

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      aria-invalid={invalid || props["aria-invalid"]}
      className={cn("text-right tabular-nums", className)}
      onChange={(event) => {
        setText(event.target.value);
        if (commitOnChange) commit(event.target.value);
      }}
      onBlur={() => {
        if (commit(text) && commitOnChange) setText(toDecimalInput(parseDecimalInput(text), fractionDigits, minDigits));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setText(formatted);
          setInvalid(false);
        }
      }}
    />
  );
}
