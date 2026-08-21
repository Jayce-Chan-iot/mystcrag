-- Knowledge Storage (KNOWLEDGE_SYSTEM_SPEC section 7.1): sources, documents,
-- rules, and versioned publication. All foreign keys RESTRICT; every rule
-- carries mandatory provenance (source FK + source_refs JSON).

CREATE TYPE "KnowledgeStatus" AS ENUM ('NEW', 'EXTRACTED', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'CONFLICTED', 'SUPERSEDED');
CREATE TYPE "KnowledgeVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "base_url" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "authority_score" DOUBLE PRECISION NOT NULL,
    "allowed_knowledge_domains" TEXT[] NOT NULL,
    "crawl_frequency" TEXT,
    "language" TEXT NOT NULL,
    "rate_limit" JSONB,
    "legal_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "url_normalized" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content_text" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "parser" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FETCHED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Full-text search over title + clean content. The english configuration
    -- covers the ASCII/latin vocabulary; Chinese retrieval relies on the
    -- structured taxonomy filters and the vector path (documented limitation).
    "search_vector" tsvector GENERATED ALWAYS AS (
        to_tsvector('english', coalesce("title", '') || ' ' || coalesce("content_text", ''))
    ) STORED,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "KnowledgeVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "rule_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_rules" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "knowledge_type" TEXT NOT NULL,
    "knowledge_domain" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'NEW',
    "fingerprint" TEXT NOT NULL,
    "source_refs" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "knowledge_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_rules_pkey" PRIMARY KEY ("id")
);

-- Uniqueness and domain invariants
CREATE UNIQUE INDEX "knowledge_documents_content_hash_key" ON "knowledge_documents"("content_hash");
CREATE UNIQUE INDEX "knowledge_rules_fingerprint_key" ON "knowledge_rules"("fingerprint");
CREATE UNIQUE INDEX "knowledge_versions_version_key" ON "knowledge_versions"("version");

CREATE INDEX "knowledge_sources_enabled_idx" ON "knowledge_sources"("enabled");
CREATE INDEX "knowledge_documents_source_id_idx" ON "knowledge_documents"("source_id");
CREATE INDEX "knowledge_documents_source_id_fetched_at_idx" ON "knowledge_documents"("source_id", "fetched_at");
CREATE INDEX "knowledge_documents_url_normalized_idx" ON "knowledge_documents"("url_normalized");
CREATE INDEX "knowledge_documents_search_vector_idx" ON "knowledge_documents" USING GIN ("search_vector");
CREATE INDEX "knowledge_rules_status_knowledge_domain_idx" ON "knowledge_rules"("status", "knowledge_domain");
CREATE INDEX "knowledge_rules_knowledge_version_id_idx" ON "knowledge_rules"("knowledge_version_id");
CREATE INDEX "knowledge_rules_subject_relation_idx" ON "knowledge_rules"("subject", "relation");
CREATE INDEX "knowledge_versions_status_idx" ON "knowledge_versions"("status");

ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "knowledge_rules" ADD CONSTRAINT "knowledge_rules_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "knowledge_rules" ADD CONSTRAINT "knowledge_rules_knowledge_version_id_fkey" FOREIGN KEY ("knowledge_version_id") REFERENCES "knowledge_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_authority_score_range" CHECK ("authority_score" >= 0 AND "authority_score" <= 1);
ALTER TABLE "knowledge_rules" ADD CONSTRAINT "knowledge_rules_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1);
ALTER TABLE "knowledge_rules" ADD CONSTRAINT "knowledge_rules_version_positive" CHECK ("version" >= 1);
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_title_nonempty" CHECK ("title" <> '');
