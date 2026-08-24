import assert from "node:assert/strict";
import test from "node:test";

import { createRequestRateLimiter } from "../src/rate-limit.js";

test("rate limiter spaces grants by 60s / maxRequestsPerMinute", async () => {
  // 300 rpm => 200ms between granted slots.
  const limiter = createRequestRateLimiter(300);
  assert.ok(limiter);

  await limiter.acquire();
  const before = Date.now();
  await limiter.acquire();
  const waited = Date.now() - before;
  assert.ok(waited >= 150, `second grant waits ~200ms, got ${waited}ms`);
});

test("concurrent acquires serialize instead of granting a burst", async () => {
  const limiter = createRequestRateLimiter(300);
  assert.ok(limiter);

  const stamps: number[] = [];
  const started = Date.now();
  await Promise.all(
    [0, 1, 2].map(async () => {
      await limiter.acquire();
      stamps.push(Date.now() - started);
    })
  );
  const spread = stamps[stamps.length - 1]! - stamps[0]!;
  assert.ok(spread >= 300, `three grants spread over >=400ms, got ${spread}ms`);
});

test("no limiter when rate limit is undefined", () => {
  assert.equal(createRequestRateLimiter(undefined), null);
});
