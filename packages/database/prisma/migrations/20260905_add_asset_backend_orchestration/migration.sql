-- TASK-ASSET-DB-002: additive backend-orchestration durability.
-- Existing import rows and lifecycle values remain unchanged. The new
-- CrystalDraft revision starts at 1 for every existing row. The immutable
-- operation ledger scopes idempotency by operation type and stores only
-- validated business payloads/results plus authenticated audit identity.

ALTER TABLE "crystal_drafts"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

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
