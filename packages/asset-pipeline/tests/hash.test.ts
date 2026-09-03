import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256OfBytes, sha256OfFile } from "../src/hash.js";

test("sha256OfBytes matches known digests", () => {
  assert.equal(sha256OfBytes(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(
    sha256OfBytes(Buffer.from("")),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
});

test("sha256OfFile streams large files and reports byte size", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asset-pipeline-hash-"));
  try {
    const payload = Buffer.alloc(8 * 1024 * 1024, 7);
    const filePath = join(directory, "large.bin");
    await writeFile(filePath, payload);

    const result = await sha256OfFile(filePath);
    assert.equal(result.byteSize, payload.byteLength);
    assert.equal(result.sha256, sha256OfBytes(payload));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sha256OfFile distinguishes near-identical files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asset-pipeline-hash-"));
  try {
    const left = join(directory, "left.bin");
    const right = join(directory, "right.bin");
    await writeFile(left, Buffer.from("mystcrag-a"));
    await writeFile(right, Buffer.from("mystcrag-b"));

    const leftHash = await sha256OfFile(left);
    const rightHash = await sha256OfFile(right);
    assert.notEqual(leftHash.sha256, rightHash.sha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
