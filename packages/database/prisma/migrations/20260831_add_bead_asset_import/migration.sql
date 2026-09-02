-- TASK-ASSET-DB-001: bead asset import draft persistence, job leases and
-- transactional publication. Additive only: new enums, new tables, new
-- indexes and new partial unique constraints. No existing table, column,
-- constraint or datum is dropped, renamed or rewritten.

-- Enums mirror the accepted design contract lifecycle vocabulary exactly.

CREATE TYPE "AssetImportSessionState" AS ENUM ('CREATED', 'UPLOADING', 'ARCHIVING', 'PROCESSING', 'NEEDS_REVIEW', 'READY_TO_PUBLISH', 'PUBLISHING', 'PUBLISHED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED');

CREATE TYPE "AssetImportCheckpoint" AS ENUM ('ARCHIVED', 'GROUPED', 'LABELED', 'PROCESSED', 'REVIEWED', 'PUBLISHED');

CREATE TYPE "AssetSourceFileKind" AS ENUM ('ARW', 'JPEG', 'PNG', 'WEBP');

CREATE TYPE "AssetSourceFileState" AS ENUM ('PENDING', 'UPLOADING', 'ARCHIVED', 'FAILED', 'SKIPPED_DUPLICATE');

CREATE TYPE "BeadImageGroupState" AS ENUM ('SUGGESTED', 'CONFIRMED', 'NAMED', 'PROCESSED', 'QC_FAILED', 'READY', 'PUBLISHED');

CREATE TYPE "ProcessedAssetPurpose" AS ENUM ('MAIN', 'TEXTURE', 'MODEL', 'PREVIEW');

CREATE TYPE "ProcessedAssetState" AS ENUM ('DRAFT', 'QC_PENDING', 'QC_FAILED', 'APPROVED', 'RETIRED');

CREATE TYPE "AssetProcessingJobType" AS ENUM ('ARCHIVE_FILE', 'GROUP_SESSION', 'PROCESS_GROUP');

CREATE TYPE "AssetProcessingJobState" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TYPE "AssetUsagePermission" AS ENUM ('UNKNOWN', 'OWNED', 'GRANTED', 'PROHIBITED');

CREATE TYPE "ProductAssetBindingStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- Tables

CREATE TABLE "asset_import_sessions" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "state" "AssetImportSessionState" NOT NULL DEFAULT 'CREATED',
    "last_verified_checkpoint" "AssetImportCheckpoint",
    "declared_file_count" INTEGER NOT NULL DEFAULT 0,
    "archived_file_count" INTEGER NOT NULL DEFAULT 0,
    "failed_file_count" INTEGER NOT NULL DEFAULT 0,
    "declared_bytes" BIGINT NOT NULL DEFAULT 0,
    "uploaded_bytes" BIGINT NOT NULL DEFAULT 0,
    "manifest_idempotency_key" TEXT,
    "manifest_fingerprint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_import_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_import_sessions_idempotency_key_key" ON "asset_import_sessions"("idempotency_key");

CREATE INDEX "asset_import_sessions_state_updated_at_idx" ON "asset_import_sessions"("state", "updated_at");

CREATE TABLE "asset_source_files" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "client_file_id" TEXT NOT NULL,
    "relative_path" TEXT NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "kind" "AssetSourceFileKind" NOT NULL,
    "state" "AssetSourceFileState" NOT NULL DEFAULT 'PENDING',
    "sha256" TEXT,
    "archive_key" TEXT,
    "storage_provider" TEXT,
    "duplicate_of_id" TEXT,
    "group_id" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_source_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_source_files_session_id_client_file_id_key" ON "asset_source_files"("session_id", "client_file_id");

CREATE INDEX "asset_source_files_session_id_state_idx" ON "asset_source_files"("session_id", "state");

CREATE INDEX "asset_source_files_group_id_idx" ON "asset_source_files"("group_id");

