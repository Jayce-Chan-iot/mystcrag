import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readRegularFile, readRegularFileSync } from "../src/safe-read.js";

test("readRegularFile reports a missing path without throwing", async () => {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-safe-read-"));
  try {
    const outcome = await readRegularFile(join(base, "absent.bin"));
    assert.equal(outcome.status, "missing");
    assert.equal(readRegularFileSync(join(base, "absent.bin")).status, "missing");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("readRegularFile refuses to follow a symbolic link at the final segment", async () => {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-safe-read-"));
  try {
    await mkdir(join(base, "outside"), { recursive: true });
    await writeFile(join(base, "outside", "secret.txt"), "secret", "utf8");
    await symlink(join(base, "outside", "secret.txt"), join(base, "entry.txt"));

    // Reading must happen through a descriptor verified to be the plain file
    // itself — a swap-in symlink may never be followed, and both variants
    // (async and sync) must agree.
    assert.equal((await readRegularFile(join(base, "entry.txt"))).status, "not-regular");
    assert.equal(readRegularFileSync(join(base, "entry.txt")).status, "not-regular");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("readRegularFile reads the same descriptor it verified", async () => {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-safe-read-"));
  try {
    const bytes = Buffer.from("verified through one descriptor");
    await writeFile(join(base, "payload.bin"), bytes);

    const asyncOutcome = await readRegularFile(join(base, "payload.bin"));
    assert.equal(asyncOutcome.status, "read");
    assert.deepEqual(Buffer.from(asyncOutcome.bytes), bytes);

    const syncOutcome = readRegularFileSync(join(base, "payload.bin"));
    assert.equal(syncOutcome.status, "read");
    assert.deepEqual(Buffer.from(syncOutcome.bytes), bytes);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("readRegularFile reports a directory as not-regular", async () => {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-safe-read-"));
  try {
    await mkdir(join(base, "a-directory"));
    assert.equal((await readRegularFile(join(base, "a-directory"))).status, "not-regular");
    assert.equal(readRegularFileSync(join(base, "a-directory")).status, "not-regular");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("readRegularFile rejects a file larger than the byte cap", async () => {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-safe-read-"));
  try {
    await writeFile(join(base, "huge.bin"), Buffer.alloc(1024));
    await assert.rejects(readRegularFile(join(base, "huge.bin"), { maxBytes: 512 }), /read cap/);
    assert.throws(() => readRegularFileSync(join(base, "huge.bin"), { maxBytes: 512 }), /read cap/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("readRegularFile lets an unreadable file surface its errno instead of pretending to be missing", async () => {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-safe-read-"));
  try {
    await mkdir(join(base, "locked"), { recursive: true });
    await writeFile(join(base, "locked", "payload.bin"), "secret", "utf8");
    await chmod(join(base, "locked"), 0o000);
    try {
      await assert.rejects(
        readRegularFile(join(base, "locked", "payload.bin")),
        (error: unknown) => (error as NodeJS.ErrnoException).code === "EACCES",
        "a permission failure must propagate, not masquerade as a missing file"
      );
      assert.throws(
        () => readRegularFileSync(join(base, "locked", "payload.bin")),
        (error: unknown) => (error as NodeJS.ErrnoException).code === "EACCES"
      );
    } finally {
      await chmod(join(base, "locked"), 0o700);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
