import assert from "node:assert/strict";
import test from "node:test";

import { pairRawAndJpeg, type PairableSourceFile } from "../src/pairing.js";

function file(clientFileId: string, relativePath: string, kind: PairableSourceFile["kind"]): PairableSourceFile {
  return { clientFileId, relativePath, kind };
}

test("pairs same-stem ARW and JPG across different numbered directories", () => {
  const outcome = pairRawAndJpeg([
    file("f1", "批次1/ZDX01535.JPG", "JPEG"),
    file("f2", "批次2/ZDX01535.ARW", "ARW")
  ]);

  assert.equal(outcome.pairs.length, 1);
  const pair = outcome.pairs[0]!;
  assert.equal(pair.stem, "ZDX01535");
  assert.equal(pair.jpeg.clientFileId, "f1");
  assert.equal(pair.raw.clientFileId, "f2");
  assert.equal(pair.pairingBasis, "cross-directory");
  assert.deepEqual(outcome.unpairedJpeg, []);
  assert.deepEqual(outcome.unpairedRaw, []);
});

test("surfaces a 1 JPEG + 2 ARW stem as explicit ambiguity instead of picking a winner", () => {
  const outcome = pairRawAndJpeg([
    file("f1", "批次1/ZDX01535.JPG", "JPEG"),
    file("f2", "批次1/ZDX01535.ARW", "ARW"),
    file("f3", "批次2/ZDX01535.ARW", "ARW")
  ]);

  assert.deepEqual(outcome.pairs, [], "a same-directory favorite must not silently win an ambiguous stem");
  assert.deepEqual(outcome.unpairedJpeg, []);
  assert.deepEqual(outcome.unpairedRaw, []);
  assert.equal(outcome.ambiguousBuckets.length, 1);
  const bucket = outcome.ambiguousBuckets[0]!;
  assert.equal(bucket.stem, "ZDX01535");
  assert.deepEqual(bucket.jpegs.map((entry) => entry.clientFileId), ["f1"]);
  assert.deepEqual(bucket.raws.map((entry) => entry.clientFileId), ["f2", "f3"]);
});

test("surfaces an all-cross-directory 1 JPEG + 2 ARW stem as explicit ambiguity", () => {
  const outcome = pairRawAndJpeg([
    file("jpg", "root/DSC0010.JPG", "JPEG"),
    file("rawB", "dir-b/DSC0010.ARW", "ARW"),
    file("rawA", "dir-a/DSC0010.ARW", "ARW")
  ]);

  assert.deepEqual(outcome.pairs, [], "the lexicographically smallest raw must not win an ambiguous stem");
  assert.equal(outcome.ambiguousBuckets.length, 1);
  assert.equal(outcome.ambiguousBuckets[0]!.stem, "DSC0010");
  assert.deepEqual(
    outcome.ambiguousBuckets[0]!.raws.map((entry) => entry.clientFileId),
    ["rawA", "rawB"]
  );
});

test("one ARW with two same-stem JPEGs is explicit ambiguity, never two pairs sharing one raw", () => {
  const outcome = pairRawAndJpeg([
    file("jpg1", "批次1/ZDX01535.JPG", "JPEG"),
    file("jpg2", "批次2/ZDX01535.JPG", "JPEG"),
    file("raw", "批次1/ZDX01535.ARW", "ARW")
  ]);

  assert.deepEqual(outcome.pairs, [], "a raw must never be occupied by two pairs");
  assert.deepEqual(outcome.unpairedJpeg, []);
  assert.deepEqual(outcome.unpairedRaw, []);
  assert.equal(outcome.ambiguousBuckets.length, 1);
  const bucket = outcome.ambiguousBuckets[0]!;
  assert.deepEqual(bucket.jpegs.map((entry) => entry.clientFileId), ["jpg1", "jpg2"]);
  assert.deepEqual(bucket.raws.map((entry) => entry.clientFileId), ["raw"]);
});

test("two ARWs and two JPEGs of one stem surface as one ambiguous bucket with no pairs", () => {
  const outcome = pairRawAndJpeg([
    file("jpg1", "dir-one/DSC01535.JPG", "JPEG"),
    file("jpg2", "dir-two/DSC01535.JPG", "JPEG"),
    file("raw1", "dir-one/DSC01535.ARW", "ARW"),
    file("raw2", "dir-two/DSC01535.ARW", "ARW")
  ]);

  assert.deepEqual(outcome.pairs, []);
  assert.equal(outcome.ambiguousBuckets.length, 1);
  assert.equal(outcome.ambiguousBuckets[0]!.stem, "DSC01535");
  assert.deepEqual(
    outcome.ambiguousBuckets[0]!.jpegs.map((entry) => entry.clientFileId),
    ["jpg1", "jpg2"]
  );
  assert.deepEqual(
    outcome.ambiguousBuckets[0]!.raws.map((entry) => entry.clientFileId),
    ["raw1", "raw2"]
  );
});

test("rejects duplicate client ids and unknown kinds before pairing", () => {
  assert.throws(
    () =>
      pairRawAndJpeg([
        file("dup", "a/DSC0010.JPG", "JPEG"),
        file("dup", "b/DSC0011.JPG", "JPEG")
      ]),
    /clientFileId/i
  );
  assert.throws(
    () =>
      pairRawAndJpeg([{ clientFileId: "f1", relativePath: "a/DSC0010.GIF", kind: "GIF" as never }]),
    /kind/i
  );
});

