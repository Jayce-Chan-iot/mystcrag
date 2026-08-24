/**
 * Embedding providers turn text into fixed-dimension vectors. Embedding stays
 * strictly server-side (KNOWLEDGE_SYSTEM_SPEC section 25): nothing in this
 * module may ever be bundled for the browser.
 */
export interface EmbeddingProvider {
  /** Stable identifier persisted with each vector (e.g. "hash-256-v1"). */
  readonly modelId: string;
  /** Vector dimensionality for this provider. */
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}

const DIMENSIONS = 256;

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

function l2Normalize(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

/**
 * Deterministic lexical-hash embedding. Always available, dependency-free,
 * and stable across processes — used as the baseline vector channel for
 * tests, benchmarks, and as the guaranteed fallback when no semantic model
 * provider is configured. It is NOT a semantic model: quality is lexical.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = "hash-256-v1";
  readonly dimensions = DIMENSIONS;

  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(DIMENSIONS).fill(0);
      const tokens = tokenize(text);
      for (const token of tokens) {
        const tokenSlot = fnv1a(token) % DIMENSIONS;
        vector[tokenSlot] = (vector[tokenSlot] ?? 0) + 1;
        // Chinese text rarely splits on punctuation, so also hash CJK bigrams.
        for (let index = 0; index + 1 < token.length; index++) {
          const bigram = token.slice(index, index + 2);
          if (/[\u4e00-\u9fff]/u.test(bigram)) {
            const bigramSlot = fnv1a(bigram) % DIMENSIONS;
            vector[bigramSlot] = (vector[bigramSlot] ?? 0) + 0.5;
          }
        }
      }
      return l2Normalize(vector);
    });
  }
}

export function vectorToPgLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}
