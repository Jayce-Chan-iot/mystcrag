import assert from "node:assert/strict";
import test from "node:test";

import type { ArchiveStore } from "@mystcrag/asset-pipeline";
import type { ClaimedAssetJob } from "@mystcrag/database";

import { createJobHandlers, JobExecutionError, type JobHandlers } from "../src/jobs.js";

const SESSION = "session-payload-isolation";
const FOREIGN_SESSION = "session-attacker";
const UUID = "00000000-0000-4000-8000-000000000001";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

/**
 * A store that fails loudly on every interaction. Every malicious payload
 * below must be rejected by payload validation BEFORE any store method runs;
 * if a store call happens the distinctive `*_WAS_CALLED` error surfaces and
 * the assertion fails, proving the rejection came too late.
 */
function refusingStore(): ArchiveStore {
  const refuse = (method: string): never => {
    throw new Error(`${method}_WAS_CALLED`);
  };
  return {
    root: "/refusing-store",
    putOriginal: () => refuse("PUT_ORIGINAL"),
    putProcessed: () => refuse("PUT_PROCESSED"),
    putStaging: () => refuse("PUT_STAGING"),
    read: () => refuse("READ"),
    removeStaging: () => refuse("REMOVE_STAGING"),
    verifiedRead: () => refuse("VERIFIED_READ"),
    listSessionFiles: () => refuse("LIST_SESSION_FILES")
  } as unknown as ArchiveStore;
}

const refusingRepository = {
  recordUploadedFile: () => {
    throw new Error("RECORD_UPLOADED_FILE_WAS_CALLED");
  }
};

function makeHandlers(): JobHandlers {
  return createJobHandlers({ store: refusingStore(), repository: refusingRepository });
}

function job(overrides: Partial<ClaimedAssetJob> = {}): ClaimedAssetJob {
  return {
    jobId: "job-1",
    sessionId: SESSION,
    groupId: null,
    jobType: "GROUP_SESSION",
    state: "RUNNING",
    payload: {},
    retryCount: 0,
    maxRetries: 3,
    lease: { workerId: "worker-isolation", leaseToken: "token-1" },
    leaseUntil: new Date(Date.now() + 60_000),
    ...overrides
  };
}

async function assertRejectedBeforeStoreAccess(
  run: () => Promise<unknown>,
  description: string
): Promise<void> {
  await assert.rejects(
    run(),
    (error: unknown) => {
      assert.ok(
        error instanceof JobExecutionError,
        `${description}: expected a JobExecutionError, got ${String(error)}`
      );
      assert.equal(error.code, "PAYLOAD_INVALID", description);
      assert.equal(error.retryable, false, description);
      return true;
    },
    description
  );
}

test("ARCHIVE_FILE rejects staging keys that are not exact imports/<sessionId>/staging/<uuid> keys", async () => {
  const handlers = makeHandlers();
  const malformedStagingKeys = [
    `imports/${SESSION}/raw/${SHA_A}.png`,
    `imports/${SESSION}/staging`,
    `imports/${SESSION}/staging/`,
    `imports/${SESSION}/staging/not-a-uuid`,
    `imports/${SESSION}/staging/${UUID}/extra`,
    `imports/${SESSION}/tmp/${UUID}`,
    UUID,
    `uploads/${SESSION}/staging/${UUID}`
  ];
  for (const stagingKey of malformedStagingKeys) {
    await assertRejectedBeforeStoreAccess(
      () =>
        handlers.ARCHIVE_FILE(
          job({
            jobType: "ARCHIVE_FILE",
            payload: { fileId: "file-1", stagingKey, sha256: SHA_A }
          })
        ),
      `staging key ${stagingKey}`
    );
  }
});

test("ARCHIVE_FILE rejects a structurally valid staging key from another session", async () => {
  const handlers = makeHandlers();
  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.ARCHIVE_FILE(
        job({
          jobType: "ARCHIVE_FILE",
          payload: { fileId: "file-1", stagingKey: `imports/${FOREIGN_SESSION}/staging/${UUID}`, sha256: SHA_A }
        })
      ),
    "foreign-session staging key"
  );
});

test("GROUP_SESSION rejects any file whose archive key is not a raw key of the job's session", async () => {
  const handlers = makeHandlers();
  const validFile = {
    fileId: "file-1",
    clientFileId: "cf-1",
    relativePath: "dir/bead-1.jpg",
    sha256: SHA_A,
    archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`,
    byteSize: 10,
    lastModifiedMs: 1,
    kind: "JPEG" as const
  };
  const evilVariants = [
    `imports/${FOREIGN_SESSION}/raw/${SHA_B}.jpg`,
    `imports/${SESSION}/staging/${UUID}`,
    `imports/${SESSION}/processed/group-1/v1/bead-512.webp`,
    `uploads/${SESSION}/raw/${SHA_B}.jpg`
  ];
  for (const archiveKey of evilVariants) {
    const evilFile = {
      ...validFile,
      fileId: "file-2",
      clientFileId: "cf-2",
      relativePath: "dir/bead-2.jpg",
      sha256: SHA_B,
      archiveKey
    };
    await assertRejectedBeforeStoreAccess(
      () =>
        handlers.GROUP_SESSION(
          job({
            jobType: "GROUP_SESSION",
            payload: { files: [validFile, evilFile] }
          })
        ),
      `GROUP_SESSION archive key ${archiveKey}`
    );
  }
});

test("PROCESS_GROUP rejects a payload groupId that does not match the job's group", async () => {
  const handlers = makeHandlers();
  const files = [{ fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`, sha256: SHA_A }];
  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.PROCESS_GROUP(
        job({
          jobType: "PROCESS_GROUP",
          groupId: "group-1",
          payload: { groupId: "group-evil", processingVersion: 1, files }
        })
      ),
    "payload group differs from the job's group"
  );
  // A job without a group binding cannot process into any group.
  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.PROCESS_GROUP(
        job({
          jobType: "PROCESS_GROUP",
          groupId: null,
          payload: { groupId: "group-1", processingVersion: 1, files }
        })
      ),
    "job without a group id"
  );
});

test("PROCESS_GROUP rejects later file entries from another session or a non-raw area", async () => {
  const handlers = makeHandlers();
  const goodFile = { fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`, sha256: SHA_A };
  const evilVariants = [
    `imports/${FOREIGN_SESSION}/raw/${SHA_B}.png`,
    `imports/${SESSION}/staging/${UUID}`,
    `imports/${SESSION}/processed/group-1/v1/bead-512.webp`,
    `imports/${SESSION}/raw/${SHA_B}.txt`
  ];
  for (const archiveKey of evilVariants) {
    const evilFile = { fileId: "file-2", archiveKey, sha256: SHA_B };
    await assertRejectedBeforeStoreAccess(
      () =>
        handlers.PROCESS_GROUP(
          job({
            jobType: "PROCESS_GROUP",
            groupId: "group-1",
            payload: { groupId: "group-1", processingVersion: 1, files: [goodFile, evilFile] }
          })
        ),
      `PROCESS_GROUP archive key ${archiveKey}`
    );
  }
});
