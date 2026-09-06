import assert from "node:assert/strict";
import test from "node:test";

import type { ArchiveStore } from "@mystcrag/asset-pipeline";
import type { ClaimedAssetJob } from "@mystcrag/database";

import {
  createJobHandlers,
  JobExecutionError,
  type JobRunContext
} from "../src/jobs.js";

const SESSION = "session-payload-isolation";
const FOREIGN_SESSION = "session-attacker";
const UUID = "00000000-0000-4000-8000-000000000001";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const PROCESS_GROUP_PAYLOAD_BASE = {
  groupId: "group-1",
  processingVersion: 1,
  outputStorageKey: `imports/${SESSION}/processed/group-1/v1/bead-512.webp`
};

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

/**
 * A lease context that never aborts: these tests isolate payload validation,
 * which must reject before the handler ever consults the lease guard.
 */
const NEVER_LOST: JobRunContext = {
  signal: new AbortController().signal,
  throwIfLeaseLost: () => {}
};

type SingleArgHandler = (job: ClaimedAssetJob) => Promise<{ result: unknown; afterCommit?: () => Promise<void> }>;

function makeHandlers(): Record<"ARCHIVE_FILE" | "GROUP_SESSION" | "PROCESS_GROUP", SingleArgHandler> {
  const handlers = createJobHandlers({ store: refusingStore(), repository: refusingRepository });
  return {
    ARCHIVE_FILE: (job) => handlers.ARCHIVE_FILE(job, NEVER_LOST),
    GROUP_SESSION: (job) => handlers.GROUP_SESSION(job, NEVER_LOST),
    PROCESS_GROUP: (job) => handlers.PROCESS_GROUP(job, NEVER_LOST)
  };
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
          payload: { ...PROCESS_GROUP_PAYLOAD_BASE, groupId: "group-evil", primaryFileId: "file-1", files }
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
          payload: { ...PROCESS_GROUP_PAYLOAD_BASE, primaryFileId: "file-1", files }
        })
      ),
    "job without a group id"
  );
});

test("PROCESS_GROUP accepts its exact reserved output key and bounded reprocess settings", async () => {
  const handlers = makeHandlers();
  const files = [{ fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`, sha256: SHA_A }];
  await assert.rejects(
    handlers.PROCESS_GROUP(
      job({
        jobType: "PROCESS_GROUP",
        groupId: "group-1",
        payload: {
          groupId: "group-1",
          processingVersion: 1,
          primaryFileId: "file-1",
          files,
          outputStorageKey: `imports/${SESSION}/processed/group-1/v1/bead-512.webp`,
          settings: { maskThreshold: 0.25, edgeFeatherPx: 0 }
        }
      })
    ),
    /VERIFIED_READ_WAS_CALLED/,
    "a valid database-owned payload must reach the first storage read"
  );
});

test("PROCESS_GROUP rejects every non-canonical reserved output key before storage access", async () => {
  const handlers = makeHandlers();
  const files = [{ fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`, sha256: SHA_A }];
  const invalidKeys = [
    `imports/${FOREIGN_SESSION}/processed/group-1/v1/bead-512.webp`,
    `imports/${SESSION}/processed/group-2/v1/bead-512.webp`,
    `imports/${SESSION}/processed/group-1/v2/bead-512.webp`,
    `imports/${SESSION}/processed/group-1/v1/thumb-256.webp`,
    `imports/${SESSION}/processed/group-1/v1/../bead-512.webp`
  ];

  for (const outputStorageKey of invalidKeys) {
    await assertRejectedBeforeStoreAccess(
      () => handlers.PROCESS_GROUP(
        job({
          jobType: "PROCESS_GROUP",
          groupId: "group-1",
          payload: {
            ...PROCESS_GROUP_PAYLOAD_BASE,
            primaryFileId: "file-1",
            files,
            outputStorageKey
          }
        })
      ),
      `PROCESS_GROUP reserved output key ${outputStorageKey}`
    );
  }
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
            payload: { ...PROCESS_GROUP_PAYLOAD_BASE, primaryFileId: "file-1", files: [goodFile, evilFile] }
          })
        ),
      `PROCESS_GROUP archive key ${archiveKey}`
    );
  }
});

