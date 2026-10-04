-- Additive first-bead DIY creation idempotency.
-- Nullable for existing/legacy designs; new first-bead designs populate both.
-- The composite unique index treats NULLs as distinct in PostgreSQL, so legacy
-- rows with no creation request never collide, while one owner and one request
-- key can only ever resolve to a single design.

ALTER TABLE "designs" ADD COLUMN "creation_request_id" TEXT;
ALTER TABLE "designs" ADD COLUMN "creation_request_fingerprint" TEXT;

CREATE UNIQUE INDEX "designs_owner_id_creation_request_id_key" ON "designs"("owner_id", "creation_request_id");
