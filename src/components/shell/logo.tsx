import { cn } from "@/lib/utils";

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" className="size-6 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path d="M9 10.5h10M9 16h14M9 21.5h7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="23" cy="21.5" r="2.2" fill="#9cc2ff" />
      </svg>
      {compact ? <span className="sr-only">Cotação IA</span> : <span className="text-[15px] font-semibold tracking-tight">Cotação IA</span>}
    </span>
  );
}