function rawKeyFile(overrides: {
  fileId?: string;
  sha256?: string;
  extension?: string;
  kind?: "ARW" | "JPEG" | "PNG" | "WEBP";
} = {}) {
  const fileId = overrides.fileId ?? "file-1";
  const sha256 = overrides.sha256 ?? SHA_A;
  const extension = overrides.extension ?? "jpg";
  const kind = overrides.kind ?? "JPEG";
  return {
    fileId,
    clientFileId: `cf-${fileId}`,
    relativePath: `dir/bead-${fileId}.${extension}`,
    sha256,
    archiveKey: `imports/${SESSION}/raw/${sha256}.${extension}`,
    byteSize: 10,
    lastModifiedMs: 1,
    kind
  };
}

test("GROUP_SESSION rejects an archive key whose digest contradicts the file's SHA-256", async () => {
  const handlers = makeHandlers();
  const file = rawKeyFile({ sha256: SHA_A, extension: "jpg" });
  file.archiveKey = `imports/${SESSION}/raw/${SHA_B}.jpg`;

  await assertRejectedBeforeStoreAccess(
    () => handlers.GROUP_SESSION(job({ jobType: "GROUP_SESSION", payload: { files: [file] } })),
    "GROUP_SESSION digest mismatch"
  );
});

test("GROUP_SESSION rejects a .png archive key masquerading as an ARW original", async () => {
  const handlers = makeHandlers();
  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.GROUP_SESSION(
        job({
          jobType: "GROUP_SESSION",
          payload: { files: [rawKeyFile({ extension: "png", kind: "ARW" })] }
        })
      ),
    "GROUP_SESSION .png key on an ARW kind"
  );
  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.GROUP_SESSION(
        job({
          jobType: "GROUP_SESSION",
          payload: { files: [rawKeyFile({ extension: "arw", kind: "JPEG" })] }
        })
      ),
    "GROUP_SESSION .arw key on a JPEG kind"
  );
});

test("GROUP_SESSION validates the digest of every file, not only the first", async () => {
  const handlers = makeHandlers();
  const files = [
    rawKeyFile({ fileId: "file-1", extension: "jpg" }),
    rawKeyFile({ fileId: "file-2", sha256: SHA_A, extension: "jpg" })
  ];
  // The second file claims SHA_A but its key embeds SHA_B.
  files[1]!.archiveKey = `imports/${SESSION}/raw/${SHA_B}.jpg`;

  await assertRejectedBeforeStoreAccess(
    () => handlers.GROUP_SESSION(job({ jobType: "GROUP_SESSION", payload: { files } })),
    "GROUP_SESSION second file digest mismatch"
  );
});

