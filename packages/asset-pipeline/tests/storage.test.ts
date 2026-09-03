import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256OfBytes } from "../src/hash.js";
import { ArchiveStore, ArchiveStoreError } from "../src/storage.js";

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
