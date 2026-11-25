-- Objetos que o schema do Prisma não representa: índice de busca textual por expressão,
-- índice único parcial e restrições CHECK de domínio.

-- Busca textual (FTS) em português sobre o texto normalizado do produto
-- (descrição + fabricante + códigos + sinônimos).
CREATE INDEX "products_search_text_fts_idx" ON "products" USING GIN (to_tsvector('portuguese', "search_text"));

-- No máximo uma lista de preços padrão por organização.
CREATE UNIQUE INDEX "price_lists_one_default_per_org_idx" ON "price_lists" ("organization_id") WHERE "is_default";

-- E-mails sempre em minúsculas (a unicidade não pode depender de caixa).
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_retention_days_check" CHECK ("document_retention_days" IS NULL OR "document_retention_days" >= 1);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_validity_days_check" CHECK ("default_quotation_validity_days" >= 1);

-- Preços nunca negativos.
ALTER TABLE "products" ADD CONSTRAINT "products_price_non_negative_check" CHECK ("price" IS NULL OR "price" >= 0);
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_unit_price_non_negative_check" CHECK ("unit_price" >= 0);

-- Itens solicitados: quantidade positiva e item confirmado sempre aponta para um produto.
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_quantity_positive_check" CHECK ("quantity" IS NULL OR "quantity" > 0);
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_unit_price_non_negative_check" CHECK ("unit_price" IS NULL OR "unit_price" >= 0);
ALTER TABLE "requested_items" ADD CONSTRAINT "requested_items_confirmed_has_product_check" CHECK ("status" <> 'CONFIRMED' OR "selected_product_id" IS NOT NULL);

-- Cotações.
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_discount_percent_range_check" CHECK ("discount_percent" >= 0 AND "discount_percent" <= 100);
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_valid_until_check" CHECK ("valid_until" >= "issue_date");
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_unit_price_non_negative_check" CHECK ("unit_price" IS NULL OR "unit_price" >= 0);
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_discount_percent_range_check" CHECK ("discount_percent" >= 0 AND "discount_percent" <= 100);