test("PROCESS_GROUP rejects an archive key whose digest contradicts the entry's SHA-256", async () => {
  const handlers = makeHandlers();
  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.PROCESS_GROUP(
        job({
          jobType: "PROCESS_GROUP",
          groupId: "group-1",
          payload: {
            ...PROCESS_GROUP_PAYLOAD_BASE,
            primaryFileId: "file-1",
            files: [{ fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_B}.jpg`, sha256: SHA_A }]
          }
        })
      ),
    "PROCESS_GROUP digest mismatch"
  );
});

test("GROUP_SESSION accepts a consistent .jpeg key for a JPEG file and reaches the store", async () => {
  const handlers = makeHandlers();
  // Validation passing is proven by the refusal store being reached: the
  // handler must call verifiedRead for a fully consistent payload.
  await assert.rejects(
    handlers.GROUP_SESSION(
      job({
        jobType: "GROUP_SESSION",
        payload: { files: [rawKeyFile({ extension: "jpeg", kind: "JPEG" })] }
      })
    ),
    /VERIFIED_READ_WAS_CALLED/,
    "a consistent .jpeg key must pass validation and reach verifiedRead"
  );
});

// ---------------------------------------------------------------------------
// Round 5: deep payload validation — shared 500-file limit, identity and key
// uniqueness, safe-integer ranges, normalized paths, and digest/kind
// consistency, all rejected before any store access.
// ---------------------------------------------------------------------------

function distinctSha(index: number): string {
  return index.toString(16).padStart(64, "0");
}

test("GROUP_SESSION rejects more than the shared 500-file limit before any store access", async () => {
  const handlers = makeHandlers();
  const files = Array.from({ length: 501 }, (_, index) =>
    rawKeyFile({ fileId: `file-${index}`, sha256: distinctSha(index) })
  );
  await assertRejectedBeforeStoreAccess(
    () => handlers.GROUP_SESSION(job({ jobType: "GROUP_SESSION", payload: { files } })),
    "GROUP_SESSION over the shared 500-file limit"
  );
});

test("GROUP_SESSION accepts exactly the shared 500-file limit and reaches the store", async () => {
  const handlers = makeHandlers();
  const files = Array.from({ length: 500 }, (_, index) =>
    rawKeyFile({ fileId: `file-${index}`, sha256: distinctSha(index) })
  );
  await assert.rejects(
    handlers.GROUP_SESSION(job({ jobType: "GROUP_SESSION", payload: { files } })),
    /VERIFIED_READ_WAS_CALLED/,
    "exactly 500 files must pass the limit and reach the store"
  );
});

test("PROCESS_GROUP rejects more than the shared 500-file limit before any store access", async () => {
  const handlers = makeHandlers();
  const files = Array.from({ length: 501 }, (_, index) => ({
    fileId: `file-${index}`,
    archiveKey: `imports/${SESSION}/raw/${distinctSha(index)}.jpg`,
    sha256: distinctSha(index)
  }));
  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.PROCESS_GROUP(
        job({
          jobType: "PROCESS_GROUP",
          groupId: "group-1",
          payload: { ...PROCESS_GROUP_PAYLOAD_BASE, primaryFileId: "file-0", files }
        })
      ),
    "PROCESS_GROUP over the shared 500-file limit"
  );
});

test("GROUP_SESSION rejects duplicate fileId, clientFileId and relativePath", async () => {
  const handlers = makeHandlers();
  const duplicates: Array<{
    description: string;
    mutate: (second: Record<string, unknown>) => void;
  }> = [
    {
      description: "duplicate fileId",
      mutate: (second) => {
        second.fileId = "file-1";
      }
    },
    {
      description: "duplicate clientFileId",
      mutate: (second) => {
        second.clientFileId = "cf-file-1";
      }
    },
    {
      description: "duplicate relativePath",
      mutate: (second) => {
        second.relativePath = "dir/bead-file-1.jpg";
      }
    }
  ];
  for (const { description, mutate } of duplicates) {
    const second = rawKeyFile({ fileId: "file-2", sha256: SHA_B }) as unknown as Record<string, unknown>;
    mutate(second);
    await assertRejectedBeforeStoreAccess(
      () =>
        handlers.GROUP_SESSION(
          job({ jobType: "GROUP_SESSION", payload: { files: [rawKeyFile(), second] } })
        ),
      `GROUP_SESSION ${description}`
    );
  }
});

test("GROUP_SESSION accepts content-addressed duplicates that share one archive key", async () => {
  const handlers = makeHandlers();
  // Two distinct identities pointing at the same raw key is the normal shape
  // of an exact-duplicate upload: content-addressed keys collapse, identities
  // do not. The payload must reach the store, not be rejected as a duplicate.
  const first = rawKeyFile({ fileId: "file-1", sha256: SHA_A });
  const second = rawKeyFile({ fileId: "file-2", sha256: SHA_A });
  await assert.rejects(
    handlers.GROUP_SESSION(job({ jobType: "GROUP_SESSION", payload: { files: [first, second] } })),
    /VERIFIED_READ_WAS_CALLED/,
    "content-addressed duplicates must pass validation and reach the store"
  );
});

test("PROCESS_GROUP rejects a duplicate fileId but accepts content-addressed duplicates", async () => {
  const handlers = makeHandlers();
  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.PROCESS_GROUP(
        job({
          jobType: "PROCESS_GROUP",
          groupId: "group-1",
          payload: {
            ...PROCESS_GROUP_PAYLOAD_BASE,
            primaryFileId: "file-1",
            files: [
              { fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`, sha256: SHA_A },
              { fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_B}.jpg`, sha256: SHA_B }
            ]
          }
        })
      ),
    "PROCESS_GROUP duplicate fileId"
  );
  await assert.rejects(
    handlers.PROCESS_GROUP(
      job({
        jobType: "PROCESS_GROUP",
        groupId: "group-1",
        payload: {
          ...PROCESS_GROUP_PAYLOAD_BASE,
          primaryFileId: "file-1",
          files: [
            { fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`, sha256: SHA_A },
            { fileId: "file-2", archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`, sha256: SHA_A }
          ]
        }
      })
    ),
    /VERIFIED_READ_WAS_CALLED/,
    "content-addressed duplicates in one group must reach the store"
  );
});

// ---------------------------------------------------------------------------
// Round 5 F: PROCESS_GROUP must obey a human-confirmed primaryFileId. Array
// order may never pick the processed source, and the primary must be a
// decodable raster member of the group.
// ---------------------------------------------------------------------------

test("PROCESS_GROUP without a primaryFileId over a group holding a raster is rejected before the store", async () => {
  const handlers = makeHandlers();
  const files = [
    { fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`, sha256: SHA_A },
    { fileId: "file-arw", archiveKey: `imports/${SESSION}/raw/${SHA_B}.arw`, sha256: SHA_B }
  ];
  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.PROCESS_GROUP(
        job({ jobType: "PROCESS_GROUP", groupId: "group-1", payload: { ...PROCESS_GROUP_PAYLOAD_BASE, files } })
      ),
    "PROCESS_GROUP without a primary over a raster group — array order must never pick the source"
  );
});

test("PROCESS_GROUP rejects a primaryFileId that is not a member of the group", async () => {
  const handlers = makeHandlers();
  const files = [{ fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`, sha256: SHA_A }];
  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.PROCESS_GROUP(
        job({
          jobType: "PROCESS_GROUP",
          groupId: "group-1",
          payload: { ...PROCESS_GROUP_PAYLOAD_BASE, primaryFileId: "file-elsewhere", files }
        })
      ),
    "PROCESS_GROUP primaryFileId outside the member set"
  );
});

test("PROCESS_GROUP rejects a primaryFileId that points at an ARW original", async () => {
  const handlers = makeHandlers();
  const files = [
    { fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`, sha256: SHA_A },
    { fileId: "file-arw", archiveKey: `imports/${SESSION}/raw/${SHA_B}.arw`, sha256: SHA_B }
  ];
  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.PROCESS_GROUP(
        job({
          jobType: "PROCESS_GROUP",
          groupId: "group-1",
          payload: { ...PROCESS_GROUP_PAYLOAD_BASE, primaryFileId: "file-arw", files }
        })
      ),
    "PROCESS_GROUP primaryFileId pointing at an ARW original"
  );
});

