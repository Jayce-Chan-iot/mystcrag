import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import sharp from "sharp";

import { ArchiveStore, sha256OfBytes } from "@mystcrag/asset-pipeline";
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
  JobExecutionError
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

function makeStore(): { store: ArchiveStore; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "asset-worker-jobs-"));
  const store = new ArchiveStore({ root, repositoryRoots: [] });
  return { store, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const SESSION = "session-jobs-test";

const ARCHIVE_FILE_PAYLOAD = {
  fileId: "file-1",
  stagingKey: `imports/${SESSION}/staging/00000000-0000-4000-8000-000000000001`,
  sha256: ""
} as { fileId: string; stagingKey: string; sha256: string };

const PROCESS_GROUP_PAYLOAD_BASE = {
  groupId: "group-1",
  processingVersion: 1,
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
  const recorded: Array<{ fileId: string; sha256: string; archiveKey: string }> = [];
  const repository = {
    recordUploadedFile: async (fileId: string, sha256: string, archiveKey: string) => {
      recorded.push({ fileId, sha256, archiveKey });
      return { fileId };
    }
  };
  try {
    const bytes = await renderPng(beadSceneSvg("#20b2aa"));
    const sha256 = sha256OfBytes(bytes);
    const staging = await store.putStaging({ sessionId: SESSION, bytes });
    const handlers = createJobHandlers({ store, repository });
    const job = archiveFileJob({ fileId: "file-1", stagingKey: staging.archiveKey, sha256 });

    const outcome = await handlers.ARCHIVE_FILE(job);

    // The handler archived the original and recorded the file row, but the
    // staging entry must survive until the runtime commits the result.
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.archiveKey, `imports/${SESSION}/raw/${sha256}.png`);
    assert.equal(sha256OfBytes(await store.read(staging.archiveKey)), sha256);

    assert.ok(outcome.afterCommit, "the composition provides the post-commit cleanup");
    await outcome.afterCommit!();
    await assert.rejects(store.read(staging.archiveKey));
  } finally {
    cleanup();
  }
});

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
    })), /database unavailable/);
    // The business write failed before any commit, so the recovery input stays.
    assert.equal(sha256OfBytes(await store.read(staging.archiveKey)), sha256);
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
    const first = await handlers.ARCHIVE_FILE(job);
    // Second attempt (reclaimed job) re-runs the same payload.
    const second = await handlers.ARCHIVE_FILE(job);

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
      files: [{ fileId: "file-1", archiveKey, sha256 }]
    });

    assert.equal(result.kind, "PROCESS_GROUP");
    assert.ok(result.kind === "PROCESS_GROUP");
    assert.equal(result.output.purpose, "MAIN");
    assert.equal(result.output.outputContentType, "image/webp");
    assert.equal(result.output.widthPx, 512);
    assert.equal(result.output.heightPx, 512);
    assert.equal(result.output.sourceFileId, "file-1");
    assert.match(result.output.storageKey, /\/bead-512\.webp$/);
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

test("classifyHandlerError separates transient storage failures from deterministic ones", () => {
  const deterministic = new JobExecutionError("DECODE_FAILED", "boom", false);
  const transient = new JobExecutionError("WRITE_FAILED", "disk hiccup", true);
  const unknown = new Error("anything else");

  assert.equal(classifyHandlerError(deterministic).retryable, false);
  assert.equal(classifyHandlerError(transient).retryable, true);
  assert.equal(classifyHandlerError(unknown).retryable, true);
});
