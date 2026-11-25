import {
  AlertTriangle,
  Archive,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  ClipboardCheck,
  FilePen,
  Inbox,
  LoaderCircle,
  Mail,
  MessageCircle,
  SearchX,
  Sparkles,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Rótulos e selos de status. Todo status tem ÍCONE + TEXTO — a cor nunca é o único sinal.
 * Os tipos são literais (em vez de importar os enums do Prisma) para que este arquivo
 * possa ser usado também em Client Components.
 */

type Meta = { label: string; variant: BadgeVariant; icon: LucideIcon; spin?: boolean };

export type RequestStatus = "RECEIVED" | "PROCESSING" | "AWAITING_REVIEW" | "QUOTED" | "FAILED" | "DISCARDED";
export type QuotationStatusValue = "DRAFT" | "FINALIZED" | "CANCELED";
export type ChannelValue = "UPLOAD" | "EMAIL" | "WHATSAPP";
export type MatchOutcomeValue = "SUGGESTED" | "AMBIGUOUS" | "NO_MATCH";
export type ItemStatusValue = "PENDING" | "CONFIRMED" | "NOT_FOUND";
export type PriceSourceValue = "PRICE_LIST" | "CATALOG" | "MANUAL";

export const REQUEST_STATUS: Record<RequestStatus, Meta> = {
  RECEIVED: { label: "Recebida", variant: "neutral", icon: Inbox },
  PROCESSING: { label: "Em processamento", variant: "info", icon: LoaderCircle, spin: true },
  AWAITING_REVIEW: { label: "Aguardando revisão", variant: "warning", icon: ClipboardCheck },
  QUOTED: { label: "Cotada", variant: "success", icon: CheckCircle2 },
  FAILED: { label: "Falha no processamento", variant: "danger", icon: AlertTriangle },
  DISCARDED: { label: "Descartada", variant: "outline", icon: Archive },
};

export const QUOTATION_STATUS: Record<QuotationStatusValue, Meta> = {
  DRAFT: { label: "Rascunho", variant: "neutral", icon: FilePen },
  FINALIZED: { label: "Finalizada", variant: "success", icon: CheckCircle2 },
  CANCELED: { label: "Cancelada", variant: "outline", icon: Ban },
};

export const CHANNEL: Record<ChannelValue, { label: string; icon: LucideIcon }> = {
  UPLOAD: { label: "Upload", icon: Upload },
  EMAIL: { label: "E-mail", icon: Mail },
  WHATSAPP: { label: "WhatsApp", icon: MessageCircle },
};

export const MATCH_OUTCOME: Record<MatchOutcomeValue, Meta> = {
  SUGGESTED: { label: "Sugestão forte", variant: "info", icon: Sparkles },
  AMBIGUOUS: { label: "Ambíguo — escolha", variant: "warning", icon: CircleHelp },
  NO_MATCH: { label: "Sem correspondência", variant: "neutral", icon: SearchX },
};

export const ITEM_STATUS: Record<ItemStatusValue, Meta> = {
  PENDING: { label: "Pendente", variant: "warning", icon: CircleDashed },
  CONFIRMED: { label: "Confirmado", variant: "success", icon: CheckCircle2 },
  NOT_FOUND: { label: "Não encontrado", variant: "neutral", icon: SearchX },
};

export const PRICE_SOURCE_LABEL: Record<PriceSourceValue, string> = {
  PRICE_LIST: "Lista de preços",
  CATALOG: "Preço de catálogo",
  MANUAL: "Informado manualmente",
};

function MetaBadge({ meta, className }: { meta: Meta; className?: string }) {
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} className={className}>
      <Icon aria-hidden className={cn(meta.spin && "animate-spin")} />
      {meta.label}
    </Badge>
  );
}

export function RequestStatusBadge({ status, className }: { status: RequestStatus; className?: string }) {
  return <MetaBadge meta={REQUEST_STATUS[status]} className={className} />;
}

export function QuotationStatusBadge({ status, className }: { status: QuotationStatusValue; className?: string }) {
  return <MetaBadge meta={QUOTATION_STATUS[status]} className={className} />;
}

export function MatchOutcomeBadge({ outcome, className }: { outcome: MatchOutcomeValue; className?: string }) {
  return <MetaBadge meta={MATCH_OUTCOME[outcome]} className={className} />;
}

export function ItemStatusBadge({ status, className }: { status: ItemStatusValue; className?: string }) {
  return <MetaBadge meta={ITEM_STATUS[status]} className={className} />;
}

export function ChannelLabel({ channel, className }: { channel: ChannelValue; className?: string }) {
  const { icon: Icon, label } = CHANNEL[channel];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] text-muted-foreground", className)}>
      <Icon aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}

export function LegibilityBadge({ legibility }: { legibility: "GOOD" | "PARTIAL" | "POOR" | null }) {
  if (legibility === "PARTIAL") {
    return (
      <Badge variant="warning">
        <AlertTriangle aria-hidden />
        Legibilidade parcial
      </Badge>
    );
  }
  if (legibility === "POOR") {
    return (
      <Badge variant="danger">
        <AlertTriangle aria-hidden />
        Documento pouco legível
      </Badge>
    );
  }
  return null;
}
