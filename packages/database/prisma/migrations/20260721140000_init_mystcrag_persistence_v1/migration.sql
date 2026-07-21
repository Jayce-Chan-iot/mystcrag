-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('CNY', 'TWD');

-- CreateEnum
CREATE TYPE "DesignMode" AS ENUM ('AI_GENERATED', 'DIY_CREATED', 'AI_ASSISTED', 'TEMPLATE_REMIX');

-- CreateEnum
CREATE TYPE "DesignStatus" AS ENUM ('DRAFT', 'GENERATED', 'SAVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('PENDING', 'PASSED', 'FLAGGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "CreatorDisplayMode" AS ENUM ('ANONYMOUS', 'DISPLAY_NAME');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PRODUCTION', 'SHIPPED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('MATERIAL', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "DesignChangeType" AS ENUM ('CREATED', 'UPDATED', 'RESTORED', 'AI_OPTIMIZED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crystals" (
    "id" TEXT NOT NULL,
    "name_cn" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "mineral_name" TEXT NOT NULL,
    "gemological_info" JSONB NOT NULL,
    "color_tags" TEXT[],
    "visual_tags" TEXT[],
    "style_tags" TEXT[],
    "emotion_tags" TEXT[],
    "culture_tags" TEXT[],
    "price_level" INTEGER NOT NULL,
    "market_availability" TEXT,
    "cost_range" JSONB,
    "image_reference" TEXT,
    "compliance_note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crystals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "emotion" TEXT[],
    "target_user" TEXT,
    "style" TEXT[],
    "color_palette" TEXT[],
    "crystal_combination" JSONB NOT NULL,
    "bead_sequence" JSONB NOT NULL,
    "metal_accessories" JSONB,
    "price_range" JSONB NOT NULL,
    "popularity_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designs" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "DesignMode" NOT NULL,
    "status" "DesignStatus" NOT NULL DEFAULT 'DRAFT',
    "schema_version" TEXT NOT NULL,
    "current_revision" INTEGER NOT NULL DEFAULT 1,
    "locale" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "current_snapshot" JSONB NOT NULL,
    "compliance_status" "ComplianceStatus" NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "publish_consent" BOOLEAN NOT NULL DEFAULT false,
    "allow_remix" BOOLEAN NOT NULL DEFAULT false,
    "creator_display_mode" "CreatorDisplayMode" NOT NULL DEFAULT 'ANONYMOUS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_revisions" (
    "id" TEXT NOT NULL,
    "design_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "schema_version" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change_type" "DesignChangeType" NOT NULL,
    "change_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_publications" (
    "id" TEXT NOT NULL,
    "design_id" TEXT NOT NULL,
    "design_revision_id" TEXT NOT NULL,
    "published_by_id" TEXT NOT NULL,
    "visibility" "Visibility" NOT NULL,
    "publish_consent" BOOLEAN NOT NULL,
    "allow_remix" BOOLEAN NOT NULL DEFAULT false,
    "creator_display_mode" "CreatorDisplayMode" NOT NULL,
    "publication_status" "PublicationStatus" NOT NULL DEFAULT 'PUBLISHED',
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unpublished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "currency" "Currency" NOT NULL,
    "total_amount_minor" BIGINT NOT NULL,
    "design_revision_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_design_snapshots" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "design_snapshot" JSONB NOT NULL,
    "pricing_snapshot" JSONB NOT NULL,
    "production_snapshot" JSONB NOT NULL,
    "currency" "Currency" NOT NULL,
    "pricing_rule_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_design_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_products" (
    "id" TEXT NOT NULL,
    "crystal_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shape" TEXT NOT NULL,
    "diameter_mm" DOUBLE PRECISION NOT NULL,
    "material_key" TEXT NOT NULL,
    "model_asset_key" TEXT,
    "texture_asset_key" TEXT,
    "currency" "Currency" NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "unit_cost_minor" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessory_products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "accessory_type" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "finish" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "model_asset_key" TEXT,
    "texture_asset_key" TEXT,
    "currency" "Currency" NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "unit_cost_minor" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accessory_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_snapshots" (
    "id" TEXT NOT NULL,
    "product_type" "ProductType" NOT NULL,
    "product_id" TEXT NOT NULL,
    "available_quantity" INTEGER NOT NULL,
    "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_version" TEXT NOT NULL,

    CONSTRAINT "inventory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rule_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "designs_owner_id_updated_at_idx" ON "designs"("owner_id", "updated_at");

-- CreateIndex
CREATE INDEX "designs_status_deleted_at_idx" ON "designs"("status", "deleted_at");

-- CreateIndex
CREATE INDEX "design_revisions_created_by_created_at_idx" ON "design_revisions"("created_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "design_revisions_design_id_revision_number_key" ON "design_revisions"("design_id", "revision_number");

-- CreateIndex
CREATE INDEX "design_publications_publication_status_published_at_idx" ON "design_publications"("publication_status", "published_at");

-- CreateIndex
CREATE INDEX "design_publications_design_id_publication_status_idx" ON "design_publications"("design_id", "publication_status");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_design_revision_id_idx" ON "orders"("design_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_design_snapshots_order_id_key" ON "order_design_snapshots"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_products_sku_key" ON "material_products"("sku");

-- CreateIndex
CREATE INDEX "material_products_crystal_id_active_idx" ON "material_products"("crystal_id", "active");

-- CreateIndex
CREATE INDEX "material_products_currency_active_idx" ON "material_products"("currency", "active");

-- CreateIndex
CREATE UNIQUE INDEX "accessory_products_sku_key" ON "accessory_products"("sku");

-- CreateIndex
CREATE INDEX "accessory_products_currency_active_idx" ON "accessory_products"("currency", "active");

-- CreateIndex
CREATE INDEX "inventory_snapshots_product_type_product_id_captured_at_idx" ON "inventory_snapshots"("product_type", "product_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_snapshots_product_type_product_id_source_version_key" ON "inventory_snapshots"("product_type", "product_id", "source_version");

-- CreateIndex
CREATE INDEX "pricing_rules_currency_active_idx" ON "pricing_rules"("currency", "active");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rules_version_currency_key" ON "pricing_rules"("version", "currency");

-- AddForeignKey
ALTER TABLE "designs" ADD CONSTRAINT "designs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_revisions" ADD CONSTRAINT "design_revisions_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_revisions" ADD CONSTRAINT "design_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_publications" ADD CONSTRAINT "design_publications_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_publications" ADD CONSTRAINT "design_publications_design_revision_id_fkey" FOREIGN KEY ("design_revision_id") REFERENCES "design_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_publications" ADD CONSTRAINT "design_publications_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_design_revision_id_fkey" FOREIGN KEY ("design_revision_id") REFERENCES "design_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_design_snapshots" ADD CONSTRAINT "order_design_snapshots_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_products" ADD CONSTRAINT "material_products_crystal_id_fkey" FOREIGN KEY ("crystal_id") REFERENCES "crystals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants not expressible in Prisma schema syntax.
ALTER TABLE "designs"
  ADD CONSTRAINT "designs_current_revision_positive" CHECK ("current_revision" >= 1);
ALTER TABLE "design_revisions"
  ADD CONSTRAINT "design_revisions_revision_number_positive" CHECK ("revision_number" >= 1);
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_amount_minor_nonnegative" CHECK ("total_amount_minor" >= 0);
ALTER TABLE "material_products"
  ADD CONSTRAINT "material_products_money_nonnegative" CHECK ("unit_price_minor" >= 0 AND "unit_cost_minor" >= 0),
  ADD CONSTRAINT "material_products_diameter_positive" CHECK ("diameter_mm" > 0);
ALTER TABLE "accessory_products"
  ADD CONSTRAINT "accessory_products_money_nonnegative" CHECK ("unit_price_minor" >= 0 AND "unit_cost_minor" >= 0);
ALTER TABLE "inventory_snapshots"
  ADD CONSTRAINT "inventory_snapshots_quantities_nonnegative" CHECK ("available_quantity" >= 0 AND "reserved_quantity" >= 0);
ALTER TABLE "design_publications"
  ADD CONSTRAINT "design_publications_consent_and_visibility" CHECK ("publish_consent" = true AND "visibility" <> 'PRIVATE'),
  ADD CONSTRAINT "design_publications_status_timestamp" CHECK (
    ("publication_status" = 'PUBLISHED' AND "unpublished_at" IS NULL)
    OR ("publication_status" = 'UNPUBLISHED' AND "unpublished_at" IS NOT NULL)
  );

CREATE FUNCTION prevent_immutable_row_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "design_revisions_immutable"
BEFORE UPDATE OR DELETE ON "design_revisions"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_row_change();

CREATE TRIGGER "order_design_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "order_design_snapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_row_change();

CREATE FUNCTION prevent_order_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'orders cannot be physically deleted' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "orders_no_delete"
BEFORE DELETE ON "orders"
FOR EACH ROW EXECUTE FUNCTION prevent_order_delete();
