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

test("prefers a same-directory raw over cross-directory candidates", () => {
  const outcome = pairRawAndJpeg([
    file("f1", "批次1/ZDX01535.JPG", "JPEG"),
    file("f2", "批次1/ZDX01535.ARW", "ARW"),
    file("f3", "批次2/ZDX01535.ARW", "ARW")
  ]);

  assert.equal(outcome.pairs.length, 1);
  const pair = outcome.pairs[0]!;
  assert.equal(pair.raw.clientFileId, "f2");
  assert.equal(pair.pairingBasis, "same-directory");
  assert.deepEqual(pair.alternatives, ["批次2/ZDX01535.ARW"]);
  assert.equal(outcome.unpairedRaw.length, 1);
  assert.equal(outcome.unpairedRaw[0]!.clientFileId, "f3");
});

test("picks the lexicographically smallest raw deterministically when all candidates are cross-directory", () => {
  const outcome = pairRawAndJpeg([
    file("jpg", "root/DSC0010.JPG", "JPEG"),
    file("rawB", "dir-b/DSC0010.ARW", "ARW"),
    file("rawA", "dir-a/DSC0010.ARW", "ARW")
  ]);

  const pair = outcome.pairs[0]!;
  assert.equal(pair.raw.clientFileId, "rawA");
  assert.equal(pair.pairingBasis, "cross-directory");
  assert.deepEqual(pair.alternatives, ["dir-b/DSC0010.ARW"]);
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
