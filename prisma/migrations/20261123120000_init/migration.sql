-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'SELLER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProductAliasType" AS ENUM ('SYNONYM', 'MANUFACTURER_CODE');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('WHATSAPP_CLOUD', 'EMAIL_INBOUND');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('UPLOAD', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "InboundMessageStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PDF', 'SPREADSHEET', 'IMAGE', 'AUDIO', 'TEXT', 'OTHER');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING_DOWNLOAD', 'STORED', 'FAILED', 'REJECTED', 'PURGED');

-- CreateEnum
CREATE TYPE "QuotationRequestStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'AWAITING_REVIEW', 'QUOTED', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "Legibility" AS ENUM ('GOOD', 'PARTIAL', 'POOR');

-- CreateEnum
CREATE TYPE "MatchOutcome" AS ENUM ('SUGGESTED', 'AMBIGUOUS', 'NO_MATCH');

-- CreateEnum
CREATE TYPE "RequestedItemStatus" AS ENUM ('PENDING', 'CONFIRMED', 'NOT_FOUND');

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('PRICE_LIST', 'CATALOG', 'MANUAL');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProcessingJobType" AS ENUM ('PROCESS_INBOUND_MESSAGE', 'CATALOG_IMPORT', 'PRICE_LIST_IMPORT', 'RETENTION_PURGE');