CREATE TABLE "bead_image_groups" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "state" "BeadImageGroupState" NOT NULL DEFAULT 'SUGGESTED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "crystal_name" TEXT,
    "primary_file_id" TEXT,
    "similarity_evidence" JSONB,
    "crystal_id" TEXT,
    "crystal_draft_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bead_image_groups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bead_image_groups_session_id_state_idx" ON "bead_image_groups"("session_id", "state");

CREATE INDEX "bead_image_groups_state_updated_at_idx" ON "bead_image_groups"("state", "updated_at");

CREATE TABLE "crystal_drafts" (
    "id" TEXT NOT NULL,
    "name_cn" TEXT NOT NULL,
    "name_en" TEXT,
    "mineral_name" TEXT NOT NULL,
    "gemological_info" JSONB NOT NULL DEFAULT '{}',
    "compliance_note" TEXT NOT NULL,
    "promoted_crystal_id" TEXT,
    "promoted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crystal_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "material_product_drafts" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "crystal_name" TEXT,
    "crystal_id" TEXT,
    "crystal_draft_id" TEXT,
    "display_name" TEXT,
    "sku" TEXT,
    "material_key" TEXT,
    "shape" TEXT,
    "diameter_mm" DOUBLE PRECISION,
    "length_along_string_mm" DOUBLE PRECISION,
    "currency" "Currency",
    "unit_price_minor" BIGINT,
    "cost_minor" BIGINT,
    "available_quantity" INTEGER,
    "quality_statement" TEXT,
    "quality_source" TEXT,
    "texture_asset_key" TEXT,
    "model_asset_key" TEXT,
    "rights_holder" TEXT,
    "usage_permission" "AssetUsagePermission",
    "is_authentic_photograph" BOOLEAN,
    "allow_ai_training" BOOLEAN,
    "allow_commercial_use" BOOLEAN,
    "allow_public_display" BOOLEAN,
    "allow_ai_recommendation" BOOLEAN,
    "draft_saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_product_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_product_drafts_group_id_key" ON "material_product_drafts"("group_id");

CREATE TABLE "processed_assets" (
    "id" TEXT NOT NULL,
    "source_file_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "purpose" "ProcessedAssetPurpose" NOT NULL,
    "processing_version" INTEGER NOT NULL,
    "state" "ProcessedAssetState" NOT NULL DEFAULT 'QC_PENDING',
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "asset_key" TEXT,
    "output_sha256" TEXT NOT NULL,
    "output_bytes" BIGINT NOT NULL,
    "output_content_type" TEXT NOT NULL,
    "width_px" INTEGER,
    "height_px" INTEGER,
    "processor_version" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "qc_result" JSONB NOT NULL,
    "qc_passed_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "usage_permission" "AssetUsagePermission" NOT NULL,
    "is_authentic_photograph" BOOLEAN NOT NULL DEFAULT false,
    "allow_commercial_use" BOOLEAN NOT NULL DEFAULT false,
    "allow_public_display" BOOLEAN NOT NULL DEFAULT false,
    "is_current_version" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processed_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "processed_assets_group_id_purpose_processing_version_key" ON "processed_assets"("group_id", "purpose", "processing_version");

CREATE UNIQUE INDEX "processed_assets_asset_key_key" ON "processed_assets"("asset_key");

CREATE INDEX "processed_assets_group_id_state_idx" ON "processed_assets"("group_id", "state");

CREATE INDEX "processed_assets_asset_key_idx" ON "processed_assets"("asset_key");

CREATE TABLE "asset_processing_jobs" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "group_id" TEXT,
    "job_type" "AssetProcessingJobType" NOT NULL,
    "state" "AssetProcessingJobState" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "worker_id" TEXT,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_processing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "asset_processing_jobs_state_next_attempt_at_created_at_idx" ON "asset_processing_jobs"("state", "next_attempt_at", "created_at");

CREATE INDEX "asset_processing_jobs_state_lease_until_idx" ON "asset_processing_jobs"("state", "lease_until");

CREATE INDEX "asset_processing_jobs_session_id_state_idx" ON "asset_processing_jobs"("session_id", "state");

CREATE TABLE "product_asset_bindings" (
    "id" TEXT NOT NULL,
    "material_product_id" TEXT NOT NULL,
    "processed_asset_id" TEXT NOT NULL,
    "asset_key" TEXT NOT NULL,
    "purpose" "ProcessedAssetPurpose" NOT NULL,
    "binding_status" "ProductAssetBindingStatus" NOT NULL DEFAULT 'DRAFT',
    "allow_public_display" BOOLEAN NOT NULL DEFAULT false,
    "allow_commercial_use" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_asset_bindings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_asset_bindings_material_product_id_binding_status_idx" ON "product_asset_bindings"("material_product_id", "binding_status");

CREATE INDEX "product_asset_bindings_asset_key_binding_status_idx" ON "product_asset_bindings"("asset_key", "binding_status");

CREATE TABLE "bead_group_publications" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_fingerprint" TEXT NOT NULL,
    "material_product_id" TEXT NOT NULL,
    "crystal_id" TEXT NOT NULL,
    "inventory_snapshot_id" TEXT NOT NULL,
    "published_asset_keys" TEXT[] NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bead_group_publications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bead_group_publications_group_id_key" ON "bead_group_publications"("group_id");

CREATE UNIQUE INDEX "bead_group_publications_idempotency_key_key" ON "bead_group_publications"("idempotency_key");

CREATE INDEX "bead_group_publications_published_at_idx" ON "bead_group_publications"("published_at");

-- Foreign keys (all Restrict: drafts and history must never cascade away)

ALTER TABLE "asset_source_files" ADD CONSTRAINT "asset_source_files_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "asset_import_sessions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "asset_source_files" ADD CONSTRAINT "asset_source_files_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "asset_source_files"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "asset_source_files" ADD CONSTRAINT "asset_source_files_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "bead_image_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "bead_image_groups" ADD CONSTRAINT "bead_image_groups_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "asset_import_sessions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "bead_image_groups" ADD CONSTRAINT "bead_image_groups_crystal_id_fkey" FOREIGN KEY ("crystal_id") REFERENCES "crystals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "bead_image_groups" ADD CONSTRAINT "bead_image_groups_crystal_draft_id_fkey" FOREIGN KEY ("crystal_draft_id") REFERENCES "crystal_drafts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "crystal_drafts" ADD CONSTRAINT "crystal_drafts_promoted_crystal_id_fkey" FOREIGN KEY ("promoted_crystal_id") REFERENCES "crystals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "material_product_drafts" ADD CONSTRAINT "material_product_drafts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "bead_image_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "processed_assets" ADD CONSTRAINT "processed_assets_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "asset_source_files"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "processed_assets" ADD CONSTRAINT "processed_assets_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "bead_image_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "asset_processing_jobs" ADD CONSTRAINT "asset_processing_jobs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "asset_import_sessions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "asset_processing_jobs" ADD CONSTRAINT "asset_processing_jobs_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "bead_image_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "product_asset_bindings" ADD CONSTRAINT "product_asset_bindings_material_product_id_fkey" FOREIGN KEY ("material_product_id") REFERENCES "material_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "product_asset_bindings" ADD CONSTRAINT "product_asset_bindings_processed_asset_id_fkey" FOREIGN KEY ("processed_asset_id") REFERENCES "processed_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "bead_group_publications" ADD CONSTRAINT "bead_group_publications_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "bead_image_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Partial unique constraints Prisma cannot express. These are the database's
-- last line of defense for exact deduplication, single-current-version and
-- single-active-binding invariants.

CREATE UNIQUE INDEX "asset_source_files_session_sha256_archived_key" ON "asset_source_files"("session_id", "sha256") WHERE "state" = 'ARCHIVED';

CREATE UNIQUE INDEX "processed_assets_current_version_key" ON "processed_assets"("group_id", "purpose") WHERE "is_current_version" = true;

CREATE UNIQUE INDEX "product_asset_bindings_active_product_asset_key" ON "product_asset_bindings"("material_product_id", "purpose") WHERE "binding_status" = 'APPROVED';
