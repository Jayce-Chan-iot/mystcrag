import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  computeColorHistogram,
  computeDHash,
  hammingDistance,
  histogramDistance,
  suggestGroups,
  type GroupingCandidate
} from "../src/grouping.js";

async function renderSvg(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function beadSvg(color: string, cx: number, cy: number, r: number, background = "#f0f0f0"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
    <rect width="96" height="96" fill="${background}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>
  </svg>`;
}

test("dHash of identical bytes is identical and stable", async () => {
  const image = await renderSvg(beadSvg("#c0392b", 48, 48, 30));
  const first = await computeDHash(image);
  const second = await computeDHash(image);

  assert.match(first, /^[0-9a-f]{16}$/);
  assert.equal(first, second);
  assert.equal(hammingDistance(first, second), 0);
});

test("dHash stays small for small subject shifts and large for different subjects", async () => {
  const center = await computeDHash(await renderSvg(beadSvg("#c0392b", 48, 48, 30)));
  const shifted = await computeDHash(await renderSvg(beadSvg("#c0392b", 49, 48, 30)));
  const different = await computeDHash(await renderSvg(beadSvg("#2980b9", 20, 24, 12, "#111111")));

  assert.ok(hammingDistance(center, shifted) <= 12, `expected small distance, got ${hammingDistance(center, shifted)}`);
  assert.ok(hammingDistance(center, different) >= 20, `expected large distance, got ${hammingDistance(center, different)}`);
  assert.ok(
    hammingDistance(center, different) > hammingDistance(center, shifted),
    "a different subject must be farther than a small subject shift"
  );
});

test("color histogram separates dominant hues and is deterministic", async () => {
  const red = await computeColorHistogram(await renderSvg(beadSvg("#c0392b", 48, 48, 30)));
  const redAgain = await computeColorHistogram(await renderSvg(beadSvg("#c0392b", 48, 48, 30)));
  const blue = await computeColorHistogram(await renderSvg(beadSvg("#2980b9", 48, 48, 30)));

  assert.equal(red.length, 64);
  assert.deepEqual(red, redAgain);
  assert.equal(histogramDistance(red, redAgain), 0);
  assert.ok(histogramDistance(red, blue) > 0.5, `expected distant histograms, got ${histogramDistance(red, blue)}`);
});

function candidate(
  clientFileId: string,
  relativePath: string,
  sha256: string,
  features: {
    kind?: "ARW" | "JPEG" | "PNG" | "WEBP";
    dHash?: string | null;
    histogram?: number[] | null;
    capturedAtMs?: number | null;
  }
): GroupingCandidate {
  return {
    clientFileId,
    relativePath,
    sha256,
    kind: features.kind ?? "JPEG",
    dHash: features.dHash ?? null,
    histogram: features.histogram ?? null,
    capturedAtMs: features.capturedAtMs ?? null
  };
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

test("exact SHA-256 duplicates collapse into one suggestion with duplicate evidence", () => {
  const outcome = suggestGroups([
    candidate("f1", "dir/one.JPG", HASH_A, {}),
    candidate("f2", "dir/one-copy.JPG", HASH_A, {})
  ]);

  assert.equal(outcome.suggestions.length, 1);
  const suggestion = outcome.suggestions[0]!;
  assert.deepEqual(suggestion.memberFileIds, ["f1", "f2"]);
  assert.equal(suggestion.confidence, "high");
  const duplicateEvidence = suggestion.evidence.find((item) => item.exactDuplicateOf !== undefined);
  assert.ok(duplicateEvidence, "expected duplicate evidence");
  assert.equal(duplicateEvidence!.exactDuplicateOf, "f1");
});

test("same-stem RAW/JPEG files group with stem evidence", () => {
  const outcome = suggestGroups([
    candidate("jpg", "dir/ZDX01535.JPG", HASH_A, { kind: "JPEG" }),
    candidate("raw", "other/ZDX01535.ARW", HASH_B, { kind: "ARW" })
  ]);

  assert.equal(outcome.suggestions.length, 1);
  const suggestion = outcome.suggestions[0]!;
  assert.deepEqual(suggestion.memberFileIds, ["jpg", "raw"]);
  assert.equal(suggestion.confidence, "high");
  const stemEvidence = suggestion.evidence.find((item) => item.stemPairedWith !== null);
  assert.ok(stemEvidence, "expected stem evidence");
  assert.equal(stemEvidence!.stemPairedWith, "jpg");
});

test("two ARWs and one JPEG of the same stem never auto-merge on the stem", () => {
  const outcome = suggestGroups([
    candidate("jpg", "dir/DSC01535.JPG", HASH_A, { kind: "JPEG" }),
    candidate("raw1", "dir/DSC01535.ARW", HASH_B, { kind: "ARW" }),
    candidate("raw2", "card-two/DSC01535.ARW", HASH_C, { kind: "ARW" })
  ]);

  assert.ok(
    outcome.suggestions.every((item) => item.memberFileIds.length === 1),
    "an ambiguous 2 ARW + 1 JPEG stem must not merge into one high-confidence group"
  );
  assert.ok(
    outcome.suggestions.every((item) => item.evidence.every((entry) => entry.stemPairedWith === null)),
    "ambiguous stems must not claim stem-pairing evidence"
  );
});

test("one ARW and two JPEGs of the same stem never auto-merge on the stem", () => {
  const outcome = suggestGroups([
    candidate("jpg1", "dir/DSC01535.JPG", HASH_A, { kind: "JPEG" }),
    candidate("jpg2", "card-two/DSC01535.JPG", HASH_C, { kind: "JPEG" }),
    candidate("raw", "dir/DSC01535.ARW", HASH_B, { kind: "ARW" })
  ]);

  assert.ok(
    outcome.suggestions.every((item) => item.memberFileIds.length === 1),
    "an ambiguous 1 ARW + 2 JPEG stem must not merge into one high-confidence group"
  );
});

test("two ARWs and two JPEGs of the same stem stay four independent suggestions", () => {
  const outcome = suggestGroups([
    candidate("jpg1", "dir-one/DSC01535.JPG", HASH_A, { kind: "JPEG" }),
    candidate("jpg2", "dir-two/DSC01535.JPG", HASH_C, { kind: "JPEG" }),
    candidate("raw1", "dir-one/DSC01535.ARW", HASH_B, { kind: "ARW" }),
    candidate("raw2", "dir-two/DSC01535.ARW", HASH_D, { kind: "ARW" })
  ]);

  assert.equal(outcome.suggestions.length, 4);
  assert.ok(
    outcome.suggestions.every((item) => item.memberFileIds.length === 1),
    "even per-directory-unambiguous 2+2 combinations must not auto-merge on the stem"
  );
});

test("ambiguous same-stem sets group deterministically regardless of input order", () => {
  const inputs = [
    candidate("jpg", "dir/DSC01535.JPG", HASH_A, { kind: "JPEG" }),
    candidate("raw1", "dir/DSC01535.ARW", HASH_B, { kind: "ARW" }),
    candidate("raw2", "card-two/DSC01535.ARW", HASH_C, { kind: "ARW" })
  ];

  const first = suggestGroups(inputs);
  const second = suggestGroups([...inputs].reverse());
  const third = suggestGroups([inputs[1]!, inputs[2]!, inputs[0]!]);

  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
});

test("two identical ARWs and one JPEG of the same stem never form a three-member group", () => {
  const outcome = suggestGroups([
    candidate("jpg", "dir/DSC01535.JPG", HASH_A, { kind: "JPEG" }),
    candidate("raw1", "dir/DSC01535.ARW", HASH_B, { kind: "ARW" }),
    candidate("raw2", "card-two/DSC01535.ARW", HASH_B, { kind: "ARW" })
  ]);

  const merged = outcome.suggestions.filter((item) => item.memberFileIds.length > 1);
  assert.equal(merged.length, 1, "only the exact-duplicate ARW pair may merge");
  assert.deepEqual(merged[0]!.memberFileIds, ["raw1", "raw2"]);
  assert.ok(
    merged[0]!.evidence.every((entry) => entry.stemPairedWith === null),
    "the duplicate group must not gain stem-pairing evidence"
  );
  const jpegGroup = outcome.suggestions.find((item) => item.memberFileIds.includes("jpg"));
  assert.ok(jpegGroup, "the JPEG must still appear as its own suggestion");
  assert.deepEqual(
    jpegGroup!.memberFileIds,
    ["jpg"],
    "identical ARWs must not smuggle the JPEG into their duplicate group through the stem"
  );
});

test("two identical ARWs and one same-stem JPEG with identical visual features and capture time never form a three-member high-confidence group", () => {
  const dHash = "0".repeat(16);
  const histogram = new Array<number>(64).fill(1 / 64);
  const capturedAtMs = 1_700_000_000_000;
  const inputs = [
    candidate("jpg", "dir/DSC01535.JPG", HASH_A, { kind: "JPEG", dHash, histogram, capturedAtMs }),
    candidate("raw1", "dir/DSC01535.ARW", HASH_B, { kind: "ARW", dHash, histogram, capturedAtMs }),
    candidate("raw2", "card-two/DSC01535.ARW", HASH_B, { kind: "ARW", dHash, histogram, capturedAtMs })
  ];

  const forward = suggestGroups(inputs);
  const reverse = suggestGroups([...inputs].reverse());

  assert.deepEqual(forward, reverse, "reversing the input order must not change any output byte");

  assert.ok(
    forward.suggestions.every((item) => item.memberFileIds.length !== 3),
    "no high-confidence suggestion may hold all three same-stem members"
  );

  const duplicateGroup = forward.suggestions.find((item) => item.memberFileIds.length === 2);
  assert.ok(duplicateGroup, "the identical ARWs must keep their duplicate group");
  assert.deepEqual(duplicateGroup!.memberFileIds, ["raw1", "raw2"]);

  const jpegGroup = forward.suggestions.find((item) => item.memberFileIds.includes("jpg"));
  assert.ok(jpegGroup, "the JPEG must still appear as its own suggestion");
  assert.deepEqual(
    jpegGroup!.memberFileIds,
    ["jpg"],
    "the JPEG must stay out of the duplicate RAW group even with identical visual features"
  );

  assert.ok(
    forward.suggestions.every((item) => item.evidence.every((entry) => entry.stemPairedWith === null)),
    "an ambiguous stem must not produce stem-pairing evidence anywhere"
  );
});

test("same-stem JPEGs with different content never merge on the stem alone", () => {
  const outcome = suggestGroups([
    candidate("jpg1", "dir-one/bead.JPG", HASH_A, { kind: "JPEG" }),
    candidate("jpg2", "dir-two/bead.JPG", HASH_B, { kind: "JPEG" })
  ]);

  const merged = outcome.suggestions.filter((item) => item.memberFileIds.length > 1);
  assert.deepEqual(merged, [], "two JPEGs must not high-confidence merge on file name alone");
  assert.equal(outcome.suggestions.length, 2);
});

test("grouping output is deterministic for precomposed and combining Unicode ids", () => {
  // localeCompare treats U+00E9 and e+U+0301 as equal, so a collation-based
  // sort keeps input order; the code-unit order (U+0065 < U+00E9) is fixed.
  const precomposed = candidate("é-shot", "dir/DSC0001.JPG", HASH_A, { kind: "JPEG" });
  const combining = candidate("e\u0301-shot", "dir/DSC0002.JPG", HASH_B, { kind: "JPEG" });

  const forward = suggestGroups([precomposed, combining]);
  const reverse = suggestGroups([combining, precomposed]);

  assert.deepEqual(
    forward.suggestions.map((item) => item.memberFileIds[0]),
    ["e\u0301-shot", "é-shot"],
    "code-unit order must place the combining sequence first"
  );
  assert.deepEqual(forward, reverse, "reversing the input order must not change any output byte");
});

test("cross-directory same-stem PNG and WebP files stay separate without visual agreement", () => {
  const outcome = suggestGroups([
    candidate("png", "dir-one/bead.png", HASH_A, { kind: "PNG" }),
    candidate("webp", "dir-two/bead.png", HASH_B, { kind: "WEBP" })
  ]);

  const merged = outcome.suggestions.filter((item) => item.memberFileIds.length > 1);
  assert.deepEqual(merged, [], "same-stem non-complementary kinds must not merge");
  assert.equal(outcome.suggestions.length, 2);
});

test("visually similar burst shots within the capture window merge with high confidence", () => {
  const dHash = "0".repeat(16);
  const nearDHash = "0".repeat(15) + "1";
  const histogram = new Array<number>(64).fill(1 / 64);
  const nearHistogram = histogram.map((value, index) => (index === 0 ? value + 0.01 : value));

  const outcome = suggestGroups([
    candidate("shot1", "dir/DSC0001.JPG", HASH_A, { dHash, histogram, capturedAtMs: 1_000_000 }),
    candidate("shot2", "dir/DSC0002.JPG", HASH_B, {
      dHash: nearDHash,
      histogram: nearHistogram,
      capturedAtMs: 1_020_000
    })
  ]);

  assert.equal(outcome.suggestions.length, 1);
  assert.deepEqual(outcome.suggestions[0]!.memberFileIds, ["shot1", "shot2"]);
  assert.equal(outcome.suggestions[0]!.confidence, "high");
  const evidence = outcome.suggestions[0]!.evidence[0]!;
  assert.equal(evidence.dHashDistance, 1);
  assert.ok(evidence.captureGapMs !== null && evidence.captureGapMs <= 60_000);
});

test("visually similar files with a distant capture gap stay separate review groups", () => {
  const dHash = "0".repeat(16);
  const nearDHash = "0".repeat(15) + "1";
  const histogram = new Array<number>(64).fill(1 / 64);
  const nearHistogram = histogram.map((value, index) => (index === 0 ? value + 0.01 : value));

  const outcome = suggestGroups([
    candidate("shot1", "dir/DSC0001.JPG", HASH_A, { dHash, histogram, capturedAtMs: 1_000_000 }),
    candidate("shot2", "dir/DSC0002.JPG", HASH_B, {
      dHash: nearDHash,
      histogram: nearHistogram,
      capturedAtMs: 9_000_000
    })
  ]);

  const merged = outcome.suggestions.filter((item) => item.memberFileIds.length > 1);
  assert.deepEqual(merged, [], "must not auto-merge across a distant capture gap");
  const review = outcome.reviewSuggestions.find(
    (item) => item.memberFileIds.length === 2
  );
  assert.ok(review, "expected a low-confidence review suggestion");
  assert.equal(review!.confidence, "low");
  assert.ok(review!.evidence[0]!.captureGapMs !== null && review!.evidence[0]!.captureGapMs > 60_000);
});

test("missing capture times prevent confident visual merges", () => {
  const dHash = "0".repeat(16);
  const nearDHash = "0".repeat(15) + "1";
  const histogram = new Array<number>(64).fill(1 / 64);

  const outcome = suggestGroups([
    candidate("shot1", "dir/DSC0001.JPG", HASH_A, { dHash, histogram, capturedAtMs: null }),
    candidate("shot2", "dir/DSC0002.JPG", HASH_B, { dHash: nearDHash, histogram, capturedAtMs: null })
  ]);

  const merged = outcome.suggestions.filter((item) => item.memberFileIds.length > 1);
  assert.deepEqual(merged, [], "weak signals must agree before merging");
  assert.ok(
    outcome.reviewSuggestions.some((item) => item.memberFileIds.length === 2),
    "expected a review suggestion instead"
  );
});

test("dissimilar subjects never merge or produce review suggestions", () => {
  const histogram = new Array<number>(64).fill(1 / 64);
  const otherHistogram = histogram.map((value, index) => (index === 5 ? value + 0.02 : value));

  const outcome = suggestGroups([
    candidate("a", "dir/A.JPG", HASH_A, { dHash: "0".repeat(16), histogram, capturedAtMs: 1_000 }),
    candidate("b", "dir/B.JPG", HASH_B, { dHash: "f".repeat(16), histogram: otherHistogram, capturedAtMs: 1_020 })
  ]);

  assert.equal(outcome.suggestions.length, 2);
  assert.ok(outcome.suggestions.every((item) => item.memberFileIds.length === 1));
  assert.deepEqual(outcome.reviewSuggestions, []);
});

test("groups members from an exact-duplicate chain deterministically", () => {
  const shuffled = [
    candidate("dup2", "dir/copy2.JPG", HASH_A, {}),
    candidate("dup1", "dir/copy1.JPG", HASH_A, {}),
    candidate("solo", "dir/other.JPG", HASH_C, {})
  ];

  const first = suggestGroups(shuffled);
  const second = suggestGroups([...shuffled].reverse());

  assert.deepEqual(first, second);
  const duplicateGroup = first.suggestions.find((item) => item.memberFileIds.length === 2);
  assert.ok(duplicateGroup);
  assert.deepEqual(duplicateGroup!.memberFileIds, ["dup1", "dup2"]);
});

test("rejects invalid candidates", () => {
  assert.throws(
    () =>
      suggestGroups([
        candidate("f1", "dir/a.JPG", HASH_A, {}),
        candidate("f1", "dir/b.JPG", HASH_B, {})
      ]),
    /unique/i
  );
  assert.throws(() => suggestGroups([candidate("f1", "dir/a.JPG", "zz", {})]), /sha-256/i);
  assert.throws(() => suggestGroups([candidate("f1", "dir/a.JPG", HASH_A, { dHash: "short" })]), /dhash/i);
  assert.throws(
    () => suggestGroups([candidate("f1", "dir/a.JPG", HASH_A, { histogram: [1, 2, 3] })]),
    /histogram/i
  );
  assert.throws(
    () =>
      suggestGroups([
        {
          clientFileId: "f1",
          relativePath: "dir/a.JPG",
          sha256: HASH_A,
          dHash: null,
          histogram: null,
          capturedAtMs: null
        } as unknown as GroupingCandidate
      ]),
    /kind/i,
    "a candidate without a kind is rejected"
  );
  assert.throws(
    () =>
      suggestGroups([
        {
          clientFileId: "f1",
          relativePath: "dir/a.JPG",
          sha256: HASH_A,
          kind: "GIF",
          dHash: null,
          histogram: null,
          capturedAtMs: null
        } as unknown as GroupingCandidate
      ]),
    /kind/i,
    "an unknown kind value is rejected"
  );
  assert.throws(() => suggestGroups([]), /at least one/i);
});

test("a high-confidence group never leaks into review suggestions", () => {
  const dHash = "0".repeat(16);
  const nearDHash = "0".repeat(15) + "1";
  const histogram = new Array<number>(64).fill(1 / 64);

  const outcome = suggestGroups([
    candidate("shot1", "dir/DSC0001.JPG", HASH_A, { dHash, histogram, capturedAtMs: 1_000_000 }),
    candidate("shot2", "dir/DSC0002.JPG", HASH_B, {
      dHash: nearDHash,
      histogram,
      capturedAtMs: 1_010_000
    }),
    candidate("unrelated", "dir/OTHER.JPG", HASH_C, { dHash: "f".repeat(16), histogram, capturedAtMs: 1_020_000 })
  ]);

  const confident = outcome.suggestions.find((item) => item.memberFileIds.length === 2);
  assert.ok(confident);
  assert.deepEqual(confident!.memberFileIds, ["shot1", "shot2"]);
  for (const review of outcome.reviewSuggestions) {
    assert.ok(
      !review.memberFileIds.includes("shot1") && !review.memberFileIds.includes("shot2"),
      "confident group members must not appear in review suggestions"
    );
  }
});
