"use client";

import * as React from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatInteger } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Colunas empilhadas: solicitações recebidas por dia, por canal.
 *
 * Regras de visualização adotadas:
 *  - cores categóricas em ordem FIXA por canal (a cor segue o canal, nunca a posição);
 *  - legenda sempre visível + tooltip listando todas as séries + visão em tabela,
 *    de modo que a identidade de uma série nunca dependa só da cor;
 *  - marcas finas (≤ 24px), topo arredondado, separação de 2px entre segmentos,
 *    grade discreta e um único eixo;
 *  - textos sempre em cor de texto, nunca na cor da série.
 */

export interface DayPoint {
  date: string;
  upload: number;
  email: number;
  whatsapp: number;
}

const SERIES = [
  { key: "upload", label: "Upload", color: "var(--series-1)" },
  { key: "email", label: "E-mail", color: "var(--series-2)" },
  { key: "whatsapp", label: "WhatsApp", color: "var(--series-3)" },
] as const;

const HEIGHT = 220;
const MARGIN = { top: 10, right: 8, bottom: 24, left: 30 };
const SEGMENT_GAP = 2;

function niceStep(max: number): number {
  const rough = Math.max(max, 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const candidates = [1, 2, 5, 10].map((factor) => factor * magnitude).filter((step) => step >= 1);
  return candidates.find((step) => step >= rough) ?? Math.max(1, Math.ceil(rough));
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)),
  );
}

