import type { EmbeddingProvider } from "./embedding-provider.js";
import { HashEmbeddingProvider } from "./embedding-provider.js";
import {
  FallbackEmbeddingProvider,
  SemanticEmbeddingProvider
} from "./semantic-embedding.js";

export type EmbeddingEnv = {
  /** Full URL of an OpenAI-compatible POST embeddings endpoint. */
  KNOWLEDGE_EMBEDDING_ENDPOINT?: string;
  /** Request model name, e.g. "BAAI/bge-m3". */
  KNOWLEDGE_EMBEDDING_MODEL?: string;
  /** Expected vector dimensionality (bge-m3: 1024). */
  KNOWLEDGE_EMBEDDING_DIMENSIONS?: string;
  KNOWLEDGE_EMBEDDING_API_KEY?: string;
};

/**
 * One construction path for every KnowledgeCore consumer (worker indexing,
 * backend recommendation, MCP search) so the vector channel always reads and
 * writes the same model. Without KNOWLEDGE_EMBEDDING_ENDPOINT the
 * deterministic hash baseline serves everything; with it, the semantic
 * provider runs behind the fallback circuit breaker (ADR-9).
 */
export function createEmbeddingProviderFromEnv(
  env: EmbeddingEnv = process.env
): EmbeddingProvider {
  const endpoint = env.KNOWLEDGE_EMBEDDING_ENDPOINT;
  if (!endpoint) {
    return new HashEmbeddingProvider();
  }
  const dimensions = Number(env.KNOWLEDGE_EMBEDDING_DIMENSIONS ?? 1024);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(
      `KNOWLEDGE_EMBEDDING_DIMENSIONS must be a positive integer, got ${String(env.KNOWLEDGE_EMBEDDING_DIMENSIONS)}`
    );
  }
  return new FallbackEmbeddingProvider(
    new SemanticEmbeddingProvider({
      endpoint,
      model: env.KNOWLEDGE_EMBEDDING_MODEL ?? "BAAI/bge-m3",
      dimensions,
      apiKey: env.KNOWLEDGE_EMBEDDING_API_KEY
    }),
    new HashEmbeddingProvider()
  );
}
