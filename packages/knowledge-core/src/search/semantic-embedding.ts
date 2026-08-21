import type { EmbeddingProvider } from "./embedding-provider.js";

/**
 * Semantic embedding provider speaking the OpenAI-compatible
 * `POST {endpoint}` embeddings contract (`{ model, input }` →
 * `{ data: [{ index, embedding }] }`). Serves BGE-M3 style models behind
 * TEI, Ollama, SiliconFlow, vLLM, and OpenAI itself (ADR-9 option B/C).
 * Embedding stays strictly server-side (spec section 25).
 */
export type SemanticEmbeddingOptions = {
  endpoint: string;
  /** Request model name, e.g. "BAAI/bge-m3". */
  model: string;
  /** Vector dimensionality the server must return (bge-m3: 1024). */
  dimensions: number;
  apiKey?: string;
  /** Requests per embed() call. Default 64. */
  maxBatchSize?: number;
  /** Retries on network errors, 429, and 5xx. Default 2. */
  retries?: number;
  /** Base backoff between retries. Default 200ms. */
  retryDelayMs?: number;
  /** Per-request timeout. Default 30_000ms. */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
};

type EmbeddingsResponse = {
  data?: Array<{ index?: number; embedding?: unknown }>;
};

const DEFAULT_BATCH = 64;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 200;
const DEFAULT_TIMEOUT_MS = 30_000;

export class SemanticEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  private readonly options: Required<Pick<SemanticEmbeddingOptions, "endpoint" | "model" | "dimensions" | "maxBatchSize" | "retries" | "retryDelayMs" | "timeoutMs">> &
    Pick<SemanticEmbeddingOptions, "apiKey"> & { fetchImpl?: typeof fetch };

  constructor(options: SemanticEmbeddingOptions) {
    this.options = {
      endpoint: options.endpoint,
      model: options.model,
      dimensions: options.dimensions,
      maxBatchSize: options.maxBatchSize ?? DEFAULT_BATCH,
      retries: options.retries ?? DEFAULT_RETRIES,
      retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl
    };
    this.modelId = options.model;
    this.dimensions = options.dimensions;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += this.options.maxBatchSize) {
      const batch = texts.slice(offset, offset + this.options.maxBatchSize);
      vectors.push(...(await this.embedBatch(batch)));
    }
    return vectors;
  }

  private async embedBatch(batch: readonly string[]): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      if (attempt > 0) {
        await sleep(this.options.retryDelayMs * 2 ** (attempt - 1));
      }
      try {
        return await this.embedBatchOnce(batch);
      } catch (error) {
        lastError = error;
        if (!(error instanceof TransientEmbeddingError)) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  private async embedBatchOnce(batch: readonly string[]): Promise<number[][]> {
    const headers = new Headers({ "content-type": "application/json" });
    if (this.options.apiKey !== undefined) {
      headers.set("authorization", `Bearer ${this.options.apiKey}`);
    }
    const doFetch = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await doFetch(this.options.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.options.model, input: batch }),
        signal: AbortSignal.timeout(this.options.timeoutMs)
      });
    } catch (error) {
      throw new TransientEmbeddingError(
        `EMBEDDING_REQUEST_FAILED: ${(error as Error).message}`
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new TransientEmbeddingError(
        `EMBEDDING_REQUEST_FAILED: endpoint responded ${response.status}`
      );
    }
    if (!response.ok) {
      throw new Error(`EMBEDDING_REQUEST_FAILED: endpoint responded ${response.status}`);
    }
    let body: EmbeddingsResponse;
    try {
      body = (await response.json()) as EmbeddingsResponse;
    } catch (error) {
      throw new Error(`EMBEDDING_RESPONSE_INVALID: ${(error as Error).message}`);
    }
    if (!Array.isArray(body.data) || body.data.length !== batch.length) {
      throw new Error(
        `EMBEDDING_COUNT_MISMATCH: expected ${batch.length} vectors, got ${body.data?.length ?? "none"}`
      );
    }
    const ordered = new Array<number[] | undefined>(batch.length);
    for (const entry of body.data) {
      const index = entry.index ?? body.data.indexOf(entry);
      const vector = entry.embedding;
      if (typeof index !== "number" || index < 0 || index >= batch.length) {
        throw new Error(`EMBEDDING_RESPONSE_INVALID: bad index ${String(entry.index)}`);
      }
      if (!Array.isArray(vector) || vector.length !== this.dimensions) {
        throw new Error(
          `EMBEDDING_DIMENSION_MISMATCH: expected ${this.dimensions}, got ${
            Array.isArray(vector) ? vector.length : "non-array"
          }`
        );
      }
      ordered[index] = l2Normalize(vector as number[]);
    }
    for (let index = 0; index < ordered.length; index++) {
      if (ordered[index] === undefined) {
        throw new Error(`EMBEDDING_RESPONSE_INVALID: missing vector at index ${index}`);
      }
    }
    return ordered as number[][];
  }
}

class TransientEmbeddingError extends Error {}

function l2Normalize(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

/**
 * Circuit-breaker wrapper: queries and indexing stay on the semantic primary
 * until it fails `failureThreshold` consecutive embed() calls, then the
 * deterministic hash baseline takes over for the rest of the process
 * lifetime. embed() never silently mixes models — a failing primary throws
 * (the vector channel degrades; keyword/structured channels stay usable,
 * spec section 25) and only the model switch changes behavior.
 */
export class FallbackEmbeddingProvider implements EmbeddingProvider {
  private readonly primary: EmbeddingProvider;
  private readonly fallback: EmbeddingProvider;
  private readonly failureThreshold: number;
  private consecutiveFailures = 0;
  private tripped = false;

  constructor(
    primary: EmbeddingProvider,
    fallback: EmbeddingProvider,
    options?: { failureThreshold?: number }
  ) {
    this.primary = primary;
    this.fallback = fallback;
    this.failureThreshold = Math.max(1, options?.failureThreshold ?? 3);
  }

  get modelId(): string {
    return this.active.modelId;
  }

  get dimensions(): number {
    return this.active.dimensions;
  }

  get degraded(): boolean {
    return this.tripped;
  }

  private get active(): EmbeddingProvider {
    return this.tripped ? this.fallback : this.primary;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (this.tripped) {
      return this.fallback.embed(texts);
    }
    try {
      const vectors = await this.primary.embed(texts);
      this.consecutiveFailures = 0;
      return vectors;
    } catch (error) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.tripped = true;
      }
      throw error;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
