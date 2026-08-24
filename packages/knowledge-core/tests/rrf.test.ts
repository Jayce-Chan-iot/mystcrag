import assert from "node:assert/strict";
import test from "node:test";

import { reciprocalRankFusion } from "../src/index";

test("RRF fuses multiple ranked lists with the k=60 constant", () => {
  const fused = reciprocalRankFusion([["a", "b"], ["b", "a"]]);
  // Symmetric ranks: both ids score 1/61 + 1/62 and tie-break by id.
  const a = fused.find((entry) => entry.id === "a");
  const b = fused.find((entry) => entry.id === "b");
  assert.ok(a && b);
  assert.equal(a.score, 1 / 61 + 1 / 62);
  assert.equal(b.score, 1 / 61 + 1 / 62);
  assert.deepEqual(
    fused.map((entry) => entry.id),
    ["a", "b"]
  );
});

test("RRF is deterministic and ranks higher positions first", () => {
  const first = reciprocalRankFusion([["z", "a"]]);
  const second = reciprocalRankFusion([["z", "a"]]);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((entry) => entry.id),
    ["z", "a"]
  );
});

test("RRF rewards agreement across lists over a single high rank", () => {
  const fused = reciprocalRankFusion([["x", "y"], ["y", "z"], ["y"]]);
  const y = fused.find((entry) => entry.id === "y");
  const x = fused.find((entry) => entry.id === "x");
  assert.ok(y && x);
  assert.ok(y.score > x.score, "agreement across lists should dominate");
  assert.equal(fused[0]?.id, "y");
});

test("RRF respects the limit option and handles empty input", () => {
  assert.deepEqual(reciprocalRankFusion([]), []);
  assert.deepEqual(reciprocalRankFusion([[], []]), []);
  const limited = reciprocalRankFusion([["a", "b", "c"]], { limit: 2 });
  assert.equal(limited.length, 2);
  assert.deepEqual(
    limited.map((entry) => entry.id),
    ["a", "b"]
  );
});

test("RRF supports a custom k constant", () => {
  const fused = reciprocalRankFusion([["a"]], { k: 10 });
  assert.equal(fused[0]?.score, 1 / 11);
});