test("an ARW-only group without a primaryFileId is structurally legal and fails deterministically before the store", async () => {
  const handlers = makeHandlers();
  await assert.rejects(
    handlers.PROCESS_GROUP(
      job({
        jobType: "PROCESS_GROUP",
        groupId: "group-1",
        payload: {
          ...PROCESS_GROUP_PAYLOAD_BASE,
          files: [{ fileId: "file-arw", archiveKey: `imports/${SESSION}/raw/${SHA_B}.arw`, sha256: SHA_B }]
        }
      })
    ),
    (error: unknown) => {
      // The worker never guesses a primary from file order: an ARW-only group
      // has nothing to process and no file is ever read.
      assert.ok(error instanceof JobExecutionError);
      assert.equal(error.code, "UNSUPPORTED_SOURCE_KIND");
      assert.equal(error.retryable, false);
      assert.ok(!error.message.includes("WAS_CALLED"), "no store method may run");
      return true;
    },
    "an ARW-only group fails deterministically without touching the store"
  );
});

test("GROUP_SESSION rejects byteSize and lastModifiedMs outside safe integer ranges", async () => {
  const handlers = makeHandlers();
  const invalidNumbers: Array<{ field: "byteSize" | "lastModifiedMs"; value: number }> = [
    { field: "byteSize", value: 0 },
    { field: "byteSize", value: -1 },
    { field: "byteSize", value: 1.5 },
    { field: "byteSize", value: 1e21 },
    { field: "lastModifiedMs", value: 0 },
    { field: "lastModifiedMs", value: -1 },
    { field: "lastModifiedMs", value: 1.5 },
    { field: "lastModifiedMs", value: 1e21 }
  ];
  for (const { field, value } of invalidNumbers) {
    const file = rawKeyFile() as Record<string, unknown>;
    file[field] = value;
    await assertRejectedBeforeStoreAccess(
      () => handlers.GROUP_SESSION(job({ jobType: "GROUP_SESSION", payload: { files: [file] } })),
      `GROUP_SESSION ${field}=${value}`
    );
  }
});

