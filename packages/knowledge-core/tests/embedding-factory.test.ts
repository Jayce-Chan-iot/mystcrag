import assert from "node:assert/strict";
import test from "node:test";

import { HashEmbeddingProvider } from "../src/search/embedding-provider.js";
import { createEmbeddingProviderFromEnv } from "../src/search/embedding-factory.js";
import { FallbackEmbeddingProvider } from "../src/search/semantic-embedding.js";

test("factory returns the hash baseline without an endpoint", () => {
  const provider = createEmbeddingProviderFromEnv({});
  assert.ok(provider instanceof HashEmbeddingProvider);
  assert.equal(provider.modelId, "hash-256-v1");
});

test("factory wraps a semantic provider behind the fallback circuit", () => {
  const provider = createEmbeddingProviderFromEnv({
    KNOWLEDGE_EMBEDDING_ENDPOINT: "https://embed.example.com/v1/embeddings",
    KNOWLEDGE_EMBEDDING_MODEL: "BAAI/bge-m3",
    KNOWLEDGE_EMBEDDING_DIMENSIONS: "1024"
  });
  assert.ok(provider instanceof FallbackEmbeddingProvider);
  assert.equal(provider.modelId, "BAAI/bge-m3");
  assert.equal(provider.dimensions, 1024);
});

test("factory defaults to bge-m3 at 1024 dimensions", () => {
  const provider = createEmbeddingProviderFromEnv({
    KNOWLEDGE_EMBEDDING_ENDPOINT: "https://embed.example.com/v1/embeddings"
  });
  assert.equal(provider.modelId, "BAAI/bge-m3");
  assert.equal(provider.dimensions, 1024);
});

test("factory rejects malformed dimension configuration", () => {
  assert.throws(
    () =>
      createEmbeddingProviderFromEnv({
        KNOWLEDGE_EMBEDDING_ENDPOINT: "https://embed.example.com/v1/embeddings",
        KNOWLEDGE_EMBEDDING_DIMENSIONS: "not-a-number"
      }),
    /KNOWLEDGE_EMBEDDING_DIMENSIONS/
  );
});