/** Caminho de um retângulo com apenas os cantos superiores arredondados. */
function topRoundedRect(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height}V${y + r}a${r},${r} 0 0 1 ${r},${-r}h${width - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y + height}Z`;
}

function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0]?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function RequestsByDayChart({ data }: { data: DayPoint[] }) {
  const [view, setView] = React.useState<"chart" | "table">("chart");
  const [active, setActive] = React.useState<number | null>(null);
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const tooltipId = React.useId();

  const totals = data.map((point) => point.upload + point.email + point.whatsapp);
  const grandTotal = totals.reduce((sum, value) => sum + value, 0);
  const step = niceStep(Math.max(...totals, 1));
  const yMax = Math.max(step, Math.ceil(Math.max(...totals, 1) / step) * step);
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, index) => index * step);

  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = data.length > 0 ? plotWidth / data.length : 0;
  const barWidth = Math.max(Math.min(24, band - 2), 1);
  const y = (value: number) => MARGIN.top + plotHeight - (value / yMax) * plotHeight;
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(Math.floor(plotWidth / 56), 1)));

  const activePoint = active !== null ? data[active] : undefined;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (data.length === 0) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setActive((current) => Math.min(data.length - 1, Math.max(0, (current ?? (delta > 0 ? -1 : data.length)) + delta)));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(data.length - 1);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Legenda">
          {SERIES.map((series) => (
            <li key={series.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: series.color }} />
              {series.label}
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="xs" onClick={() => setView(view === "chart" ? "table" : "chart")} aria-pressed={view === "table"}>
          {view === "chart" ? <Table2 aria-hidden /> : <BarChart3 aria-hidden />}
          {view === "chart" ? "Ver tabela" : "Ver gráfico"}
        </Button>
      </div>

      {view === "table" ? (
        <div className="max-h-[220px] overflow-auto rounded-md border">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Solicitações recebidas por dia e por canal</caption>
            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  Dia
                </th>
                {SERIES.map((series) => (
                  <th key={series.key} scope="col" className="px-3 py-1.5 text-right font-medium">
                    {series.label}
                  </th>
                ))}
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((point) => (
                <tr key={point.date} className="border-t">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap">
                    {longDate(point.date)}
                  </th>
                  {SERIES.map((series) => (
                    <td key={series.key} className="px-3 py-1.5 text-right tabular-nums">
                      {formatInteger(point[series.key])}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{formatInteger(point.upload + point.email + point.whatsapp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="relative rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
          style={{ height: HEIGHT }}
          tabIndex={0}
          role="group"
          aria-label={`Gráfico de colunas: ${formatInteger(grandTotal)} solicitações em ${data.length} dias. Use as setas para percorrer os dias ou abra a tabela.`}
          aria-describedby={activePoint ? tooltipId : undefined}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          onMouseLeave={() => setActive(null)}
        >
          {width > 0 ? (
            <svg width={width} height={HEIGHT} role="presentation" className="block">
              {ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={MARGIN.left}
                    x2={width - MARGIN.right}
                    y1={y(tick)}
                    y2={y(tick)}
                    stroke={tick === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text x={MARGIN.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                    {formatInteger(tick)}
                  </text>
                </g>
              ))}

              {data.map((point, index) => {
                const x = MARGIN.left + band * index + (band - barWidth) / 2;
                const segments = SERIES.map((series) => ({ ...series, value: point[series.key] })).filter((segment) => segment.value > 0);
                let stacked = 0;
                return (
                  <g key={point.date}>
                    {active === index ? (
                      <rect x={MARGIN.left + band * index} y={MARGIN.top} width={band} height={plotHeight} className="fill-foreground/[0.05]" />
                    ) : null}
                    {segments.map((segment, segmentIndex) => {
                      const bottom = y(stacked);
                      stacked += segment.value;
                      const top = y(stacked);
                      const isTop = segmentIndex === segments.length - 1;
                      // separação de 2px (cor da superfície) entre segmentos empilhados
                      const height = Math.max(bottom - top - (isTop ? 0 : SEGMENT_GAP), 1);
                      const yTop = bottom - height;
                      return isTop ? (
                        <path key={segment.key} d={topRoundedRect(x, yTop, barWidth, height, 4)} fill={segment.color} />
                      ) : (
                        <rect key={segment.key} x={x} y={yTop} width={barWidth} height={height} fill={segment.color} />
                      );
                    })}
                    {index % labelEvery === 0 ? (
                      <text x={MARGIN.left + band * index + band / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">
                        {shortDate(point.date)}
                      </text>
                    ) : null}
                    {/* área de interação maior que a marca */}
                    <rect
                      x={MARGIN.left + band * index}
                      y={MARGIN.top}
                      width={band}
                      height={plotHeight + MARGIN.bottom}
                      fill="transparent"
                      onMouseEnter={() => setActive(index)}
                      onTouchStart={() => setActive(index)}
                    />
                  </g>
                );
              })}
            </svg>
          ) : null}

          {grandTotal === 0 && width > 0 ? (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground">
              Nenhuma solicitação recebida neste período.
            </p>
          ) : null}

          {activePoint && active !== null ? (
            <div
              id={tooltipId}
              role="status"
              className={cn("pointer-events-none absolute top-2 z-10 w-44 rounded-lg border bg-popover p-2.5 text-xs shadow-lg")}
              style={
                MARGIN.left + band * (active + 0.5) > width / 2
                  ? { right: width - (MARGIN.left + band * active) + 6 }
                  : { left: MARGIN.left + band * (active + 1) + 6 }
              }
            >
              <p className="mb-1.5 font-medium text-foreground capitalize">{longDate(activePoint.date)}</p>
              <ul className="grid gap-1">
                {SERIES.map((series) => (
                  <li key={series.key} className="flex items-center gap-1.5 text-muted-foreground">
                    <span aria-hidden className="size-2 rounded-[2px]" style={{ background: series.color }} />
                    <span className="flex-1">{series.label}</span>
                    <span className="font-medium text-foreground tabular-nums">{formatInteger(activePoint[series.key])}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 flex justify-between border-t pt-1.5 text-muted-foreground">
                Total
                <span className="font-medium text-foreground tabular-nums">
                  {formatInteger(activePoint.upload + activePoint.email + activePoint.whatsapp)}
                </span>
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
