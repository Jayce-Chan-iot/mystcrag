import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { sha256OfBytes } from "../src/hash.js";
import { ArchiveStore, ArchiveStoreError } from "../src/storage.js";

function countOpenFileDescriptors(): number {
  return readdirSync("/dev/fd").filter((name) => /^[0-9]+$/.test(name)).length;
}

async function waitForClose(stream: Readable): Promise<void> {
  if (stream.closed) return;
  await new Promise<void>((resolve) => stream.once("close", resolve));
}

async function collectStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function createArchiveRoot(): Promise<{ root: string; repositoryRoot: string }> {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-storage-"));
  const repositoryRoot = join(base, "repo");
  const root = join(base, "archive");
  await mkdir(join(repositoryRoot, ".git"), { recursive: true });
  await mkdir(root, { recursive: true });
  return { root, repositoryRoot };
}

function store(root: string, repositoryRoot: string): ArchiveStore {
  return new ArchiveStore({ root, repositoryRoots: [repositoryRoot] });
}

test("fails closed when the archive root does not exist", async () => {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-storage-"));
  try {
    assert.throws(
      () => store(join(base, "missing"), join(base, "repo")),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "ARCHIVE_ROOT_MISSING"
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("fails closed when the archive root is inside the Git repository", async () => {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-storage-"));
  try {
    const repositoryRoot = join(base, "repo");
    await mkdir(join(repositoryRoot, ".git"), { recursive: true });
    await mkdir(join(repositoryRoot, "nested", "archive"), { recursive: true });
    assert.throws(
      () => store(join(repositoryRoot, "nested", "archive"), repositoryRoot),
      (error: unknown) =>
        error instanceof ArchiveStoreError && error.code === "ARCHIVE_ROOT_INSIDE_REPOSITORY"
    );
    assert.throws(
      () => store(repositoryRoot, repositoryRoot),
      (error: unknown) =>
        error instanceof ArchiveStoreError && error.code === "ARCHIVE_ROOT_INSIDE_REPOSITORY"
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("archives originals under a content-addressed key with size and hash verification", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("jpeg-payload-not-really-but-fixed");
    const sha256 = sha256OfBytes(bytes);

    const result = await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });

    assert.equal(result.archiveKey, `imports/sess-1/raw/${sha256}.jpg`);
    assert.equal(result.sha256, sha256);
    assert.equal(result.byteSize, bytes.byteLength);
    assert.equal(result.reused, false);

    const readBack = await archive.read(result.archiveKey);
    assert.deepEqual(Buffer.from(readBack), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("rejects a claimed hash that does not match the payload", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    await assert.rejects(
      archive.putOriginal({
        sessionId: "sess-1",
        bytes: Buffer.from("actual content"),
        sha256: sha256OfBytes(Buffer.from("claimed content")),
        extension: "jpg"
      }),
      (error: unknown) =>
        error instanceof ArchiveStoreError && error.code === "HASH_MISMATCH"
    );
    // Nothing must be left behind under the session.
    const files = await archive.listSessionFiles("sess-1");
    assert.deepEqual(files, []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("re-archiving identical content reuses the verified file and never overwrites", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("deterministic payload");
    const sha256 = sha256OfBytes(bytes);

    const first = await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });
    const target = join(root, first.archiveKey);
    const firstWrite = await stat(target);

    const second = await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });
    assert.equal(second.reused, true);
    assert.equal(second.archiveKey, first.archiveKey);

    const secondWrite = await stat(target);
    assert.equal(secondWrite.mtimeMs, firstWrite.mtimeMs);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("refuses to reuse an existing key whose stored content differs", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const original = Buffer.from("first content");
    await archive.putOriginal({
      sessionId: "sess-1",
      bytes: original,
      sha256: sha256OfBytes(original),
      extension: "jpg"
    });

    // Corrupt the stored file behind the store's back.
    const key = `imports/sess-1/raw/${sha256OfBytes(original)}.jpg`;
    await writeFile(join(root, key), "tampered content");

    const retryBytes = Buffer.from("first content");
    await assert.rejects(
      archive.putOriginal({
        sessionId: "sess-1",
        bytes: retryBytes,
        sha256: sha256OfBytes(retryBytes),
        extension: "jpg"
      }),
      (error: unknown) =>
        error instanceof ArchiveStoreError && error.code === "KEY_EXISTS_CONTENT_MISMATCH"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("surfaces write failures as stable errors and leaves no partial archive entry", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("payload that cannot be written");
    const sha256 = sha256OfBytes(bytes);

    const sessionDir = join(root, "imports", "sess-locked");
    await mkdir(sessionDir, { recursive: true });
    await chmod(sessionDir, 0o500);

    try {
      await assert.rejects(
        archive.putOriginal({ sessionId: "sess-locked", bytes, sha256, extension: "jpg" }),
        (error: unknown) => error instanceof ArchiveStoreError && error.code === "WRITE_FAILED"
      );
    } finally {
      await chmod(sessionDir, 0o700);
    }

    // After the failure is repaired the retry succeeds with the same content.
    const retried = await archive.putOriginal({
      sessionId: "sess-locked",
      bytes,
      sha256,
      extension: "jpg"
    });
    assert.equal(retried.reused, false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("does not modify the source file while archiving", async () => {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-storage-"));
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const sourcePath = join(base, "source.jpg");
    const bytes = Buffer.from("original source bytes");
    await writeFile(sourcePath, bytes);
    const before = await stat(sourcePath);

    const archive = store(root, repositoryRoot);
    await archive.putOriginal({
      sessionId: "sess-1",
      bytes,
      sha256: sha256OfBytes(bytes),
      extension: "jpg"
    });

    const after = await stat(sourcePath);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    await rm(base, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("stores processed outputs and resume manifests under versioned group keys", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const main = Buffer.from("main-webp-bytes");
    const thumb = Buffer.from("thumb-webp-bytes");
    const manifest = Buffer.from(
      JSON.stringify({
        mainSha256: sha256OfBytes(main),
        thumbSha256: sha256OfBytes(thumb)
      })
    );

    const mainResult = await archive.putProcessed({
      sessionId: "sess-1",
      groupId: "group-1",
      processingVersion: 1,
      fileName: "bead-512.webp",
      bytes: main
    });
    await archive.putProcessed({
      sessionId: "sess-1",
      groupId: "group-1",
      processingVersion: 1,
      fileName: "thumb-256.webp",
      bytes: thumb
    });
    const manifestResult = await archive.putProcessed({
      sessionId: "sess-1",
      groupId: "group-1",
      processingVersion: 1,
      fileName: "manifest.json",
      bytes: manifest
    });

    assert.equal(mainResult.archiveKey, "imports/sess-1/processed/group-1/v1/bead-512.webp");
    assert.equal(manifestResult.archiveKey, "imports/sess-1/processed/group-1/v1/manifest.json");

    const readMain = await archive.read("imports/sess-1/processed/group-1/v1/bead-512.webp");
    assert.deepEqual(Buffer.from(readMain), main);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("rejects traversal, absolute paths and invalid identifiers in keys", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);

    await assert.rejects(
      archive.read("../outside.bin"),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );
    await assert.rejects(
      archive.read("/etc/passwd"),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );
    await assert.rejects(
      archive.putOriginal({
        sessionId: "../escape",
        bytes: Buffer.from("x"),
        sha256: sha256OfBytes(Buffer.from("x")),
        extension: "jpg"
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );
    await assert.rejects(
      archive.putOriginal({
        sessionId: "sess-1",
        bytes: Buffer.from("x"),
        sha256: "not-a-hash",
        extension: "jpg"
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );
    await assert.rejects(
      archive.putOriginal({
        sessionId: "sess-1",
        bytes: Buffer.from("x"),
        sha256: sha256OfBytes(Buffer.from("x")),
        extension: "exe"
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );
    await assert.rejects(
      archive.putProcessed({
        sessionId: "sess-1",
        groupId: "group-1",
        processingVersion: 1,
        fileName: "../../evil.webp",
        bytes: Buffer.from("x")
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("refuses reads that traverse symlinks outside the archive root", async () => {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-storage-"));
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const secret = join(base, "secret.txt");
    await writeFile(secret, "private");
    await symlink(secret, join(root, "imports-sess-1-raw-link"), "file");

    const archive = store(root, repositoryRoot);
    await assert.rejects(
      archive.read("imports-sess-1-raw-link"),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );
  } finally {
    await rm(base, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("verifiedRead only returns bytes whose hash matches the expectation", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("verified content");
    const sha256 = sha256OfBytes(bytes);
    const { archiveKey } = await archive.putOriginal({
      sessionId: "sess-1",
      bytes,
      sha256,
      extension: "jpg"
    });

    const verified = await archive.verifiedRead(archiveKey, sha256);
    assert.deepEqual(Buffer.from(verified), bytes);

    await assert.rejects(
      archive.verifiedRead(archiveKey, sha256OfBytes(Buffer.from("other"))),
      (error: unknown) =>
        error instanceof ArchiveStoreError && error.code === "HASH_MISMATCH"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("fromEnvironment fails closed without MYSTCRAG_ASSET_ARCHIVE_ROOT", async () => {
  assert.throws(
    () => ArchiveStore.fromEnvironment({ repositoryRoots: ["/tmp/repo"], env: {} }),
    (error: unknown) => error instanceof ArchiveStoreError && error.code === "ARCHIVE_ROOT_MISSING"
  );
});

test("putStaging lands uploads under a fresh UUID key inside the session", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("uploaded staging payload");
    const sha256 = sha256OfBytes(bytes);

    const first = await archive.putStaging({ sessionId: "sess-1", bytes });
    const second = await archive.putStaging({ sessionId: "sess-1", bytes });

    assert.match(first.archiveKey, /^imports\/sess-1\/staging\/[0-9a-f-]{36}$/);
    assert.notEqual(second.archiveKey, first.archiveKey, "every upload gets a fresh staging key");
    assert.equal(first.sha256, sha256);
    assert.deepEqual(Buffer.from(await archive.read(first.archiveKey)), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putStagingStream hashes and lands one chunked upload without exposing a path", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const chunks = [Buffer.from("chunk-one-"), Buffer.from("chunk-two"), Buffer.from("-three")];
    const bytes = Buffer.concat(chunks);

    const result = await archive.putStagingStream({
      sessionId: "sess-stream",
      source: (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
      expectedByteSize: bytes.byteLength,
      maxByteSize: 1024
    });

    assert.deepEqual(Object.keys(result).sort(), ["byteSize", "sha256", "stagingKey"]);
    assert.match(result.stagingKey, /^imports\/sess-stream\/staging\/[0-9a-f-]{36}$/);
    assert.equal(result.byteSize, bytes.byteLength);
    assert.equal(result.sha256, sha256OfBytes(bytes));
    assert.deepEqual(Buffer.from(await archive.read(result.stagingKey)), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putStagingStream rejects an oversized upload before consuming later chunks", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    let chunksConsumed = 0;
    let iteratorCreated = false;
    let iteratorReturned = false;
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        iteratorCreated = true;
        return {
          async next() {
            chunksConsumed += 1;
            return { done: false as const, value: Buffer.from("must-not-be-consumed") };
          },
          async return() {
            iteratorReturned = true;
            return { done: true as const, value: undefined };
          }
        };
      }
    };

    await assert.rejects(
      archive.putStagingStream({
        sessionId: "sess-stream",
        source,
        expectedByteSize: 20,
        maxByteSize: 4
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "PAYLOAD_TOO_LARGE"
    );
    assert.equal(chunksConsumed, 0, "an impossible declared length fails before source consumption");
    assert.equal(iteratorCreated, true, "the store takes ownership of the supplied source");
    assert.equal(iteratorReturned, true, "a pre-read rejection still cancels the supplied source");
    assert.deepEqual(await archive.listSessionFiles("sess-stream"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putStagingStream refuses a symlinked temp directory without writing outside the archive", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  const outside = await mkdtemp(join(tmpdir(), "asset-pipeline-storage-outside-"));
  try {
    const archive = store(root, repositoryRoot);
    await mkdir(join(root, "imports", "sess-symlink"), { recursive: true });
    await symlink(outside, join(root, "imports", "sess-symlink", "tmp"), "dir");

    await assert.rejects(
      archive.putStagingStream({
        sessionId: "sess-symlink",
        source: (async function* () {
          yield Buffer.from("must remain inside the archive");
        })(),
        expectedByteSize: 30,
        maxByteSize: 100
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );
    assert.deepEqual(await archive.listSessionFiles("sess-symlink"), []);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(outside, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putStagingStream surfaces temp cleanup failure and rolls back the business staging key", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  const sessionId = "sess-cleanup";
  const tempDir = join(root, "imports", sessionId, "tmp");
  try {
    const archive = store(root, repositoryRoot);
    await mkdir(tempDir, { recursive: true });
    const bytes = Buffer.from("cleanup must be explicit");

    await assert.rejects(
      archive.putStagingStream({
        sessionId,
        source: (async function* () {
          yield bytes;
          await chmod(tempDir, 0o500);
        })(),
        expectedByteSize: bytes.byteLength,
        maxByteSize: 100
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "WRITE_FAILED"
    );

    await chmod(tempDir, 0o700);
    const files = await archive.listSessionFiles(sessionId);
    assert.equal(
      files.some((key) => key.includes("/staging/")),
      false,
      "a call that reports failure must not leave a business-visible staging key"
    );
  } finally {
    await chmod(tempDir, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putStagingStream cleanup stays bound to its verified temp directory during a symlink swap", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  const outside = await mkdtemp(join(tmpdir(), "asset-pipeline-storage-victim-"));
  const sessionId = "sess-race";
  const sessionDir = join(root, "imports", sessionId);
  const tempDir = join(sessionDir, "tmp");
  const heldTempDir = join(sessionDir, "tmp-held");
  let swapped = false;
  let victimPath: string | undefined;
  try {
    const archive = store(root, repositoryRoot);
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: false as const, value: Buffer.from("too long") };
          },
          async return() {
            const [tempName] = await readdir(tempDir);
            assert.ok(tempName, "the temp upload exists before source cancellation");
            victimPath = join(outside, tempName);
            await writeFile(victimPath, "outside victim must survive");
            await rename(tempDir, heldTempDir);
            await symlink(outside, tempDir, "dir");
            swapped = true;
            return { done: true as const, value: undefined };
          }
        };
      }
    };

    await assert.rejects(
      archive.putStagingStream({
        sessionId,
        source,
        expectedByteSize: 1,
        maxByteSize: 100
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "SIZE_MISMATCH"
    );

    assert.ok(victimPath);
    assert.equal((await stat(victimPath)).isFile(), true, "cleanup must not unlink an external same-name file");
    assert.deepEqual(await readdir(heldTempDir), [], "cleanup targets the originally opened temp directory");
  } finally {
    if (swapped) {
      await unlink(tempDir).catch(() => undefined);
      await rename(heldTempDir, tempDir).catch(() => undefined);
    }
    await rm(outside, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putStagingStream never links into a swapped external staging directory", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  const outside = await mkdtemp(join(tmpdir(), "asset-pipeline-storage-staging-victim-"));
  const sessionId = "sess-staging-race";
  const sessionDir = join(root, "imports", sessionId);
  const stagingDir = join(sessionDir, "staging");
  const heldStagingDir = join(sessionDir, "staging-held");
  let swapped = false;
  try {
    const archive = store(root, repositoryRoot);
    await mkdir(stagingDir, { recursive: true });
    const bytes = Buffer.from("staging target must stay inside");

    await assert.rejects(
      archive.putStagingStream({
        sessionId,
        source: (async function* () {
          yield bytes;
          await rename(stagingDir, heldStagingDir);
          await symlink(outside, stagingDir, "dir");
          swapped = true;
        })(),
        expectedByteSize: bytes.byteLength,
        maxByteSize: 100
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );

    assert.deepEqual(await readdir(outside), [], "the external replacement receives no upload link");
    assert.deepEqual(await readdir(heldStagingDir), [], "the internal target is rolled back on mapping loss");
  } finally {
    if (swapped) {
      await unlink(stagingDir).catch(() => undefined);
      await rename(heldStagingDir, stagingDir).catch(() => undefined);
    }
    await rm(outside, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putStagingStream cancels the source and returns a stable error for a non-string session id", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    let iteratorCreated = false;
    let iteratorReturned = false;
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        iteratorCreated = true;
        return {
          async next() {
            return { done: true as const, value: undefined };
          },
          async return() {
            iteratorReturned = true;
            return { done: true as const, value: undefined };
          }
        };
      }
    };

    await assert.rejects(
      archive.putStagingStream({
        sessionId: Symbol("not-a-session") as never,
        source,
        expectedByteSize: 1,
        maxByteSize: 1
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );
    assert.equal(iteratorCreated, true);
    assert.equal(iteratorReturned, true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putStagingStream still cleans files when the iterator return getter throws", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: false as const, value: Buffer.from("too long") };
          },
          get return(): AsyncIterator<Uint8Array>["return"] {
            throw new Error("return getter failed with private details");
          }
        };
      }
    };

    await assert.rejects(
      archive.putStagingStream({
        sessionId: "sess-return-getter",
        source,
        expectedByteSize: 1,
        maxByteSize: 100
      }),
      (error: unknown) =>
        error instanceof ArchiveStoreError &&
        error.code === "WRITE_FAILED" &&
        !error.message.includes("private details")
    );
    assert.deepEqual(await archive.listSessionFiles("sess-return-getter"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putStagingStream rejects early and late declared-length mismatches and cleans partial files", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    let laterChunkConsumed = false;
    await assert.rejects(
      archive.putStagingStream({
        sessionId: "sess-early",
        source: (async function* () {
          yield Buffer.from("too-long");
          laterChunkConsumed = true;
          yield Buffer.from("never");
        })(),
        expectedByteSize: 3,
        maxByteSize: 100
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "SIZE_MISMATCH"
    );
    assert.equal(laterChunkConsumed, false, "the stream stops at the first over-declared chunk");
    assert.deepEqual(await archive.listSessionFiles("sess-early"), []);

    await assert.rejects(
      archive.putStagingStream({
        sessionId: "sess-late",
        source: (async function* () {
          yield Buffer.from("short");
        })(),
        expectedByteSize: 10,
        maxByteSize: 100
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "SIZE_MISMATCH"
    );
    assert.deepEqual(await archive.listSessionFiles("sess-late"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putStagingStream wraps source failures and leaves no staging or temp file", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    await assert.rejects(
      archive.putStagingStream({
        sessionId: "sess-error",
        source: (async function* () {
          yield Buffer.from("partial");
          throw new Error("socket reset with private upload details");
        })(),
        expectedByteSize: 20,
        maxByteSize: 100
      }),
      (error: unknown) =>
        error instanceof ArchiveStoreError &&
        error.code === "WRITE_FAILED" &&
        !error.message.includes("private upload details")
    );
    assert.deepEqual(await archive.listSessionFiles("sess-error"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putStagingStream validates identifiers and safe positive byte limits", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const attempts = [
      { sessionId: "../escape", expectedByteSize: 1, maxByteSize: 1 },
      { sessionId: "sess-1", expectedByteSize: 0, maxByteSize: 1 },
      { sessionId: "sess-1", expectedByteSize: 1, maxByteSize: 0 },
      { sessionId: "sess-1", expectedByteSize: 1.5, maxByteSize: 2 },
      { sessionId: "sess-1", expectedByteSize: 1, maxByteSize: Number.MAX_SAFE_INTEGER + 1 }
    ];
    for (const attempt of attempts) {
      await assert.rejects(
        archive.putStagingStream({
          ...attempt,
          source: (async function* () {
            yield Buffer.from("x");
          })()
        }),
        (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("removeStaging consumes staging entries idempotently but refuses raw and processed keys", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("staged content");
    const { archiveKey } = await archive.putStaging({ sessionId: "sess-1", bytes });

    await archive.removeStaging(archiveKey);
    await assert.rejects(archive.read(archiveKey));
    // Removing an already-consumed staging key is a no-op, not an error.
    await archive.removeStaging(archiveKey);

    const rawKey = (
      await archive.putOriginal({
        sessionId: "sess-1",
        bytes: Buffer.from("raw"),
        sha256: sha256OfBytes(Buffer.from("raw")),
        extension: "jpg"
      })
    ).archiveKey;
    const processedKey = (
      await archive.putProcessed({
        sessionId: "sess-1",
        groupId: "group-1",
        processingVersion: 1,
        fileName: "bead-512.webp",
        bytes: Buffer.from("webp")
      })
    ).archiveKey;

    for (const immutableKey of [rawKey, processedKey, "imports/sess-1/raw", "../outside"]) {
      await assert.rejects(
        archive.removeStaging(immutableKey),
        (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
      );
    }
    // The refused removals never deleted the immutable entries.
    await archive.read(rawKey);
    await archive.read(processedKey);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("fails closed when a supplied repository root cannot be resolved", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    assert.throws(
      () => store(root, "/definitely/not/an/existing/repository"),
      (error: unknown) =>
        error instanceof ArchiveStoreError && error.code === "REPOSITORY_ROOT_INVALID",
      "a supplied repository root that cannot be resolved must fail closed instead of being skipped"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("read() reports READ_FAILED instead of KEY_INVALID when the directory denies search", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("archived content");
    const sha256 = sha256OfBytes(bytes);
    const put = await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });

    // The key exists and holds the right content; only the directory's
    // permissions block access. The read must open the file through one
    // verified descriptor and surface the permission failure as READ_FAILED —
    // reporting KEY_INVALID would claim the archived file does not exist.
    const rawDir = join(root, "imports", "sess-1", "raw");
    await chmod(rawDir, 0o000);
    try {
      await assert.rejects(
        archive.read(put.archiveKey),
        (error: unknown) => error instanceof ArchiveStoreError && error.code === "READ_FAILED",
        "an unreadable directory must surface as READ_FAILED, not as a missing key"
      );
    } finally {
      await chmod(rawDir, 0o700);
    }

    assert.deepEqual(Buffer.from(await archive.read(put.archiveKey)), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("removeStaging rejects malformed staging keys through the strict staging key parser", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const validUuid = "00000000-0000-4000-8000-000000000000";
    const malformed = [
      "imports/sess-1/staging/not-a-uuid",
      "imports/sess-1/staging/00000000-0000-4000-8000-00000000000g",
      "imports/sess-1/staging/00000000-0000-4000-8000-00000000000A",
      "imports/sess-1/staging/00000000-0000-4000-8000-000000000000/extra",
      "imports/sess-1/raw/00000000-0000-4000-8000-000000000000"
    ];
    for (const key of malformed) {
      await assert.rejects(
        archive.removeStaging(key),
        (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID",
        `${key} must be rejected by the strict staging key parser`
      );
    }
    // A well-formed staging key that simply does not exist stays an idempotent no-op.
    await archive.removeStaging(`imports/sess-1/staging/${validUuid}`);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("removeStaging treats only ENOENT as an idempotent missing entry", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    await archive.putStaging({ sessionId: "sess-1", bytes: Buffer.from("staged") });
    const stagingDir = join(root, "imports", "sess-1", "staging");
    await chmod(stagingDir, 0o000);
    try {
      await assert.rejects(
        archive.removeStaging("imports/sess-1/staging/00000000-0000-4000-8000-000000000000"),
        (error: unknown) =>
          error instanceof ArchiveStoreError && error.code === "WRITE_FAILED",
        "an unreadable staging directory is an error, not a silent missing entry"
      );
    } finally {
      await chmod(stagingDir, 0o700);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("listSessionFiles fails closed on an unreadable session directory", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("listed content");
    await archive.putOriginal({
      sessionId: "sess-1",
      bytes,
      sha256: sha256OfBytes(bytes),
      extension: "jpg"
    });

    const sessionDir = join(root, "imports", "sess-1");
    await chmod(sessionDir, 0o000);
    try {
      await assert.rejects(
        archive.listSessionFiles("sess-1"),
        (error: unknown) =>
          error instanceof ArchiveStoreError && error.code === "READ_FAILED",
        "an unreadable session directory must not silently report an empty listing"
      );
    } finally {
      await chmod(sessionDir, 0o700);
    }

    // An unknown session has no directory at all and stays an empty listing.
    assert.deepEqual(await archive.listSessionFiles("sess-unknown"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("listSessionFiles reports regular files only and never follows or lists symlinks", async () => {
  const base = await mkdtemp(join(tmpdir(), "asset-pipeline-storage-"));
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("listed content");
    const sha256 = sha256OfBytes(bytes);
    await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });

    const outside = join(base, "outside");
    await mkdir(join(outside, "deep"), { recursive: true });
    await writeFile(join(outside, "secret.bin"), "secret");
    await writeFile(join(outside, "deep", "nested.bin"), "nested");
    await symlink(outside, join(root, "imports", "sess-1", "raw", "escape-link"), "dir");

    const files = await archive.listSessionFiles("sess-1");
    assert.ok(files.includes(`imports/sess-1/raw/${sha256}.jpg`), "the real archived file is listed");
    assert.ok(
      !files.includes("imports/sess-1/raw/escape-link"),
      "a symlink must not be reported as an archived file"
    );
    assert.ok(
      files.every((key) => !key.includes("secret") && !key.includes("nested")),
      "the listing must never follow a symlink into another tree"
    );
  } finally {
    await rm(base, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putOriginal rejects a regular file used as an archive path ancestor", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    await writeFile(join(root, "imports"), "not a directory");
    const bytes = Buffer.from("archived content");
    await assert.rejects(
      store(root, repositoryRoot).putOriginal({
        sessionId: "sess-1",
        bytes,
        sha256: sha256OfBytes(bytes),
        extension: "jpg"
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID",
      "every existing intermediate archive segment must be a real directory"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putOriginal wraps archive-path permission failures in the stable WRITE_FAILED code", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  const importsDir = join(root, "imports");
  try {
    await mkdir(importsDir);
    await chmod(importsDir, 0o000);
    const bytes = Buffer.from("archived content");
    await assert.rejects(
      store(root, repositoryRoot).putOriginal({
        sessionId: "sess-1",
        bytes,
        sha256: sha256OfBytes(bytes),
        extension: "jpg"
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "WRITE_FAILED",
      "filesystem errno values must not escape the ArchiveStore error contract"
    );
  } finally {
    await chmod(importsDir, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("putProcessed rejects unsafe processing versions", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    await assert.rejects(
      store(root, repositoryRoot).putProcessed({
        sessionId: "sess-1",
        groupId: "group-1",
        processingVersion: Number.MAX_SAFE_INTEGER + 1,
        fileName: "bead-512.webp",
        bytes: Buffer.from("webp")
      }),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("openVerifiedRead streams verified bytes in bounded chunks from a single descriptor", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    // 200 KiB: a whole-file read would hold this resident; streaming must not.
    const bytes = Buffer.alloc(200 * 1024);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    const sha256 = sha256OfBytes(bytes);
    await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });

    const { stream, byteSize, sha256: digest } = await archive.openVerifiedRead(
      `imports/sess-1/raw/${sha256}.jpg`,
      sha256
    );
    assert.equal(byteSize, bytes.byteLength);
    assert.equal(digest, sha256);

    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    assert.ok(chunks.length > 1, "a 200 KiB file must be read in more than one chunk");
    for (const chunk of chunks) {
      assert.ok(chunk.byteLength <= 64 * 1024, "every chunk stays within the read bound");
    }
    assert.deepEqual(Buffer.concat(chunks), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("openVerifiedRead verifies a claimed digest and rejects a mismatch", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("streamed digest payload");
    const sha256 = sha256OfBytes(bytes);
    await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });
    const key = `imports/sess-1/raw/${sha256}.jpg`;

    const verified = await archive.openVerifiedRead(key, sha256);
    assert.equal(verified.sha256, sha256);
    assert.equal(verified.byteSize, bytes.byteLength);
    assert.deepEqual(await collectStream(verified.stream), bytes);

    await assert.rejects(
      archive.openVerifiedRead(key, "f".repeat(64)),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "HASH_MISMATCH"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("openVerifiedRead refuses a symlinked final segment", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("symlink target payload");
    const sha256 = sha256OfBytes(bytes);
    await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });

    const key = `imports/sess-1/raw/${sha256}.jpg`;
    const targetPath = join(root, key);
    await unlink(targetPath);
    const outside = join(root, "..", "outside.bin");
    await writeFile(outside, bytes);
    await symlink(outside, targetPath);

    await assert.rejects(
      archive.openVerifiedRead(key, sha256),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "KEY_INVALID"
    );
    await rm(outside, { force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("openVerifiedRead serves the originally opened inode when the path is replaced after verification", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("the verified original bytes");
    const sha256 = sha256OfBytes(bytes);
    await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });
    const key = `imports/sess-1/raw/${sha256}.jpg`;
    const targetPath = join(root, key);

    // Verification happens against one open descriptor; the stream must read
    // the same inode. Replace the path *after* openVerifiedRead returns.
    const { stream } = await archive.openVerifiedRead(key, sha256);
    await unlink(targetPath);
    await writeFile(targetPath, "an attacker-replaced regular file");

    // The body still comes from the verified original inode, not the new file.
    assert.deepEqual(await collectStream(stream), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("openVerifiedRead opens exactly one descriptor and closes it on completion", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("one descriptor, closed on completion");
    const sha256 = sha256OfBytes(bytes);
    await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });
    const key = `imports/sess-1/raw/${sha256}.jpg`;

    const base = countOpenFileDescriptors();
    const { stream } = await archive.openVerifiedRead(key, sha256);
    // The digest and the stream share one descriptor: exactly one new fd.
    assert.equal(countOpenFileDescriptors(), base + 1);

    assert.deepEqual(await collectStream(stream), bytes);
    await waitForClose(stream);
    assert.equal(countOpenFileDescriptors(), base);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("openVerifiedRead closes its descriptor on early stream destroy", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.alloc(256 * 1024, 7);
    const sha256 = sha256OfBytes(bytes);
    await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });
    const key = `imports/sess-1/raw/${sha256}.jpg`;

    const base = countOpenFileDescriptors();
    const { stream } = await archive.openVerifiedRead(key, sha256);
    assert.equal(countOpenFileDescriptors(), base + 1);

    // Abort after the first chunk, as a client disconnect would.
    stream.once("data", () => stream.destroy());
    await waitForClose(stream);
    assert.equal(countOpenFileDescriptors(), base);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("openVerifiedRead closes its descriptor when the digest mismatches", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.from("content that will not match");
    const sha256 = sha256OfBytes(bytes);
    await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });
    const key = `imports/sess-1/raw/${sha256}.jpg`;

    const base = countOpenFileDescriptors();
    await assert.rejects(
      archive.openVerifiedRead(key, "f".repeat(64)),
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "HASH_MISMATCH"
    );
    assert.equal(countOpenFileDescriptors(), base);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("openVerifiedRead errors and closes its descriptor when a mid-stream read fails", async () => {
  const { root, repositoryRoot } = await createArchiveRoot();
  try {
    const archive = store(root, repositoryRoot);
    const bytes = Buffer.alloc(3 * 64 * 1024, 3);
    const sha256 = sha256OfBytes(bytes);
    await archive.putOriginal({ sessionId: "sess-1", bytes, sha256, extension: "jpg" });
    const key = `imports/sess-1/raw/${sha256}.jpg`;
    const targetPath = join(root, key);

    const base = countOpenFileDescriptors();
    const { stream } = await archive.openVerifiedRead(key, sha256);
    assert.equal(countOpenFileDescriptors(), base + 1);

    // The stream read-ahead may have completed one chunk before the truncate
    // landed; what matters is that the body never completes: the next
    // positional read past the new EOF must surface READ_FAILED instead of
    // short-changing the body that Content-Length promised.
    let chunks = 0;
    await assert.rejects(
      async () => {
        for await (const chunk of stream) {
          chunks += 1;
          if (chunks === 1) await truncate(targetPath, 1);
          void chunk;
        }
      },
      (error: unknown) => error instanceof ArchiveStoreError && error.code === "READ_FAILED"
    );
    assert.ok(chunks < 3, "the truncated body must fail before streaming all verified bytes");
    await waitForClose(stream);
    assert.equal(countOpenFileDescriptors(), base);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
