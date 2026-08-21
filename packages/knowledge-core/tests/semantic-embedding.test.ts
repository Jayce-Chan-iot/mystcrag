import assert from "node:assert/strict";
import test from "node:test";

import { HashEmbeddingProvider } from "../src/search/embedding-provider.js";
import {
  FallbackEmbeddingProvider,
  SemanticEmbeddingProvider
} from "../src/search/semantic-embedding.js";

type FetchCall = { url: string; init: RequestInit };

function okResponse(vectors: number[][]): Response {
  const data = vectors.map((embedding, index) => ({ index, embedding }));
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function failureResponse(status: number): Response {
  return new Response(JSON.stringify({ error: "boom" }), { status });
}

function lastBody(call: FetchCall): { model?: string; input?: string[] } {
  return JSON.parse(String(call.init.body)) as { model?: string; input?: string[] };
}

test("semantic provider batches requests and normalizes vectors", async () => {
  const calls: FetchCall[] = [];
  const provider = new SemanticEmbeddingProvider({
    endpoint: "https://embed.example.com/v1/embeddings",
    model: "BAAI/bge-m3",
    dimensions: 4,
    maxBatchSize: 2,
    apiKey: "secret-key",
    fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const body = lastBody(calls[calls.length - 1]!);
      const input = body.input ?? [];
      // Unnormalized vectors; provider must L2-normalize.
      return okResponse(input.map(() => [3, 0, 4, 0]));
    }) as unknown as typeof fetch
  });

  const vectors = await provider.embed(["a", "b", "c"]);

  assert.equal(vectors.length, 3);
  assert.equal(calls.length, 2, "three texts at batchSize 2 => two requests");
  assert.deepEqual(
    lastBody(calls[0]!).input,
    ["a", "b"],
    "first request carries the first batch"
  );
  assert.equal(lastBody(calls[0]!).model, "BAAI/bge-m3");
  const authorization = new Headers(calls[0]!.init.headers as Headers).get("authorization");
  assert.equal(authorization, "Bearer secret-key");
  for (const vector of vectors) {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9, `vector must be L2 normalized, got norm ${norm}`);
    assert.equal(vector[0], 0.6);
  }
});

test("semantic provider rejects dimension drift and malformed payloads", async () => {
  const wrongDimensions = new SemanticEmbeddingProvider({
    endpoint: "https://embed.example.com/v1/embeddings",
    model: "bge-m3",
    dimensions: 8,
    fetchImpl: (async () => okResponse([[1, 0, 0]])) as unknown as typeof fetch
  });
  await assert.rejects(wrongDimensions.embed(["x"]), /EMBEDDING_DIMENSION_MISMATCH/);

  const wrongCount = new SemanticEmbeddingProvider({
    endpoint: "https://embed.example.com/v1/embeddings",
    model: "bge-m3",
    dimensions: 3,
    fetchImpl: (async () => okResponse([[1, 0, 0], [0, 1, 0]])) as unknown as typeof fetch
  });
  await assert.rejects(wrongCount.embed(["only-one"]), /EMBEDDING_COUNT_MISMATCH/);

  const garbage = new SemanticEmbeddingProvider({
    endpoint: "https://embed.example.com/v1/embeddings",
    model: "bge-m3",
    dimensions: 3,
    fetchImpl: (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch
  });
  await assert.rejects(garbage.embed(["x"]), /EMBEDDING_RESPONSE_INVALID/);
});

test("semantic provider retries transient failures and gives up on hard 4xx", async () => {
  let attempts = 0;
  const transient = new SemanticEmbeddingProvider({
    endpoint: "https://embed.example.com/v1/embeddings",
    model: "bge-m3",
    dimensions: 2,
    retryDelayMs: 1,
    fetchImpl: (async () => {
      attempts += 1;
      if (attempts === 1) return failureResponse(503);
      return okResponse([[1, 0]]);
    }) as unknown as typeof fetch
  });
  const recovered = await transient.embed(["x"]);
  assert.equal(recovered.length, 1);
  assert.equal(attempts, 2, "one retry after 503");

  attempts = 0;
  const hard = new SemanticEmbeddingProvider({
    endpoint: "https://embed.example.com/v1/embeddings",
    model: "bge-m3",
    dimensions: 2,
    retryDelayMs: 1,
    fetchImpl: (async () => {
      attempts += 1;
      return failureResponse(401);
    }) as unknown as typeof fetch
  });
  await assert.rejects(hard.embed(["x"]), /EMBEDDING_REQUEST_FAILED/);
  assert.equal(attempts, 1, "401 is not retried");
});

test("fallback provider starts on primary and trips to baseline after repeated failures", async () => {
  let primaryAttempts = 0;
  const flaky = new SemanticEmbeddingProvider({
    endpoint: "https://embed.example.com/v1/embeddings",
    model: "bge-m3",
    dimensions: 2,
    retryDelayMs: 1,
    retries: 0,
    fetchImpl: (async () => {
      primaryAttempts += 1;
      return failureResponse(500);
    }) as unknown as typeof fetch
  });
  const baseline = new HashEmbeddingProvider();
  const provider = new FallbackEmbeddingProvider(flaky, baseline, { failureThreshold: 3 });

  assert.equal(provider.modelId, "bge-m3");
  await assert.rejects(provider.embed(["one"]));
  await assert.rejects(provider.embed(["two"]));
  assert.equal(provider.modelId, "bge-m3", "circuit still closed after two failures");
  await assert.rejects(provider.embed(["three"]));
  assert.equal(provider.modelId, "hash-256-v1", "circuit open: baseline takes over");
  assert.equal(provider.degraded, true);
  const vectors = await provider.embed(["四色理论"]);
  assert.equal(vectors.length, 1);
  assert.equal(primaryAttempts, 3, "primary is not contacted once the circuit is open");
});

test("fallback provider resets the failure streak on success", async () => {
  let failNext = true;
  const flaky = new SemanticEmbeddingProvider({
    endpoint: "https://embed.example.com/v1/embeddings",
    model: "bge-m3",
    dimensions: 2,
    retries: 0,
    retryDelayMs: 1,
    fetchImpl: (async () =>
      failNext ? failureResponse(500) : okResponse([[1, 0]])) as unknown as typeof fetch
  });
  const provider = new FallbackEmbeddingProvider(flaky, new HashEmbeddingProvider(), {
    failureThreshold: 3
  });

  await assert.rejects(provider.embed(["a"]));
  await assert.rejects(provider.embed(["b"]));
  failNext = false;
  await provider.embed(["c"]);
  failNext = true;
  await assert.rejects(provider.embed(["d"]));
  await assert.rejects(provider.embed(["e"]));
  assert.equal(
    provider.modelId,
    "bge-m3",
    "streak reset by success means three NEW failures are required"
  );
});
