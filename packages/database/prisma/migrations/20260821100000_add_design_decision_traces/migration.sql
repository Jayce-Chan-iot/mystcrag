-- DesignDecisionTrace sidecar (spec section 7.1 / ADR-1): one immutable
-- trace per (design_id, revision_number), appended on generation and
-- revision, never updated or deleted.

CREATE TABLE "design_decision_traces" (
    "id" TEXT NOT NULL,
    "design_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "trace" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_decision_traces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "design_decision_traces_design_id_revision_number_key"
    ON "design_decision_traces"("design_id", "revision_number");

ALTER TABLE "design_decision_traces"
    ADD CONSTRAINT "design_decision_traces_design_id_fkey"
    FOREIGN KEY ("design_id") REFERENCES "designs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "design_decision_traces_immutable"
BEFORE UPDATE OR DELETE ON "design_decision_traces"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_row_change();
