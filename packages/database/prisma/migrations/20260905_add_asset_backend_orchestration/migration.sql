-- TASK-ASSET-DB-002: additive backend-orchestration durability.
-- Existing import rows and lifecycle values remain unchanged. The new
-- CrystalDraft revision starts at 1 for every existing row. Existing
-- publication rows retain a nullable publisher actor while every new
-- repository publication records one. The immutable operation ledger scopes
-- idempotency by operation type and stores only validated business
-- payloads/results plus authenticated audit identity.

ALTER TABLE "crystal_drafts"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "bead_group_publications"
ADD COLUMN "published_by_actor_id" TEXT;

CREATE TABLE "asset_import_operations" (
    "id" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload_fingerprint" TEXT NOT NULL,
    "request_payload" JSONB NOT NULL,
    "result_payload" JSONB NOT NULL,
    "actor_id" TEXT,
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_import_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_import_operations_operation_type_idempotency_key_key"
ON "asset_import_operations"("operation_type", "idempotency_key");

CREATE INDEX "asset_import_ops_aggregate_type_created_idx"
ON "asset_import_operations"("aggregate_id", "operation_type", "created_at");

CREATE FUNCTION "reject_asset_import_operation_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'asset_import_operations is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "asset_import_operations_append_only"
BEFORE UPDATE OR DELETE ON "asset_import_operations"
FOR EACH ROW
EXECUTE FUNCTION "reject_asset_import_operation_mutation"();
