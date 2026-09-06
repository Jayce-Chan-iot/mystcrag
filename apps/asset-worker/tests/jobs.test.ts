import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import sharp from "sharp";

import { ArchiveStore, ArchiveStoreError, sha256OfBytes } from "@mystcrag/asset-pipeline";
import type { ClaimedAssetJob } from "@mystcrag/database";

import {
  ArchiveFileJobPayloadSchema,
  GroupSessionJobPayloadSchema,
  ProcessGroupJobPayloadSchema,
  classifyHandlerError,
  createJobHandlers,
  handleArchiveFile,
  handleGroupSession,
  handleProcessGroup,
  isRetryableWorkerErrorCode,
  JobExecutionError,
  type JobRunContext,
  WORKER_ERROR_CODES,
  wrapArchiveError
} from "../src/jobs.js";

const SOURCE_PX = 800;

function beadSceneSvg(beadColor: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SOURCE_PX}" height="${SOURCE_PX}">
    <rect width="${SOURCE_PX}" height="${SOURCE_PX}" fill="#f0f0f0"/>
    <circle cx="400" cy="400" r="260" fill="${beadColor}"/>
    <circle cx="330" cy="330" r="60" fill="#ffffff" opacity="0.85"/>
  </svg>`;
}

async function renderPng(svg: string): Promise<Uint8Array> {
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

async function renderJpeg(svg: string): Promise<Uint8Array> {
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg().toBuffer());
}

/**
 * Minimal structurally valid Sony ARW: little-endian TIFF whose IFD0 carries
 * an ASCII Make tag "SONY" (NUL-terminated, at a legal offset) plus a CFA
 * PhotometricInterpretation marker — the same rules detectAssetSourceKind
 * enforces. Sharp cannot decode ARW sensor data, which is exactly why the
 * ARW path must never require a raster decode.
 */
function minimalSonyArw(): Uint8Array {
  const ifdOffset = 8;
  const ifdSize = 2 + 2 * 12 + 4;
  const makeOffset = ifdOffset + ifdSize;
  const entries = [
    { tag: 0x0106, type: 3, count: 1, inline: 32803 },
    { tag: 0x010f, type: 2, count: 5, offset: makeOffset }
  ];
  const buffer = Buffer.alloc(makeOffset + 5);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  buffer.set([0x49, 0x49, 0x2a, 0x00], 0);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries.length, true);
  let at = ifdOffset + 2;
  for (const entry of entries) {
    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.type, true);
    view.setUint32(at + 4, entry.count, true);
    if (entry.inline !== undefined) view.setUint16(at + 8, entry.inline, true);
    else view.setUint32(at + 8, entry.offset!, true);
    at += 12;
  }
  view.setUint32(at, 0, true);
  buffer.set(Buffer.from("SONY\0", "latin1"), makeOffset);
  return new Uint8Array(buffer);
}

function makeStore(): { store: ArchiveStore; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "asset-worker-jobs-"));
  const store = new ArchiveStore({ root, repositoryRoots: [] });
  return { store, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const SESSION = "session-jobs-test";
const PROCESS_GROUP_OUTPUT_KEY = `imports/${SESSION}/processed/group-1/v1/bead-512.webp`;

const ARCHIVE_FILE_PAYLOAD = {
  fileId: "file-1",
  stagingKey: `imports/${SESSION}/staging/00000000-0000-4000-8000-000000000001`,
  sha256: ""
} as { fileId: string; stagingKey: string; sha256: string };

const PROCESS_GROUP_PAYLOAD_BASE = {
  groupId: "group-1",
  processingVersion: 1,
  outputStorageKey: PROCESS_GROUP_OUTPUT_KEY,
  files: [] as Array<{ fileId: string; archiveKey: string; sha256: string }>
};

const GROUP_SESSION_FILE_BASE = {
  fileId: "",
  clientFileId: "",
  relativePath: "",
  sha256: "",
  archiveKey: "",
  byteSize: 0,
  lastModifiedMs: 0,
  // The tests archive PNG payloads under .png raw keys, so the declared kind
  // must match the key extension the payload validation now cross-checks.
  kind: "PNG" as const
};

test("job payload contracts reject malformed payloads", () => {
  assert.equal(ArchiveFileJobPayloadSchema.safeParse({}).success, false);
  assert.equal(
    ArchiveFileJobPayloadSchema.safeParse({ ...ARCHIVE_FILE_PAYLOAD, extra: 1 }).success,
    false
  );
  assert.equal(
    ArchiveFileJobPayloadSchema.safeParse({ ...ARCHIVE_FILE_PAYLOAD, sha256: "not-a-hash" }).success,
    false
  );

  assert.equal(ProcessGroupJobPayloadSchema.safeParse({ ...PROCESS_GROUP_PAYLOAD_BASE }).success, false);
  assert.equal(
    ProcessGroupJobPayloadSchema.safeParse({
      ...PROCESS_GROUP_PAYLOAD_BASE,
      primaryFileId: "file-1",
      files: [{
        fileId: "file-1",
        archiveKey: `imports/${SESSION}/raw/${"a".repeat(64)}.jpg`,
        sha256: "a".repeat(64)
      }],
      settings: { maskThreshold: 0.25, edgeFeatherPx: 0 }
    }).success,
    true,
    "the Worker boundary must accept the database-owned PROCESS_GROUP additions"
  );
  assert.equal(
    ProcessGroupJobPayloadSchema.safeParse({
      ...PROCESS_GROUP_PAYLOAD_BASE,
      groupId: "group-1",
      processingVersion: 0,
      files: [{ fileId: "f", archiveKey: "imports/s/raw/x.jpg", sha256: "".padStart(64, "0") }]
    }).success,
    false
  );

  assert.equal(GroupSessionJobPayloadSchema.safeParse({ files: [] }).success, false);
  assert.equal(
    GroupSessionJobPayloadSchema.safeParse({
      files: [{ ...GROUP_SESSION_FILE_BASE, fileId: "f", clientFileId: "c", sha256: "".padStart(64, "0") }]
    }).success,
    false
  );
});

test("handleArchiveFile verifies staging content, archives the original and reports the result", async () => {
  const { store, cleanup } = makeStore();
  try {
    const bytes = await renderPng(beadSceneSvg("#4169e1"));
    const sha256 = sha256OfBytes(bytes);
    const staging = await store.putStaging({ sessionId: SESSION, bytes });
    const payload = { fileId: "file-1", stagingKey: staging.archiveKey, sha256 };

    const result = await handleArchiveFile(store, payload);

    assert.equal(result.kind, "ARCHIVE_FILE");
    assert.equal(result.sha256, sha256);
    assert.equal(
      result.archiveKey,
      `imports/${SESSION}/raw/${sha256}.png`
    );
    assert.equal(result.storageProvider, "local-fs");
    // The archived original reads back byte-identical. The staging entry is
    // NOT consumed here: it is the recovery input for a retry and may only be
    // removed after the job result commits.
    assert.deepEqual(new Uint8Array(await store.verifiedRead(result.archiveKey, sha256)), bytes);
    assert.equal(sha256OfBytes(await store.read(staging.archiveKey)), sha256);
  } finally {
    cleanup();
  }
});

test("handleArchiveFile rejects a staging hash mismatch without touching the archive", async () => {
  const { store, cleanup } = makeStore();
  try {
    const bytes = await renderPng(beadSceneSvg("#aa336a"));
    const staging = await store.putStaging({ sessionId: SESSION, bytes });
    const claimed = sha256OfBytes(new Uint8Array([1, 2, 3]));

    await assert.rejects(
      handleArchiveFile(store, { fileId: "file-1", stagingKey: staging.archiveKey, sha256: claimed }),
      (error: unknown) => {
        assert.ok(error instanceof JobExecutionError);
        assert.equal(error.code, "STAGING_HASH_MISMATCH");
        assert.equal(error.retryable, false);
        return true;
      }
    );
    // Staging is preserved for investigation on a mismatch.
    assert.equal(sha256OfBytes(await store.read(staging.archiveKey)), sha256OfBytes(bytes));
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Round 5 C: a magic-byte sniff is never archiving evidence on its own.
// Rasters must fully decode before anything is archived or recorded.
// ---------------------------------------------------------------------------

test("handleArchiveFile refuses magic-byte stubs that can never decode", async () => {
  const { store, cleanup } = makeStore();
  try {
    const stubs: Array<{ description: string; bytes: Uint8Array }> = [
      { description: "a 3-byte ff d8 ff JPEG stub", bytes: new Uint8Array([0xff, 0xd8, 0xff]) },
      {
        description: "an 8-byte PNG signature stub",
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      },
      {
        description: "a 12-byte RIFF....WEBP header stub",
        bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
      }
    ];
    for (const { description, bytes } of stubs) {
      const sha256 = sha256OfBytes(bytes);
      const staging = await store.putStaging({ sessionId: SESSION, bytes });
      await assert.rejects(
        handleArchiveFile(store, { fileId: "file-1", stagingKey: staging.archiveKey, sha256 }),
        (error: unknown) => {
          assert.ok(error instanceof JobExecutionError, `${description}: expected a JobExecutionError`);
          assert.equal(error.code, "CORRUPT_FILE_CONTENT", description);
          assert.equal(error.retryable, false, description);
          return true;
        },
        description
      );
      // Nothing was archived and no business row was written: the decode gate
      // runs strictly before putOriginal and recordUploadedFile.
      const sessionFiles = await store.listSessionFiles(SESSION);
      assert.equal(
        sessionFiles.filter((key) => key.includes("/raw/")).length,
        0,
        `${description}: no original may be archived`
      );
      assert.equal(
        sha256OfBytes(await store.read(staging.archiveKey)),
        sha256,
        `${description}: the staging entry stays for investigation and retry`
      );
    }
  } finally {
    cleanup();
  }
});

test("handleArchiveFile reports unknown content with the stable UNSUPPORTED_FILE_KIND code", async () => {
  const { store, cleanup } = makeStore();
  try {
    const bytes = new Uint8Array(Buffer.from("definitely not an image payload", "utf8"));
    const sha256 = sha256OfBytes(bytes);
    const staging = await store.putStaging({ sessionId: SESSION, bytes });
    await assert.rejects(
      handleArchiveFile(store, { fileId: "file-1", stagingKey: staging.archiveKey, sha256 }),
      (error: unknown) => {
        assert.ok(error instanceof JobExecutionError);
        assert.equal(error.code, "UNSUPPORTED_FILE_KIND");
        assert.equal(error.retryable, false);
        return true;
      }
    );
    assert.equal(
      (await store.listSessionFiles(SESSION)).filter((key) => key.includes("/raw/")).length,
      0,
      "no original may be archived for unknown content"
    );
  } finally {
    cleanup();
  }
});

test("handleGroupSession re-checks the archived content against the declared kind", async () => {
  const { store, cleanup } = makeStore();
  try {
    // A real JPEG archived under a .png raw key: the key grammar alone cannot
    // see this; only reading the content back can.
    const jpegBytes = await renderJpeg(beadSceneSvg("#4169e1"));
    const sha256 = sha256OfBytes(jpegBytes);
    const archiveKey = (
      await store.putOriginal({ sessionId: SESSION, bytes: jpegBytes, sha256, extension: "png" })
    ).archiveKey;

    await assert.rejects(
      handleGroupSession(store, {
        files: [
          {
            ...GROUP_SESSION_FILE_BASE,
            fileId: "file-1",
            clientFileId: "cf-1",
            relativePath: "dir/bead.png",
            sha256,
            archiveKey,
            byteSize: jpegBytes.byteLength,
            lastModifiedMs: 1_750_000_000_000
          }
        ]
      }),
      (error: unknown) => {
        assert.ok(error instanceof JobExecutionError);
        assert.equal(error.code, "CONTENT_KIND_MISMATCH");
        assert.equal(error.retryable, false);
        return true;
      }
    );
  } finally {
    cleanup();
  }
});

test("handleGroupSession refuses a declared raster whose pixels cannot decode", async () => {
  const { store, cleanup } = makeStore();
  try {
    // Truncated JPEG: the magic sniffs as JPEG, the pixels never decode.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const sha256 = sha256OfBytes(bytes);
    const archiveKey = (
      await store.putOriginal({ sessionId: SESSION, bytes, sha256, extension: "jpg" })
    ).archiveKey;

    await assert.rejects(
      handleGroupSession(store, {
        files: [
          {
            ...GROUP_SESSION_FILE_BASE,
            kind: "JPEG" as const,
            fileId: "file-1",
            clientFileId: "cf-1",
            relativePath: "dir/bead.jpg",
            sha256,
            archiveKey,
            byteSize: bytes.byteLength,
            lastModifiedMs: 1_750_000_000_000
          }
        ]
      }),
      (error: unknown) => {
        assert.ok(error instanceof JobExecutionError);
        assert.equal(error.code, "CORRUPT_FILE_CONTENT");
        assert.equal(error.retryable, false);
        return true;
      },
      "an undecodable raster must fail the job instead of silently grouping on non-visual signals"
    );
  } finally {
    cleanup();
  }
});

test("handleGroupSession rejects archived bytes whose size disagrees with the payload", async () => {
  const { store, cleanup } = makeStore();
  try {
    const bytes = await renderPng(beadSceneSvg("#5f9ea0"));
    const sha256 = sha256OfBytes(bytes);
    const archiveKey = (
      await store.putOriginal({ sessionId: SESSION, bytes, sha256, extension: "png" })
    ).archiveKey;

    await assert.rejects(
      handleGroupSession(store, {
        files: [
          {
            ...GROUP_SESSION_FILE_BASE,
            fileId: "file-1",
            clientFileId: "cf-1",
            relativePath: "dir/bead.png",
            sha256,
            archiveKey,
            byteSize: bytes.byteLength + 1,
            lastModifiedMs: 1_750_000_000_000
          }
        ]
      }),
      (error: unknown) => error instanceof JobExecutionError && error.code === "PAYLOAD_INVALID"
    );
  } finally {
    cleanup();
  }
});

function archiveFileJob(payload: unknown): ClaimedAssetJob {
  return {
    jobId: "job-archive-1",
    sessionId: SESSION,
    groupId: null,
    jobType: "ARCHIVE_FILE",
    state: "RUNNING",
    payload,
    retryCount: 0,
    maxRetries: 3,
    lease: { workerId: "worker-jobs-test", leaseToken: "token-1" },
    leaseUntil: new Date(Date.now() + 60_000)
  };
}

test("ARCHIVE_FILE composition removes staging only after the job result commits", async () => {
  const { store, cleanup } = makeStore();
  const recorded: Array<{
    fileId: string;
    sha256: string;
    archiveKey: string;
    options: unknown;
  }> = [];
  const repository = {
    recordUploadedFile: async (fileId: string, sha256: string, archiveKey: string, options: unknown) => {
      recorded.push({ fileId, sha256, archiveKey, options });
      return { fileId };
    }
  };
  try {
    const bytes = await renderPng(beadSceneSvg("#20b2aa"));
    const sha256 = sha256OfBytes(bytes);
    const staging = await store.putStaging({ sessionId: SESSION, bytes });
    const handlers = createJobHandlers({ store, repository });
    const job = archiveFileJob({ fileId: "file-1", stagingKey: staging.archiveKey, sha256 });

    const outcome = await handlers.ARCHIVE_FILE(job, NEVER_LOST);

    // The handler archived the original and recorded the file row, but the
    // staging entry must survive until the runtime commits the result.
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.archiveKey, `imports/${SESSION}/raw/${sha256}.png`);
    assert.deepEqual(recorded[0]!.options, {
      storageProvider: "local-fs",
      jobId: job.jobId,
      lease: job.lease
    });
    assert.equal(sha256OfBytes(await store.read(staging.archiveKey)), sha256);

    assert.ok(outcome.afterCommit, "the composition provides the post-commit cleanup");
    await outcome.afterCommit!();
    await assert.rejects(store.read(staging.archiveKey));
  } finally {
    cleanup();
  }
});

const NEVER_LOST: JobRunContext = {
  signal: new AbortController().signal,
  throwIfLeaseLost: () => {}
};

test("a failed recordUploadedFile keeps the staging entry for the retry", async () => {
  const { store, cleanup } = makeStore();
  const repository = {
    recordUploadedFile: async () => {
      throw new Error("database unavailable");
    }
  };
  try {
    const bytes = await renderPng(beadSceneSvg("#9370db"));
    const sha256 = sha256OfBytes(bytes);
    const staging = await store.putStaging({ sessionId: SESSION, bytes });
    const handlers = createJobHandlers({ store, repository });

    await assert.rejects(handlers.ARCHIVE_FILE(archiveFileJob({
      fileId: "file-1",
      stagingKey: staging.archiveKey,
      sha256
    }), NEVER_LOST), /database unavailable/);
    // The business write failed before any commit, so the recovery input stays.
    assert.equal(sha256OfBytes(await store.read(staging.archiveKey)), sha256);
  } finally {
    cleanup();
  }
});

/**
 * A context mirroring the runtime's lease guard with the lease already lost:
 * the signal is aborted and throwIfLeaseLost converts that state into the
 * stable JOB_LEASE_CONFLICT error.
 */
function lostLeaseContext(): JobRunContext {
  const controller = new AbortController();
  controller.abort();
  return {
    signal: controller.signal,
    throwIfLeaseLost: () => {
      throw new JobExecutionError(
        "JOB_LEASE_CONFLICT",
        "The job lease was lost while the handler was running",
        false
      );
    }
  };
}

test("a lost lease stops the composed handlers before any side effect", async () => {
  const { store, cleanup } = makeStore();
  const recorded: string[] = [];
  const repository = {
    recordUploadedFile: async (fileId: string) => {
      recorded.push(fileId);
      return { fileId };
    }
  };
  try {
    const bytes = await renderPng(beadSceneSvg("#4682b4"));
    const sha256 = sha256OfBytes(bytes);
    const staging = await store.putStaging({ sessionId: SESSION, bytes });
    const handlers = createJobHandlers({ store, repository });
    const job = archiveFileJob({ fileId: "file-1", stagingKey: staging.archiveKey, sha256 });

    await assert.rejects(
      handlers.ARCHIVE_FILE(job, lostLeaseContext()),
      (error: unknown) => {
        assert.ok(error instanceof JobExecutionError);
        assert.equal(error.code, "JOB_LEASE_CONFLICT");
        return true;
      }
    );

    // The staging read itself is a recovery-safe read, but no storage write and
    // no business write may start once the lease is known lost.
    assert.equal(recorded.length, 0, "recordUploadedFile must not run after the lease loss");
    const rawFiles = (await store.listSessionFiles(SESSION)).filter((key) => key.includes("/raw/"));
    assert.deepEqual(rawFiles, [], "no raw original may be written after the lease loss");
    assert.equal(sha256OfBytes(await store.read(staging.archiveKey)), sha256);
  } finally {
    cleanup();
  }
});

test("a lost lease stops PROCESS_GROUP before it writes processed outputs", async () => {
  const { store, cleanup } = makeStore();
  try {
    const bytes = await renderPng(beadSceneSvg("#daa520"));
    const sha256 = sha256OfBytes(bytes);
    const archiveKey = (
      await store.putOriginal({ sessionId: SESSION, bytes, sha256, extension: "png" })
    ).archiveKey;
    const handlers = createJobHandlers({ store, repository: { recordUploadedFile: async () => ({}) } });
    const job: ClaimedAssetJob = {
      jobId: "job-1",
      sessionId: SESSION,
      groupId: "group-1",
      jobType: "PROCESS_GROUP",
      state: "RUNNING",
      payload: {
        groupId: "group-1",
        processingVersion: 1,
        outputStorageKey: PROCESS_GROUP_OUTPUT_KEY,
        primaryFileId: "file-1",
        files: [{ fileId: "file-1", archiveKey, sha256 }]
      },
      retryCount: 0,
      maxRetries: 3,
      lease: { workerId: "worker-jobs-test", leaseToken: "token-1" },
      leaseUntil: new Date(Date.now() + 60_000)
    };

    await assert.rejects(
      handlers.PROCESS_GROUP(job, lostLeaseContext()),
      (error: unknown) => {
        assert.ok(error instanceof JobExecutionError);
        assert.equal(error.code, "JOB_LEASE_CONFLICT");
        return true;
      }
    );
    const processedFiles = (await store.listSessionFiles(SESSION)).filter((key) =>
      key.includes("/processed/")
    );
    assert.deepEqual(processedFiles, [], "no processed output may be written after the lease loss");
  } finally {
    cleanup();
  }
});

test("an ARCHIVE_FILE retry after a lost completion reuses the archived original", async () => {
  const { store, cleanup } = makeStore();
  const recorded: string[] = [];
  const repository = {
    recordUploadedFile: async (fileId: string) => {
      recorded.push(fileId);
      return { fileId };
    }
  };
  try {
    const bytes = await renderPng(beadSceneSvg("#ff7f50"));
    const sha256 = sha256OfBytes(bytes);
    const staging = await store.putStaging({ sessionId: SESSION, bytes });
    const handlers = createJobHandlers({ store, repository });
    const job = archiveFileJob({ fileId: "file-1", stagingKey: staging.archiveKey, sha256 });

    // First attempt "crashes" after the handler: the result never commits,
    // the cleanup never runs, the staging entry stays.
    const first = await handlers.ARCHIVE_FILE(job, NEVER_LOST);
    // Second attempt (reclaimed job) re-runs the same payload.
    const second = await handlers.ARCHIVE_FILE(job, NEVER_LOST);

    assert.ok(
      first.result.kind === "ARCHIVE_FILE" && second.result.kind === "ARCHIVE_FILE",
      "both attempts produce ARCHIVE_FILE results"
    );
    assert.equal(first.result.archiveKey, second.result.archiveKey);
    assert.equal(first.result.sha256, second.result.sha256);
    assert.deepEqual(recorded, ["file-1", "file-1"], "the file record is recorded per attempt");
    // Still exactly one raw original, and staging is untouched until commit.
    const sessionFiles = await store.listSessionFiles(SESSION);
    const rawFiles = sessionFiles.filter((key) => key.includes("/raw/"));
    assert.deepEqual(rawFiles, [`imports/${SESSION}/raw/${sha256}.png`]);
    assert.equal(sha256OfBytes(await store.read(staging.archiveKey)), sha256);
    await second.afterCommit?.();
    await assert.rejects(store.read(staging.archiveKey));
  } finally {
    cleanup();
  }
});

test("handleGroupSession returns conservative suggestions with evidence and never touches business tables", async () => {
  const { store, cleanup } = makeStore();
  try {
    const sameBeadA = await renderPng(beadSceneSvg("#3cb371"));
    const sameBeadB = await renderPng(beadSceneSvg("#3cb371"));
    const otherBead = await renderPng(beadSceneSvg("#8a2be2"));

    const files = [];
    let index = 0;
    for (const bytes of [sameBeadA, sameBeadB, otherBead]) {
      index += 1;
      const sha256 = sha256OfBytes(bytes);
      const archiveKey = await store
        .putOriginal({ sessionId: SESSION, bytes, sha256, extension: "png" })
        .then((result) => result.archiveKey);
      files.push({
        ...GROUP_SESSION_FILE_BASE,
        fileId: `file-${index}`,
        clientFileId: `cf-${index}`,
        relativePath: `imports/burst-${index}/bead.jpg`,
        sha256,
        archiveKey,
        byteSize: bytes.byteLength,
        lastModifiedMs: 1_750_000_000_000 + index * 1_000
      });
    }
    // A different stem keeps the distinct bead out of the same-stem pairing
    // stage; only exact duplicates and visual similarity may merge it.
    files[2]!.relativePath = "imports/other/pendant.jpg";

    const result = await handleGroupSession(store, { files });

    assert.equal(result.kind, "GROUP_SESSION");
    assert.ok(result.groups.length >= 2, "identical frames and the different bead must not merge");
    const merged = result.groups.find((group) => group.memberFileIds.length === 2);
    assert.ok(merged, "the two identical frames form one suggestion");
    assert.deepEqual(merged!.memberFileIds.sort(), ["file-1", "file-2"]);
    assert.ok(merged!.similarityEvidence, "suggestions carry similarity evidence");
    const single = result.groups.find((group) => group.memberFileIds.length === 1);
    assert.ok(single, "the different bead stays its own suggestion");
  } finally {
    cleanup();
  }
});

test("handleProcessGroup produces a MAIN output with QC evidence and lands both variants in the archive", async () => {
  const { store, cleanup } = makeStore();
  try {
    const bytes = await renderPng(beadSceneSvg("#20b2aa"));
    const sha256 = sha256OfBytes(bytes);
    const archiveKey = (
      await store.putOriginal({ sessionId: SESSION, bytes, sha256, extension: "png" })
    ).archiveKey;

    const result = await handleProcessGroup(store, {
      ...PROCESS_GROUP_PAYLOAD_BASE,
      primaryFileId: "file-1",
      files: [{ fileId: "file-1", archiveKey, sha256 }]
    });

    assert.equal(result.kind, "PROCESS_GROUP");
    assert.ok(result.kind === "PROCESS_GROUP");
    assert.equal(result.output.purpose, "MAIN");
    assert.equal(result.output.outputContentType, "image/webp");
    assert.equal(result.output.widthPx, 512);
    assert.equal(result.output.heightPx, 512);
    assert.equal(result.output.sourceFileId, "file-1");
    assert.equal(result.output.storageKey, PROCESS_GROUP_OUTPUT_KEY);
    assert.equal(result.output.processorVersion, "faithful-v1");
    assert.ok(Array.isArray(result.qc.checks));
    assert.equal(typeof result.qc.passed, "boolean");

    const mainBytes = await store.verifiedRead(
      result.output.storageKey,
      result.output.outputSha256
    );
    const mainMetadata = await sharp(mainBytes).metadata();
    assert.equal(mainMetadata.format, "webp");
    assert.equal(mainMetadata.width, 512);

    const thumbKey = result.output.storageKey.replace("bead-512.webp", "thumb-256.webp");
    const thumbBytes = await store.read(thumbKey);
    const thumbMetadata = await sharp(thumbBytes).metadata();
    assert.equal(thumbMetadata.format, "webp");
    assert.equal(thumbMetadata.width, 256);
  } finally {
    cleanup();
  }
});

test("handleProcessGroup maps bounded reprocess settings into deterministic processor options", async () => {
  const { store, cleanup } = makeStore();
  try {
    const bytes = await renderPng(beadSceneSvg("#20b2aa"));
    const sha256 = sha256OfBytes(bytes);
    const archiveKey = (
      await store.putOriginal({ sessionId: SESSION, bytes, sha256, extension: "png" })
    ).archiveKey;

    const result = await handleProcessGroup(store, {
      ...PROCESS_GROUP_PAYLOAD_BASE,
      primaryFileId: "file-1",
      files: [{ fileId: "file-1", archiveKey, sha256 }],
      settings: { maskThreshold: 0.25, edgeFeatherPx: 0 }
    });
    const options = (result.output.parameters as { options: Record<string, unknown> }).options;

    assert.equal(options.backgroundTolerance, 15);
    assert.equal(options.maskFeatherSigma, 0);
  } finally {
    cleanup();
  }
});

test("handleProcessGroup is idempotent across restarts: an existing verified output is reused", async () => {
  const { store, cleanup } = makeStore();
  try {
    const bytes = await renderPng(beadSceneSvg("#ff7f50"));
    const sha256 = sha256OfBytes(bytes);
    const archiveKey = (
      await store.putOriginal({ sessionId: SESSION, bytes, sha256, extension: "png" })
    ).archiveKey;
    const payload = {
      ...PROCESS_GROUP_PAYLOAD_BASE,
      primaryFileId: "file-1",
      files: [{ fileId: "file-1", archiveKey, sha256 }]
    };

    const first = await handleProcessGroup(store, payload);
    assert.ok(first.kind === "PROCESS_GROUP");
    const second = await handleProcessGroup(store, payload);
    assert.ok(second.kind === "PROCESS_GROUP");
    assert.equal(second.output.outputSha256, first.output.outputSha256);
    assert.equal(second.output.storageKey, first.output.storageKey);
    assert.equal(second.output.byteSize, first.output.byteSize);
  } finally {
    cleanup();
  }
});

test("handleProcessGroup refuses an ARW-only group without retrying", async () => {
  const { store, cleanup } = makeStore();
  try {
    const arwHeader = new Uint8Array(512);
    arwHeader.set([0x49, 0x49, 0x2a, 0x00], 0);
    const sha256 = sha256OfBytes(arwHeader);
    const archiveKey = (
      await store.putOriginal({ sessionId: SESSION, bytes: arwHeader, sha256, extension: "arw" })
    ).archiveKey;

    await assert.rejects(
      handleProcessGroup(store, {
        ...PROCESS_GROUP_PAYLOAD_BASE,
        files: [{ fileId: "file-1", archiveKey, sha256 }]
      }),
      (error: unknown) => {
        assert.ok(error instanceof JobExecutionError);
        assert.equal(error.code, "UNSUPPORTED_SOURCE_KIND");
        assert.equal(error.retryable, false);
        return true;
      }
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Round 5 F: PROCESS_GROUP obeys the human-confirmed primary, never array
// order, and the primary's actual content must match its declared kind.
// ---------------------------------------------------------------------------

test("handleProcessGroup obeys the confirmed primary, not the files order", async () => {
  const { store, cleanup } = makeStore();
  try {
    const bytesA = await renderPng(beadSceneSvg("#20b2aa"));
    const bytesB = await renderPng(beadSceneSvg("#ff69b4"));
    const shaA = sha256OfBytes(bytesA);
    const shaB = sha256OfBytes(bytesB);
    const keyA = (
      await store.putOriginal({ sessionId: SESSION, bytes: bytesA, sha256: shaA, extension: "png" })
    ).archiveKey;
    const keyB = (
      await store.putOriginal({ sessionId: SESSION, bytes: bytesB, sha256: shaB, extension: "png" })
    ).archiveKey;
    const fileA = { fileId: "file-a", archiveKey: keyA, sha256: shaA };
    const fileB = { fileId: "file-b", archiveKey: keyB, sha256: shaB };

    // The human confirmed file-b as the primary: both orderings must process
    // exactly that file and land byte-identical outputs.
    const forward = await handleProcessGroup(store, {
      ...PROCESS_GROUP_PAYLOAD_BASE,
      primaryFileId: "file-b",
      files: [fileA, fileB]
    });
    const reversed = await handleProcessGroup(store, {
      ...PROCESS_GROUP_PAYLOAD_BASE,
      primaryFileId: "file-b",
      files: [fileB, fileA]
    });

    assert.ok(forward.kind === "PROCESS_GROUP" && reversed.kind === "PROCESS_GROUP");
    assert.equal(forward.output.sourceFileId, "file-b");
    assert.equal(reversed.output.sourceFileId, "file-b", "reversing the files array must not move the source");
    assert.equal(forward.output.outputSha256, reversed.output.outputSha256);
    assert.equal(forward.output.storageKey, reversed.output.storageKey);
  } finally {
    cleanup();
  }
});

test("handleProcessGroup re-checks the primary's actual content against its raw key", async () => {
  const { store, cleanup } = makeStore();
  try {
    // A real PNG archived under a .jpg raw key: the payload is structurally
    // consistent (digest matches the key), but the content disagrees.
    const pngBytes = await renderPng(beadSceneSvg("#9370db"));
    const sha256 = sha256OfBytes(pngBytes);
    const archiveKey = (
      await store.putOriginal({ sessionId: SESSION, bytes: pngBytes, sha256, extension: "jpg" })
    ).archiveKey;

    await assert.rejects(
      handleProcessGroup(store, {
        ...PROCESS_GROUP_PAYLOAD_BASE,
        primaryFileId: "file-1",
        files: [{ fileId: "file-1", archiveKey, sha256 }]
      }),
      (error: unknown) => {
        assert.ok(error instanceof JobExecutionError);
        assert.equal(error.code, "CONTENT_KIND_MISMATCH");
        assert.equal(error.retryable, false);
        return true;
      }
    );
    // No processed output may land for a mismatched primary.
    assert.equal(
      (await store.listSessionFiles(SESSION)).filter((key) => key.includes("/processed/")).length,
      0
    );
  } finally {
    cleanup();
  }
});

test("handleGroupSession suggests a raster-first primary and omits it for ARW-only groups", async () => {
  const { store, cleanup } = makeStore();
  try {
    // Two identical structurally valid Sony ARWs form an exact-duplicate
    // group (ARW-only). Sharp cannot decode ARW sensor data, so the ARW
    // candidates legitimately carry no visual features.
    const arwBytes = minimalSonyArw();
    const arwSha = sha256OfBytes(arwBytes);
    const arwKey = (
      await store.putOriginal({ sessionId: SESSION, bytes: arwBytes, sha256: arwSha, extension: "arw" })
    ).archiveKey;
    // Two identical raster bytes form another duplicate group.
    const rasterBytes = await renderPng(beadSceneSvg("#3cb371"));
    const rasterSha = sha256OfBytes(rasterBytes);
    const rasterKey = (
      await store.putOriginal({ sessionId: SESSION, bytes: rasterBytes, sha256: rasterSha, extension: "png" })
    ).archiveKey;

    const arwFile = (fileId: string, relativePath: string) => ({
      ...GROUP_SESSION_FILE_BASE,
      kind: "ARW" as const,
      fileId,
      clientFileId: `cf-${fileId}`,
      relativePath,
      sha256: arwSha,
      archiveKey: arwKey,
      byteSize: arwBytes.byteLength,
      lastModifiedMs: 1_750_000_000_000
    });
    const rasterFile = (fileId: string, relativePath: string) => ({
      ...GROUP_SESSION_FILE_BASE,
      kind: "PNG" as const,
      fileId,
      clientFileId: `cf-${fileId}`,
      relativePath,
      sha256: rasterSha,
      archiveKey: rasterKey,
      byteSize: rasterBytes.byteLength,
      lastModifiedMs: 1_750_000_000_001
    });

    const result = await handleGroupSession(store, {
      files: [
        arwFile("file-arw-1", "dir/SHOT.ARW"),
        arwFile("file-arw-2", "dir/SHOT-copy.ARW"),
        rasterFile("file-raster-2", "dir/bead-2.png"),
        rasterFile("file-raster-1", "dir/bead-1.png")
      ]
    });

    assert.equal(result.kind, "GROUP_SESSION");
    const arwGroup = result.groups.find((group) => group.memberFileIds.includes("file-arw-1"));
    assert.ok(arwGroup, "the identical ARWs form a duplicate group");
    assert.equal(arwGroup!.memberFileIds.length, 2);
    assert.equal(
      arwGroup!.primaryFileId,
      undefined,
      "an ARW-only group offers no primary suggestion — the human picks or skips"
    );
    const rasterGroup = result.groups.find((group) => group.memberFileIds.includes("file-raster-1"));
    assert.ok(rasterGroup, "the identical rasters form a duplicate group");
    assert.equal(
      rasterGroup!.primaryFileId,
      "file-raster-1",
      "the suggested primary is the deterministic first raster member"
    );
  } finally {
    cleanup();
  }
});

test("classifyHandlerError separates transient storage failures from deterministic ones", () => {
  const deterministic = new JobExecutionError("DECODE_FAILED", "boom", false);
  const transient = new JobExecutionError("WRITE_FAILED", "disk hiccup", true);
  const unknown = new Error("anything else");

  assert.equal(classifyHandlerError(deterministic).retryable, false);
  assert.equal(classifyHandlerError(transient).retryable, true);
  assert.equal(classifyHandlerError(unknown).retryable, true);
});

// ---------------------------------------------------------------------------
// Round 5: the worker's centralized error-code table. Every code the worker
// can submit has exactly one retryability class, and store/processor errors
// map onto stable codes that never depend on exception text.
// ---------------------------------------------------------------------------

test("every worker error code has exactly one retryability class", () => {
  assert.ok(WORKER_ERROR_CODES.length > 0);
  for (const code of WORKER_ERROR_CODES) {
    const retryable = isRetryableWorkerErrorCode(code);
    // A code must be classified by the table, and classifyHandlerError must
    // agree with the table for a representative error of that code.
    const classified = classifyHandlerError(new JobExecutionError(code, "representative", retryable));
    assert.equal(classified.retryable, retryable, `code ${code} must keep its table class`);
    assert.equal(classified.code, code);
  }
});

test("archive store failures map onto stable worker error codes", () => {
  // A verified read that hashes differently is tampering/corruption evidence.
  const verification = new ArchiveStoreError(
    "HASH_MISMATCH",
    "Stored content of imports/s/raw/x.png does not match the expected SHA-256"
  );
  assert.deepEqual(pickCode(wrapArchiveError(verification, "X")), {
    code: "ARCHIVE_VERIFICATION_FAILED",
    retryable: false
  });

  // A key that already holds different content can never succeed on retry.
  const conflict = new ArchiveStoreError("KEY_EXISTS_CONTENT_MISMATCH", "Archive key already holds different content");
  assert.deepEqual(pickCode(wrapArchiveError(conflict, "X")), { code: "ARCHIVE_CONFLICT", retryable: false });

  // A malformed key is a payload contract violation.
  const malformed = new ArchiveStoreError("KEY_INVALID", "Only staging keys ... can be removed");
  assert.deepEqual(pickCode(wrapArchiveError(malformed, "X")), { code: "PAYLOAD_INVALID", retryable: false });

  // ENOSPC is an operator-actionable storage-full condition, still retryable.
  const full = new ArchiveStoreError("WRITE_FAILED", "Failed to archive", {
    cause: Object.assign(new Error("no space left on device"), { code: "ENOSPC" })
  });
  assert.deepEqual(pickCode(wrapArchiveError(full, "X")), { code: "STORAGE_FULL", retryable: true });

  // Other write failures stay transient archive failures.
  const write = new ArchiveStoreError("WRITE_FAILED", "Failed to archive");
  assert.deepEqual(pickCode(wrapArchiveError(write, "X")), { code: "ARCHIVE_WRITE_FAILED", retryable: true });
});

function pickCode(error: JobExecutionError): { code: string; retryable: boolean } {
  assert.ok(error instanceof JobExecutionError);
  return { code: error.code, retryable: error.retryable };
}
