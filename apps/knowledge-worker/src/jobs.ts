/**
 * Knowledge ingestion job contracts (KNOWLEDGE_SYSTEM_SPEC section 7.3).
 * Job names double as pg-boss queue names; the pgboss schema is managed by
 * pg-boss itself and stays out of prisma migrate.
 */
export const KNOWLEDGE_JOBS = {
  /** Iterates enabled sources and enqueues one fetch-document per source. */
  discoverSource: "discover-source",
  /** Runs the full ingestion pipeline for one source (E2E-1 chain). */
  fetchDocument: "fetch-document",
  /** Indexes embeddings for documents without a vector yet. */
  generateEmbedding: "generate-embedding",
  /** Creates and publishes a knowledge version from APPROVED rules. */
  publishKnowledge: "publish-knowledge",
  /** Terminal queue for jobs that exhausted their retries. */
  deadLetter: "knowledge-dead-letter"
} as const;

export type DiscoverSourceJobData = Record<string, never>;

export type FetchDocumentJobData = {
  sourceId: string;
};

export type GenerateEmbeddingJobData = {
  limit?: number;
};

export type PublishKnowledgeJobData = {
  version: string;
};

export type DiscoverSourceJobResult = {
  enqueued: Array<{ sourceId: string; jobId: string }>;
  skipped: string[];
};

export type FetchDocumentJobResult = {
  sourceId: string;
  createdDocuments: number;
  duplicateDocuments: number;
  insertedCandidates: number;
  duplicateCandidates: number;
  documentUrls: string[];
};

export type GenerateEmbeddingJobResult = {
  indexed: number;
  model: string | null;
};

export type PublishKnowledgeJobResult = {
  versionId: string;
  version: string;
  status: string;
};
