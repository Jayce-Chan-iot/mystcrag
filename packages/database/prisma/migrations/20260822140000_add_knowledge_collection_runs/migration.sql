-- Knowledge Console V1 (task book Track B): lightweight CollectionRun
-- persistence. One row per `knowledge:collect` execution — inserted RUNNING at
-- crawl start, updated to COMPLETED/FAILED at crawl end with the run's
-- document/candidate/review counters and per-source breakdown.

CREATE TABLE "knowledge_collection_runs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "sources_crawled" INTEGER NOT NULL DEFAULT 0,
    "documents_added" INTEGER NOT NULL DEFAULT 0,
    "document_duplicates" INTEGER NOT NULL DEFAULT 0,
    "candidates_inserted" INTEGER NOT NULL DEFAULT 0,
    "corroborated_candidates" INTEGER NOT NULL DEFAULT 0,
    "candidate_duplicates" INTEGER NOT NULL DEFAULT 0,
    "needs_review" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "source_results" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_collection_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_collection_runs_started_at_idx"
    ON "knowledge_collection_runs"("started_at");
