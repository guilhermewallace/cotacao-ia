import { formatInteger, formatPercent } from "@/lib/format";

/**
 * Resultado do matching no período: barra fina segmentada + lista.
 * Rampa ordinal de um único matiz (claro → escuro): sem correspondência → ambíguo → sugestão forte.
 * Cada segmento tem rótulo e valor na lista ao lado, então a leitura não depende da cor.
 */
export function MatchOutcomesBar({ outcomes }: { outcomes: { suggested: number; ambiguous: number; noMatch: number } }) {
  const rows = [
    { key: "suggested", label: "Sugestão forte", hint: "um candidato claramente melhor", value: outcomes.suggested, color: "var(--ordinal-3)" },
    { key: "ambiguous", label: "Ambíguo", hint: "candidatos próximos, exige escolha", value: outcomes.ambiguous, color: "var(--ordinal-2)" },
    { key: "noMatch", label: "Sem correspondência", hint: "nenhum produto compatível no catálogo", value: outcomes.noMatch, color: "var(--ordinal-1)" },
  ];
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  if (total === 0) {
    return <p className="py-6 text-center text-[13px] text-muted-foreground">Nenhum item extraído neste período.</p>;
  }

  return (
    <div>
      <div
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={rows.map((row) => `${row.label}: ${row.value} (${formatPercent(row.value / total)})`).join("; ")}
      >
        {rows
          .filter((row) => row.value > 0)
          .map((row) => (
            <div key={row.key} style={{ background: row.color, flexGrow: row.value, flexBasis: 0 }} className="min-w-1" />
          ))}
      </div>
      <ul className="mt-4 grid gap-2.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-start gap-2.5 text-[13px]">
            <span aria-hidden className="mt-1 size-2.5 shrink-0 rounded-[3px]" style={{ background: row.color }} />
            <span className="min-w-0 flex-1">
              <span className="block leading-5 font-medium">{row.label}</span>
              <span className="block text-xs text-muted-foreground">{row.hint}</span>
            </span>
            <span className="text-right leading-5">
              <span className="font-medium tabular-nums">{formatInteger(row.value)}</span>
              <span className="ml-1.5 inline-block w-9 text-xs text-muted-foreground tabular-nums">{formatPercent(row.value / total)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
