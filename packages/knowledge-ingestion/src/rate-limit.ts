/**
 * Per-source request pacing (Q0 rate limit). Spacing is enforced across all
 * concurrent requests of one crawl: every acquire() resolves only after
 * `60s / maxRequestsPerMinute` has passed since the previous granted slot.
 */
export type RequestRateLimiter = {
  acquire(): Promise<void>;
};

export function createRequestRateLimiter(
  maxRequestsPerMinute?: number
): RequestRateLimiter | null {
  if (maxRequestsPerMinute === undefined || !Number.isFinite(maxRequestsPerMinute)) {
    return null;
  }
  const rpm = Math.max(1, Math.floor(maxRequestsPerMinute));
  const minIntervalMs = Math.ceil(60_000 / rpm);

  let nextSlotAt = Date.now();
  let chain: Promise<void> = Promise.resolve();

  return {
    acquire(): Promise<void> {
      const ticket = chain.then(async () => {
        const now = Date.now();
        const waitMs = Math.max(0, nextSlotAt - now);
        nextSlotAt = Math.max(now, nextSlotAt) + minIntervalMs;
        if (waitMs > 0) {
          await sleep(waitMs);
        }
      });
      chain = ticket.catch(() => undefined);
      return ticket;
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
