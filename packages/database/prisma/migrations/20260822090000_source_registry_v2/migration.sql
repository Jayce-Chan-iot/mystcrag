-- Source Registry productionization (Knowledge Quality Phase Q0):
-- editorial classification, reliability, crawl policy, review workflow,
-- and fetch outcome tracking. Existing rows are grandfathered as APPROVED
-- internal/manual sources so the current fixture corpus keeps crawling.
ALTER TABLE "knowledge_sources" ADD COLUMN "source_category" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "knowledge_sources" ADD COLUMN "reliability_level" TEXT NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "knowledge_sources" ADD COLUMN "country_or_region" TEXT;
ALTER TABLE "knowledge_sources" ADD COLUMN "content_type" TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE "knowledge_sources" ADD COLUMN "crawl_strategy" JSONB;
ALTER TABLE "knowledge_sources" ADD COLUMN "review_status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW';
ALTER TABLE "knowledge_sources" ADD COLUMN "last_successful_fetch" TIMESTAMP(3);
ALTER TABLE "knowledge_sources" ADD COLUMN "last_failure" JSONB;
ALTER TABLE "knowledge_sources" ADD COLUMN "consecutive_failures" INTEGER NOT NULL DEFAULT 0;

UPDATE "knowledge_sources" SET "review_status" = 'APPROVED';

CREATE INDEX "knowledge_sources_review_enabled_idx" ON "knowledge_sources"("review_status", "enabled");