test("orders outputs by relativePath then clientFileId with code-unit order, immune to locale collation", () => {
  // Code-unit order: "dir/z.JPG" (0x7a) < "dir/ä.JPG" (0xe4), while ICU
  // collation sorts ä next to a — localeCompare would disagree here.
  const outcome = pairRawAndJpeg([
    file("id-a", "dir/ä.JPG", "JPEG"),
    file("id-b", "dir/z.JPG", "JPEG")
  ]);

  assert.deepEqual(outcome.pairs, []);
  assert.deepEqual(
    outcome.unpairedJpeg.map((entry) => entry.relativePath),
    ["dir/z.JPG", "dir/ä.JPG"],
    "unpaired JPEGs must follow code-unit order, not locale collation"
  );
  // Same relativePath resolves deterministically on the clientFileId tiebreaker.
  const tie = pairRawAndJpeg([
    file("id-b", "dir/SAME.JPG", "JPEG"),
    file("id-a", "dir/SAME.JPG", "JPEG")
  ]);
  assert.deepEqual(
    tie.unpairedJpeg.map((entry) => entry.clientFileId),
    ["id-a", "id-b"],
    "equal paths must fall back to the clientFileId code-unit order"
  );
});

test("ambiguous buckets and unpaired files stay deterministic regardless of input order", () => {
  const files = [
    file("jpg1", "dir-one/DSC01535.JPG", "JPEG"),
    file("jpg2", "dir-two/DSC01535.JPG", "JPEG"),
    file("raw1", "dir-one/DSC01535.ARW", "ARW"),
    file("raw2", "dir-two/DSC01535.ARW", "ARW"),
    file("solo", "dir/LONE.JPG", "JPEG")
  ];

  const first = pairRawAndJpeg(files);
  const second = pairRawAndJpeg([...files].reverse());

  assert.deepEqual(first, second);
  assert.deepEqual(first.pairs, []);
  assert.equal(first.ambiguousBuckets.length, 1);
  assert.deepEqual(first.unpairedJpeg.map((entry) => entry.clientFileId), ["solo"]);
});

test("reports JPG-only and ARW-only files without inventing pairs", () => {
  const outcome = pairRawAndJpeg([
    file("jpg1", "a/ONLY.JPG", "JPEG"),
    file("raw1", "b/LONE.ARW", "ARW"),
    file("jpg2", "c/OTHER.JPG", "JPEG")
  ]);

  assert.deepEqual(outcome.pairs, []);
  assert.deepEqual(
    outcome.unpairedJpeg.map((entry) => entry.clientFileId),
    ["jpg1", "jpg2"]
  );
  assert.deepEqual(
    outcome.unpairedRaw.map((entry) => entry.clientFileId),
    ["raw1"]
  );
});

test("keeps PNG and WEBP files out of raw pairing entirely", () => {
  const outcome = pairRawAndJpeg([
    file("png", "a/ZDX01535.PNG", "PNG"),
    file("webp", "a/ZDX01535.WEBP", "WEBP"),
    file("jpg", "a/ZDX01535.JPG", "JPEG")
  ]);

  assert.deepEqual(outcome.pairs, []);
  assert.deepEqual(outcome.unpairedRaw, []);
  assert.deepEqual(
    outcome.nonPairable.map((entry) => entry.clientFileId),
    ["png", "webp"]
  );
  assert.deepEqual(outcome.unpairedJpeg.map((entry) => entry.clientFileId), ["jpg"]);
});

test("produces deterministic ordering regardless of input order", () => {
  const files = [
    file("c", "dir-c/SHARED.ARW", "ARW"),
    file("b", "dir-b/SHARED.JPG", "JPEG"),
    file("a", "dir-a/ALPHA.JPG", "JPEG"),
    file("d", "dir-d/BETA.ARW", "ARW")
  ];

  const first = pairRawAndJpeg(files);
  const second = pairRawAndJpeg([...files].reverse());

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.pairs.map((pair) => pair.stem),
    ["SHARED"]
  );
  assert.deepEqual(
    first.unpairedJpeg.map((entry) => entry.relativePath),
    ["dir-a/ALPHA.JPG"]
  );
  assert.deepEqual(
    first.unpairedRaw.map((entry) => entry.relativePath),
    ["dir-d/BETA.ARW"]
  );
});

test("never pairs files with different stems", () => {
  const outcome = pairRawAndJpeg([
    file("jpg", "a/DSC0010.JPG", "JPEG"),
    file("raw", "a/DSC0011.ARW", "ARW")
  ]);

  assert.deepEqual(outcome.pairs, []);
  assert.equal(outcome.unpairedJpeg.length, 1);
  assert.equal(outcome.unpairedRaw.length, 1);
});

test("rejects traversal and absolute paths before pairing", () => {
  assert.throws(() => pairRawAndJpeg([file("f1", "../escape.JPG", "JPEG")]), /relative path/i);
  assert.throws(() => pairRawAndJpeg([file("f1", "/absolute/DSC.JPG", "JPEG")]), /relative path/i);
  assert.throws(() => pairRawAndJpeg([file("f1", "a\\b.JPG", "JPEG")]), /relative path/i);
  assert.throws(() => pairRawAndJpeg([file("f1", "a/../../escape.JPG", "JPEG")]), /relative path/i);
});

test("rejects empty client ids and empty file lists", () => {
  assert.throws(() => pairRawAndJpeg([]), /at least one/i);
  assert.throws(
    () => pairRawAndJpeg([{ clientFileId: "", relativePath: "a.JPG", kind: "JPEG" }]),
    /clientFileId/i
  );
});
