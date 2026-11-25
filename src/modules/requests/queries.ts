import type { Prisma } from "@/generated/prisma/client";
import type {
  AttachmentKind,
  AttachmentStatus,
  Channel,
  InboundMessageStatus,
  Legibility,
  MatchOutcome,
  PriceSource,
  QuotationRequestStatus,
  QuotationStatus,
  RequestedItemStatus,
} from "@/generated/prisma/enums";
import { assertCan } from "@/modules/identity/permissions";
import type { AttributeComparison } from "@/modules/normalization/attribute-compare";
import { describeAttributes, sanitizeAttributes } from "@/modules/normalization/attributes";
import { resolvePrices } from "@/modules/pricing/resolve";
import { canDisplayInline } from "@/modules/storage";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/tenant-db";
import { NotFoundError } from "@/platform/errors";
import { parseId } from "@/platform/ids";

// ───────────────────────────── Listagem ─────────────────────────────

export interface RequestListFilters {
  status?: QuotationRequestStatus | "all";
  channel?: Channel | "all";
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface RequestListItem {
  id: string;
  title: string | null;
  status: QuotationRequestStatus;
  channel: Channel;
  senderName: string | null;
  senderAddress: string | null;
  customerName: string | null;
  receivedAt: Date;
  itemsCount: number;
  identifiedCount: number;
  legibility: Legibility | null;
  warningsCount: number;
  attachmentsCount: number;
  error: string | null;
  quotation: { id: string; number: string; status: QuotationStatus } | null;
}

const listInclude = {
  inboundMessage: { select: { channel: true, senderName: true, senderAddress: true, error: true, _count: { select: { attachments: true } } } },
  customer: { select: { name: true } },
  quotations: { where: { status: { not: "CANCELED" } }, select: { id: true, number: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.QuotationRequestInclude;

type ListRow = Prisma.QuotationRequestGetPayload<{ include: typeof listInclude }>;

function toListItem(row: ListRow): RequestListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    channel: row.inboundMessage.channel,
    senderName: row.inboundMessage.senderName,
    senderAddress: row.inboundMessage.senderAddress,
    customerName: row.customer?.name ?? null,
    receivedAt: row.receivedAt,
    itemsCount: row.itemsCount,
    identifiedCount: row.identifiedCount,
    legibility: row.legibility,
    warningsCount: Array.isArray(row.warnings) ? row.warnings.length : 0,
    attachmentsCount: row.inboundMessage._count.attachments,
    error: row.inboundMessage.error,
    quotation: row.quotations[0] ?? null,
  };
}

export async function listRequests(
  ctx: TenantContext,
  filters: RequestListFilters = {},
): Promise<{ items: RequestListItem[]; total: number; page: number; pageSize: number; pageCount: number }> {
  assertCan(ctx, "inbox:read");
  const pageSize = Math.min(Math.max(filters.pageSize ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const query = filters.query?.trim();

  const where: Prisma.QuotationRequestWhereInput = {
    // "Em processamento" inclui as que ainda aguardam na fila (RECEIVED).
    ...(filters.status === "PROCESSING"
      ? { status: { in: ["RECEIVED", "PROCESSING"] } }
      : filters.status && filters.status !== "all"
        ? { status: filters.status }
        : { status: { not: "DISCARDED" } }),
    ...(filters.channel && filters.channel !== "all" ? { inboundMessage: { channel: filters.channel } } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { customer: { name: { contains: query, mode: "insensitive" } } },
            { inboundMessage: { senderName: { contains: query, mode: "insensitive" } } },
            { inboundMessage: { senderAddress: { contains: query, mode: "insensitive" } } },
            { items: { some: { originalDescription: { contains: query, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const db = tenantDb(ctx.organizationId);
  const [rows, total] = await Promise.all([
    db.quotationRequest.findMany({ where, include: listInclude, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    db.quotationRequest.count({ where }),
  ]);
  return { items: rows.map(toListItem), total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

export async function countRequestsByStatus(ctx: TenantContext): Promise<Record<QuotationRequestStatus, number>> {
  assertCan(ctx, "inbox:read");
  const groups = await tenantDb(ctx.organizationId).quotationRequest.groupBy({ by: ["status"], _count: { _all: true } });
  const counts: Record<QuotationRequestStatus, number> = { RECEIVED: 0, PROCESSING: 0, AWAITING_REVIEW: 0, QUOTED: 0, FAILED: 0, DISCARDED: 0 };
  for (const group of groups) counts[group.status] = group._count._all;
  return counts;
}

/** Há solicitações recebidas ou em processamento? (a interface atualiza sozinha enquanto houver) */
export async function hasRequestsInProgress(ctx: TenantContext): Promise<boolean> {
  const count = await tenantDb(ctx.organizationId).quotationRequest.count({ where: { status: { in: ["RECEIVED", "PROCESSING"] } } });
  return count > 0;
}

// ───────────────────────────── Detalhe ─────────────────────────────

export interface CandidateView {
  productId: string;
  sku: string;
  description: string;
  manufacturer: string | null;
  unit: string;
  rank: number;
  score: number;
  compatible: boolean;
  reasons: string[];
  incompatibilities: AttributeComparison[];
  price: string | null;
  priceSource: PriceSource | null;
  priceListName: string | null;
}

export interface RequestItemView {
  id: string;
  lineNumber: number;
  originalDescription: string;
  normalizedDescription: string;
  quantity: string | null;
  extractedQuantity: string | null;
  unit: string | null;
  manufacturer: string | null;
  manufacturerCode: string | null;
  attributes: Array<{ key: string; label: string; value: string }>;
  sourceReference: { origin?: string; fileName?: string; page?: number; sheet?: string; row?: number; excerpt?: string } | null;
  sourceAttachmentId: string | null;
  confidence: number | null;
  notes: string | null;
  isManual: boolean;
  matchOutcome: MatchOutcome;
  status: RequestedItemStatus;
  selectedProduct: { id: string; sku: string; description: string; manufacturer: string | null; unit: string } | null;
  unitPrice: string | null;
  priceSource: PriceSource | null;
  /** Preço que o catálogo/lista indicaria para o produto selecionado (para comparar com preço manual). */
  catalogPrice: string | null;
  catalogPriceListName: string | null;
  candidates: CandidateView[];
  rejected: CandidateView[];
}

export interface RequestAttachmentView {
  id: string;
  fileName: string;
  kind: AttachmentKind;
  contentType: string;
  sizeBytes: number | null;
  status: AttachmentStatus;
  error: string | null;
  canInline: boolean;
  /** Texto extraído (planilha, texto de PDF, transcrição) para pré-visualização. */
  extractedText: string | null;
}

export interface RequestDetail {
  id: string;
  title: string | null;
  status: QuotationRequestStatus;
  receivedAt: Date;
  processedAt: Date | null;
  legibility: Legibility | null;
  warnings: string[];
  extractionProvider: string | null;
  extractionModel: string | null;
  itemsCount: number;
  customer: { id: string; name: string; priceListName: string | null } | null;
  customerHint: { name?: string | null; taxId?: string | null; email?: string | null; phone?: string | null; contactName?: string | null } | null;
  message: {
    channel: Channel;
    status: InboundMessageStatus;
    senderName: string | null;
    senderAddress: string | null;
    subject: string | null;
    text: string | null;
    error: string | null;
  };
  attachments: RequestAttachmentView[];
  items: RequestItemView[];
  quotations: Array<{ id: string; number: string; status: QuotationStatus }>;
  progress: { total: number; pending: number; confirmed: number; notFound: number };
}

const PREVIEW_TEXT_LIMIT = 30_000;

export async function getRequestDetail(ctx: TenantContext, requestId: string): Promise<RequestDetail> {
  assertCan(ctx, "inbox:read");
  const id = parseId(requestId, "Solicitação");
  const db = tenantDb(ctx.organizationId);

  const request = await db.quotationRequest.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, priceList: { select: { name: true } } } },
      inboundMessage: { include: { attachments: { orderBy: { createdAt: "asc" } } } },
      quotations: { select: { id: true, number: true, status: true }, orderBy: { createdAt: "desc" } },
      items: {
        orderBy: { lineNumber: "asc" },
        include: {
          selectedProduct: { select: { id: true, sku: true, description: true, manufacturer: true, unit: true } },
          matches: {
            orderBy: { rank: "asc" },
            include: { product: { select: { id: true, sku: true, description: true, manufacturer: true, unit: true } } },
          },
        },
      },
    },
  });
  if (!request) throw new NotFoundError("Solicitação");

  const productIds = new Set<string>();
  for (const item of request.items) {
    if (item.selectedProductId) productIds.add(item.selectedProductId);
    for (const match of item.matches) productIds.add(match.productId);
  }
  const prices = await resolvePrices(db, [...productIds], { customerId: request.customerId });

  const toCandidate = (match: (typeof request.items)[number]["matches"][number]): CandidateView => {
    const price = prices.get(match.productId);
    return {
      productId: match.productId,
      sku: match.product.sku,
      description: match.product.description,
      manufacturer: match.product.manufacturer,
      unit: match.product.unit,
      rank: match.rank,
      score: match.score,
      compatible: match.compatible,
      reasons: Array.isArray(match.reasons) ? (match.reasons as string[]) : [],
      incompatibilities: Array.isArray(match.incompatibilities) ? (match.incompatibilities as unknown as AttributeComparison[]) : [],
      price: price?.unitPrice?.toString() ?? null,
      priceSource: price?.source ?? null,
      priceListName: price?.priceListName ?? null,
    };
  };

  const items: RequestItemView[] = request.items.map((item) => {
    const catalog = item.selectedProductId ? prices.get(item.selectedProductId) : undefined;
    return {
      id: item.id,
      lineNumber: item.lineNumber,
      originalDescription: item.originalDescription,
      normalizedDescription: item.normalizedDescription,
      quantity: item.quantity?.toString() ?? null,
      extractedQuantity: item.extractedQuantity?.toString() ?? null,
      unit: item.unit,
      manufacturer: item.manufacturer,
      manufacturerCode: item.manufacturerCode,
      attributes: describeAttributes(sanitizeAttributes(item.attributes)),
      sourceReference: (item.sourceReference as RequestItemView["sourceReference"]) ?? null,
      sourceAttachmentId: item.sourceAttachmentId,
      confidence: item.confidence,
      notes: item.notes,
      isManual: item.isManual,
      matchOutcome: item.matchOutcome,
      status: item.status,
      selectedProduct: item.selectedProduct,
      unitPrice: item.unitPrice?.toString() ?? null,
      priceSource: item.priceSource,
      catalogPrice: catalog?.unitPrice?.toString() ?? null,
      catalogPriceListName: catalog?.priceListName ?? null,
      candidates: item.matches.filter((match) => match.compatible).map(toCandidate),
      rejected: item.matches.filter((match) => !match.compatible).map(toCandidate),
    };
  });

  return {
    id: request.id,
    title: request.title,
    status: request.status,
    receivedAt: request.receivedAt,
    processedAt: request.processedAt,
    legibility: request.legibility,
    warnings: Array.isArray(request.warnings) ? (request.warnings as string[]) : [],
    extractionProvider: request.extractionProvider,
    extractionModel: request.extractionModel,
    itemsCount: request.itemsCount,
    customer: request.customer ? { id: request.customer.id, name: request.customer.name, priceListName: request.customer.priceList?.name ?? null } : null,
    customerHint: (request.customerHint as RequestDetail["customerHint"]) ?? null,
    message: {
      channel: request.inboundMessage.channel,
      status: request.inboundMessage.status,
      senderName: request.inboundMessage.senderName,
      senderAddress: request.inboundMessage.senderAddress,
      subject: request.inboundMessage.subject,
      text: request.inboundMessage.textContent,
      error: request.inboundMessage.error,
    },
    attachments: request.inboundMessage.attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      kind: attachment.kind,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      status: attachment.status,
      error: attachment.error,
      canInline: attachment.status === "STORED" && canDisplayInline(attachment.contentType),
      extractedText: attachment.extractedText ? attachment.extractedText.slice(0, PREVIEW_TEXT_LIMIT) : null,
    })),
    items,
    quotations: request.quotations,
    progress: {
      total: items.length,
      pending: items.filter((item) => item.status === "PENDING").length,
      confirmed: items.filter((item) => item.status === "CONFIRMED").length,
      notFound: items.filter((item) => item.status === "NOT_FOUND").length,
    },
  };
}
