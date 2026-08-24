-- Batch B: persist the claimType contract field on knowledge rules so the
-- review gate (task book §12/§19) can read it back from the database.
ALTER TABLE "knowledge_rules" ADD COLUMN "claim_type" TEXT;
