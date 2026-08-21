-- Knowledge embeddings (KNOWLEDGE_SYSTEM_SPEC sections 7.1/7.2): pgvector-backed
-- semantic channel for hybrid retrieval. Vector dimension is fixed at 256 to
-- match the baseline HashEmbeddingProvider; a future semantic model provider
-- lands as a new `model` row set, not a column change.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "knowledge_embeddings" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "embedding" vector(256) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_embeddings_document_id_model_key" ON "knowledge_embeddings"("document_id", "model");
CREATE INDEX "knowledge_embeddings_embedding_hnsw_idx" ON "knowledge_embeddings" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
