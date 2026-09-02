-- TASK-ASSET-DB-001 SOL review fix round.
-- Strictly additive: new columns and new Restrict foreign keys only.
-- No existing table, column, index, or datum is dropped, renamed, truncated,
-- or rewritten; zero DROP/TRUNCATE/DELETE statements.

-- Manifest-declared client mtime for every source file.
ALTER TABLE "asset_source_files" ADD COLUMN "last_modified_ms" BIGINT;

-- Exact duplicates are skipped, not failed; the session counts them apart.
ALTER TABLE "asset_import_sessions" ADD COLUMN "skipped_file_count" INTEGER NOT NULL DEFAULT 0;

-- Manual curation columns required before a CrystalDraft may be promoted.
-- Defaults keep pre-existing draft rows valid but unpromotable: promotion
-- fails closed until a human fills them in.
ALTER TABLE "crystal_drafts" ADD COLUMN "color_tags" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "crystal_drafts" ADD COLUMN "visual_tags" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "crystal_drafts" ADD COLUMN "style_tags" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "crystal_drafts" ADD COLUMN "price_level" INTEGER;

-- Formal, queryable record of the operator approval decisions at publish
-- time, so the evidence no longer lives only in the still-editable draft.
-- NOT NULL is safe: bead_group_publications is created exclusively by the
-- publish transaction, which always carries the full decision set.
ALTER TABLE "bead_group_publications" ADD COLUMN "quality_statement" TEXT NOT NULL;
ALTER TABLE "bead_group_publications" ADD COLUMN "quality_source" TEXT NOT NULL;
ALTER TABLE "bead_group_publications" ADD COLUMN "rights_holder" TEXT NOT NULL;
ALTER TABLE "bead_group_publications" ADD COLUMN "usage_permission" TEXT NOT NULL;
ALTER TABLE "bead_group_publications" ADD COLUMN "is_authentic_photograph" BOOLEAN NOT NULL;
ALTER TABLE "bead_group_publications" ADD COLUMN "allow_ai_training" BOOLEAN NOT NULL;
ALTER TABLE "bead_group_publications" ADD COLUMN "allow_ai_recommendation" BOOLEAN NOT NULL;
ALTER TABLE "bead_group_publications" ADD COLUMN "allow_commercial_use" BOOLEAN NOT NULL;
ALTER TABLE "bead_group_publications" ADD COLUMN "allow_public_display" BOOLEAN NOT NULL;

-- Publish evidence is anchored to live catalog rows: deleting the published
-- product, crystal, or inventory snapshot is restricted while the
-- publication row exists.
ALTER TABLE "bead_group_publications" ADD CONSTRAINT "bead_group_publications_material_product_id_fkey" FOREIGN KEY ("material_product_id") REFERENCES "material_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "bead_group_publications" ADD CONSTRAINT "bead_group_publications_crystal_id_fkey" FOREIGN KEY ("crystal_id") REFERENCES "crystals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "bead_group_publications" ADD CONSTRAINT "bead_group_publications_inventory_snapshot_id_fkey" FOREIGN KEY ("inventory_snapshot_id") REFERENCES "inventory_snapshots"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
