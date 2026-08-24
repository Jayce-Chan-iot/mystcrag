export type RrfOptions = {
  /** Constant added to each rank; the literature default is 60. */
  k?: number;
  /** Maximum number of fused results to return. */
  limit?: number;
};

export type RrfScored = { id: string; score: number };

/**
 * Reciprocal Rank Fusion over one or more ranked id lists (best first).
 * Deterministic: equal scores fall back to ascending id order.
 */
export function reciprocalRankFusion(
  rankedLists: readonly (readonly string[])[],
  options?: RrfOptions
): RrfScored[] {
  const k = options?.k ?? 60;
  const limit = options?.limit ?? Number.POSITIVE_INFINITY;
  const scores = new Map<string, number>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank];
      if (id === undefined) continue;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1))
    .slice(0, limit === Number.POSITIVE_INFINITY ? undefined : limit);
}
