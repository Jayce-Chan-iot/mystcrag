-- KnowledgeUsageEvent (spec section 11, EPIC 12): append-only observability
-- log for rule usage counts, recommendation outcomes, and
-- applied/modified/saved events. Collection only — never read by the
-- recommendation pipeline, never mutated after insert.

CREATE TABLE "knowledge_usage_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "design_id" TEXT,
    "revision_number" INTEGER,
    "knowledge_version" TEXT,
    "product_catalog_version" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_usage_events_event_type_created_at_idx"
    ON "knowledge_usage_events"("event_type", "created_at");

CREATE INDEX "knowledge_usage_events_design_id_created_at_idx"
    ON "knowledge_usage_events"("design_id", "created_at");

ALTER TABLE "knowledge_usage_events"
    ADD CONSTRAINT "knowledge_usage_events_design_id_fkey"
    FOREIGN KEY ("design_id") REFERENCES "designs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "knowledge_usage_events_immutable"
    BEFORE UPDATE OR DELETE ON "knowledge_usage_events"
    FOR EACH ROW EXECUTE FUNCTION prevent_immutable_row_change();