test("GROUP_SESSION rejects relativePath values that are not shared-normalized paths", async () => {
  const handlers = makeHandlers();
  const nonNormalized = ["./x.jpg", "a/../b.jpg", "a//b.jpg", "a\\b.jpg", "/abs.jpg", " dir/x.jpg "];
  for (const relativePath of nonNormalized) {
    const file = rawKeyFile() as Record<string, unknown>;
    file.relativePath = relativePath;
    await assertRejectedBeforeStoreAccess(
      () => handlers.GROUP_SESSION(job({ jobType: "GROUP_SESSION", payload: { files: [file] } })),
      `GROUP_SESSION relativePath ${JSON.stringify(relativePath)}`
    );
  }
});

test("GROUP_SESSION rejects the same SHA-256 declared under two different kinds", async () => {
  const handlers = makeHandlers();
  const files = [
    rawKeyFile({ fileId: "file-1", sha256: SHA_A, extension: "jpg", kind: "JPEG" }),
    rawKeyFile({ fileId: "file-2", sha256: SHA_A, extension: "arw", kind: "ARW" })
  ];
  await assertRejectedBeforeStoreAccess(
    () => handlers.GROUP_SESSION(job({ jobType: "GROUP_SESSION", payload: { files } })),
    "GROUP_SESSION same digest under two kinds"
  );
});

test("job payload identifiers and archive keys are never silently trimmed", async () => {
  const handlers = makeHandlers();
  const groupFile = rawKeyFile() as Record<string, unknown>;
  groupFile.fileId = " file-1 ";
  await assertRejectedBeforeStoreAccess(
    () => handlers.GROUP_SESSION(job({ jobType: "GROUP_SESSION", payload: { files: [groupFile] } })),
    "GROUP_SESSION whitespace-padded fileId"
  );

  await assertRejectedBeforeStoreAccess(
    () =>
      handlers.ARCHIVE_FILE(
        job({
          jobType: "ARCHIVE_FILE",
          payload: { fileId: "file-1", stagingKey: ` ${`imports/${SESSION}/staging/${UUID}`} `, sha256: SHA_A }
        })
      ),
    "ARCHIVE_FILE whitespace-padded staging key"
  );
});

test("PROCESS_GROUP rejects an unsafe processingVersion before store access", async () => {
  const handlers = makeHandlers();
  const files = [
    { fileId: "file-1", archiveKey: `imports/${SESSION}/raw/${SHA_A}.jpg`, sha256: SHA_A }
  ];
  for (const processingVersion of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assertRejectedBeforeStoreAccess(
      () =>
        handlers.PROCESS_GROUP(
          job({
            jobType: "PROCESS_GROUP",
            groupId: "group-1",
            payload: { ...PROCESS_GROUP_PAYLOAD_BASE, processingVersion, primaryFileId: "file-1", files }
          })
        ),
      `PROCESS_GROUP processingVersion=${processingVersion}`
    );
  }
});