-- CreateEnum
CREATE TYPE "ProcessingJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'WEBHOOK');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "inbound_email_key" TEXT NOT NULL,
    "quotation_sequence" INTEGER NOT NULL DEFAULT 0,
    "default_quotation_validity_days" INTEGER NOT NULL DEFAULT 15,
    "document_retention_days" INTEGER,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "auth_provider_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'SELLER',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "contact_name" TEXT,
    "notes" TEXT,
    "price_list_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "sku_normalized" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "description_normalized" TEXT NOT NULL,
    "manufacturer" TEXT,
    "manufacturer_code" TEXT,
    "manufacturer_code_normalized" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "price" DECIMAL(14,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "ProductAliasType" NOT NULL,
    "value" TEXT NOT NULL,
    "value_normalized" TEXT NOT NULL,
    "manufacturer" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" DATE,
    "valid_until" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit_price" DECIMAL(14,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'INACTIVE',
    "display_name" TEXT,
    "external_account_id" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "credentials_encrypted" TEXT,
    "last_event_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "external_id" TEXT NOT NULL,
    "integration_id" UUID,
    "customer_id" UUID,
    "uploaded_by_id" UUID,
    "sender_name" TEXT,
    "sender_address" TEXT,
    "subject" TEXT,
    "text_content" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "InboundMessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "inbound_message_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "storage_key" TEXT,
    "sha256" TEXT,
    "kind" "AttachmentKind" NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'STORED',
    "external_media_id" TEXT,
    "extracted_text" TEXT,
    "error" TEXT,
    "purged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "integration_id" UUID,
    "channel" "Channel" NOT NULL,
    "event_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "inbound_message_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" "QuotationRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "title" TEXT,
    "customer_hint" JSONB,
    "extraction_provider" TEXT,
    "extraction_model" TEXT,
    "legibility" "Legibility",
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "items_count" INTEGER NOT NULL DEFAULT 0,
    "identified_count" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "processing_started_at" TIMESTAMPTZ(3),
    "processed_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requested_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "quotation_request_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "original_description" TEXT NOT NULL,
    "normalized_description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3),
    "extracted_quantity" DECIMAL(14,3),
    "unit" TEXT,
    "manufacturer" TEXT,
    "manufacturer_code" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "source_attachment_id" UUID,
    "source_reference" JSONB,
    "confidence" DOUBLE PRECISION,
    "notes" TEXT,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "match_outcome" "MatchOutcome" NOT NULL DEFAULT 'NO_MATCH',
    "status" "RequestedItemStatus" NOT NULL DEFAULT 'PENDING',
    "selected_product_id" UUID,
    "unit_price" DECIMAL(14,4),
    "price_source" "PriceSource",
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requested_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "requested_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "compatible" BOOLEAN NOT NULL,
    "strategies" TEXT[],
    "signals" JSONB NOT NULL DEFAULT '{}',
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "incompatibilities" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "quotation_request_id" UUID,
    "customer_id" UUID,
    "price_list_id" UUID,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "customer_name" TEXT NOT NULL,
    "customer_tax_id" TEXT,
    "customer_email" TEXT,
    "customer_phone" TEXT,
    "customer_contact" TEXT,
    "issue_date" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "notes" TEXT,
    "payment_terms" TEXT,
    "delivery_terms" TEXT,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "created_by_id" UUID,
    "finalized_by_id" UUID,
    "finalized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "requested_item_id" UUID,
    "product_id" UUID,
    "sku" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(14,4),
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "price_source" "PriceSource",
    "available" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "type" "ProcessingJobType" NOT NULL,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotency_key" TEXT NOT NULL,
    "inbound_message_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "last_error" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "heartbeat_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_inbound_email_key_key" ON "organizations"("inbound_email_key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_provider_id_key" ON "users"("auth_provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_id_key" ON "customers"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_tax_id_key" ON "customers"("organization_id", "tax_id");

-- CreateIndex
CREATE INDEX "customers_organization_id_name_idx" ON "customers"("organization_id", "name");

-- CreateIndex
CREATE INDEX "customers_organization_id_email_idx" ON "customers"("organization_id", "email");

-- CreateIndex
CREATE INDEX "customers_organization_id_phone_idx" ON "customers"("organization_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_id_key" ON "products"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_sku_normalized_key" ON "products"("organization_id", "sku_normalized");

-- CreateIndex
CREATE INDEX "products_organization_id_manufacturer_code_normalized_idx" ON "products"("organization_id", "manufacturer_code_normalized");

-- CreateIndex
CREATE INDEX "products_organization_id_category_idx" ON "products"("organization_id", "category");

-- CreateIndex
CREATE INDEX "products_organization_id_is_active_idx" ON "products"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "products_description_normalized_trgm_idx" ON "products" USING GIN ("description_normalized" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "product_aliases_org_product_type_value_key" ON "product_aliases"("organization_id", "product_id", "type", "value_normalized");

-- CreateIndex
CREATE INDEX "product_aliases_organization_id_type_value_normalized_idx" ON "product_aliases"("organization_id", "type", "value_normalized");

-- CreateIndex
CREATE INDEX "product_aliases_value_normalized_trgm_idx" ON "product_aliases" USING GIN ("value_normalized" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_organization_id_id_key" ON "price_lists"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_organization_id_name_key" ON "price_lists"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_items_price_list_id_product_id_key" ON "price_list_items"("price_list_id", "product_id");

-- CreateIndex
CREATE INDEX "price_list_items_organization_id_product_id_idx" ON "price_list_items"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_organization_id_id_key" ON "integrations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_organization_id_type_key" ON "integrations"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_type_external_account_id_key" ON "integrations"("type", "external_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_organization_id_id_key" ON "inbound_messages"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_organization_id_channel_external_id_key" ON "inbound_messages"("organization_id", "channel", "external_id");

-- CreateIndex
CREATE INDEX "inbound_messages_organization_id_received_at_idx" ON "inbound_messages"("organization_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "inbound_messages_organization_id_status_idx" ON "inbound_messages"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_organization_id_id_key" ON "attachments"("organization_id", "id");

-- CreateIndex
CREATE INDEX "attachments_organization_id_inbound_message_id_idx" ON "attachments"("organization_id", "inbound_message_id");

-- CreateIndex
CREATE INDEX "attachments_organization_id_created_at_idx" ON "attachments"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "channel_events_organization_id_channel_external_id_key" ON "channel_events"("organization_id", "channel", "external_id");

-- CreateIndex
CREATE INDEX "channel_events_organization_id_created_at_idx" ON "channel_events"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "quotation_requests_organization_id_id_key" ON "quotation_requests"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_requests_organization_id_inbound_message_id_key" ON "quotation_requests"("organization_id", "inbound_message_id");

-- CreateIndex
CREATE INDEX "quotation_requests_organization_id_status_received_at_idx" ON "quotation_requests"("organization_id", "status", "received_at" DESC);

-- CreateIndex
CREATE INDEX "quotation_requests_organization_id_customer_id_idx" ON "quotation_requests"("organization_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "requested_items_organization_id_id_key" ON "requested_items"("organization_id", "id");

-- CreateIndex
CREATE INDEX "requested_items_org_request_line_idx" ON "requested_items"("organization_id", "quotation_request_id", "line_number");

-- CreateIndex
CREATE INDEX "requested_items_organization_id_selected_product_id_idx" ON "requested_items"("organization_id", "selected_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_matches_requested_item_id_product_id_key" ON "product_matches"("requested_item_id", "product_id");

-- CreateIndex
CREATE INDEX "product_matches_organization_id_requested_item_id_rank_idx" ON "product_matches"("organization_id", "requested_item_id", "rank");

-- CreateIndex
CREATE INDEX "product_matches_organization_id_product_id_idx" ON "product_matches"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_organization_id_id_key" ON "quotations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_organization_id_number_key" ON "quotations"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_organization_id_sequence_key" ON "quotations"("organization_id", "sequence");

-- CreateIndex
CREATE INDEX "quotations_organization_id_status_created_at_idx" ON "quotations"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quotations_organization_id_customer_id_idx" ON "quotations"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "quotations_organization_id_quotation_request_id_idx" ON "quotations"("organization_id", "quotation_request_id");

-- CreateIndex
CREATE INDEX "quotation_items_organization_id_quotation_id_line_number_idx" ON "quotation_items"("organization_id", "quotation_id", "line_number");

-- CreateIndex
CREATE INDEX "quotation_items_organization_id_product_id_idx" ON "quotation_items"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "quotation_items_organization_id_requested_item_id_idx" ON "quotation_items"("organization_id", "requested_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "processing_jobs_organization_id_idempotency_key_key" ON "processing_jobs"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "processing_jobs_status_heartbeat_at_idx" ON "processing_jobs"("status", "heartbeat_at");

-- CreateIndex
CREATE INDEX "processing_jobs_organization_id_inbound_message_id_idx" ON "processing_jobs"("organization_id", "inbound_message_id");

-- CreateIndex
CREATE INDEX "processing_jobs_organization_id_type_created_at_idx" ON "processing_jobs"("organization_id", "type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_entity_type_entity_id_idx" ON "audit_logs"("organization_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_price_list_id_fkey" FOREIGN KEY ("organization_id", "price_list_id") REFERENCES "price_lists"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_organization_id_price_list_id_fkey" FOREIGN KEY ("organization_id", "price_list_id") REFERENCES "price_lists"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_organization_id_integration_id_fkey" FOREIGN KEY ("organization_id", "integration_id") REFERENCES "integrations"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_inbound_message_id_fkey" FOREIGN KEY ("organization_id", "inbound_message_id") REFERENCES "inbound_messages"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_events" ADD CONSTRAINT "channel_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_events" ADD CONSTRAINT "channel_events_organization_id_integration_id_fkey" FOREIGN KEY ("organization_id", "integration_id") REFERENCES "integrations"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_requests" ADD CONSTRAINT "quotation_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_requests" ADD CONSTRAINT "quotation_requests_organization_id_inbound_message_id_fkey" FOREIGN KEY ("organization_id", "inbound_message_id") REFERENCES "inbound_messages"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_requests" ADD CONSTRAINT "quotation_requests_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_requests" ADD CONSTRAINT "quotation_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_organization_id_quotation_request_id_fkey" FOREIGN KEY ("organization_id", "quotation_request_id") REFERENCES "quotation_requests"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_organization_id_source_attachment_id_fkey" FOREIGN KEY ("organization_id", "source_attachment_id") REFERENCES "attachments"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_organization_id_selected_product_id_fkey" FOREIGN KEY ("organization_id", "selected_product_id") REFERENCES "products"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_organization_id_requested_item_id_fkey" FOREIGN KEY ("organization_id", "requested_item_id") REFERENCES "requested_items"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_organization_id_quotation_request_id_fkey" FOREIGN KEY ("organization_id", "quotation_request_id") REFERENCES "quotation_requests"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_organization_id_price_list_id_fkey" FOREIGN KEY ("organization_id", "price_list_id") REFERENCES "price_lists"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_organization_id_quotation_id_fkey" FOREIGN KEY ("organization_id", "quotation_id") REFERENCES "quotations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_organization_id_requested_item_id_fkey" FOREIGN KEY ("organization_id", "requested_item_id") REFERENCES "requested_items"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_organization_id_inbound_message_id_fkey" FOREIGN KEY ("organization_id", "inbound_message_id") REFERENCES "inbound_messages"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

