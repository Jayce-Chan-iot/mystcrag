import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { AssetImportApiError } from "./bead-asset-import.errors.js";
import {
  ASSET_UPLOAD_PROBE_MAX_BYTES,
  AssetImportApplicationService
} from "./bead-asset-import.service.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const SHA = "3c9f1a7352b5a97c630b34f40110f8a20b62f329a178a821602b8223d862a02f";

function repository(overrides: Record<string, unknown> = {}) {
  return {
    createSession: async () => ({
      sessionId: "session-1",
      state: "CREATED",
      createdAt: new Date("2026-09-06T00:00:00.000Z"),
      created: true
    }),
    getSession: async () => ({
      sessionId: "session-1",
      state: "UPLOADING",
      createdAt: new Date("2026-09-06T00:00:00.000Z"),
      updatedAt: new Date("2026-09-06T00:01:00.000Z"),
      lastVerifiedCheckpoint: null,
      declaredFileCount: 1,
      uploadedFileCount: 0,
      archivedFileCount: 0,
      failedFileCount: 0,
      skippedFileCount: 0,
      declaredBytes: 6,
      uploadedBytes: 0,
      files: [{
        fileId: "file-1",
        clientFileId: "client-1",
        relativePath: "batch/photo.jpg",
        kind: "JPEG",
        state: "UPLOADING",
        byteSize: 6,
        archiveKey: "imports/session-1/staging/private",
        storageProvider: "local",
        groupId: "private-group"
      }],
      groups: [],
      jobs: [{ jobId: "private-job" }]
    }),
    resolveUploadTarget: async () => ({
      sessionId: "session-1",
      fileId: "file-1",
      clientFileId: "client-1",
      relativePath: "batch/photo.jpg",
      kind: "JPEG",
      byteSize: 6,
      state: "UPLOADING",
      declaredSha256: null
    }),
    enqueueArchiveFile: async () => ({ jobId: "job-1", jobState: "QUEUED" }),
    failUploadReservation: async () => ({
      sessionId: "session-1",
      fileId: "file-1",
      state: "FAILED",
      changed: true
    }),
    ...overrides
  } as never;
}

test("session projection converts dates and omits storage and orchestration fields", async () => {
  const service = new AssetImportApplicationService({
    repository: repository(),
    archiveStore: {} as never
  });

  const result = await service.getSession("session-1");

  assert.equal(result.createdAt, "2026-09-06T00:00:00.000Z");
  assert.equal(result.updatedAt, "2026-09-06T00:01:00.000Z");
  assert.deepEqual(result.files[0], {
    fileId: "file-1",
    clientFileId: "client-1",
    relativePath: "batch/photo.jpg",
    kind: "JPEG",
    state: "UPLOADING",
    byteSize: 6
  });
  assert.equal("jobs" in result, false);
  assert.equal("skippedFileCount" in result, false);
});

test("stream upload probes bounded bytes, stages once, and queues archival without exposing its key", async () => {
  let received = Buffer.alloc(0);
  let enqueued: unknown;
  const service = new AssetImportApplicationService({
    repository: repository({
      enqueueArchiveFile: async (input: unknown) => {
        enqueued = input;
        return { jobId: "job-1", jobState: "QUEUED" };
      }
    }),
    archiveStore: {
      putStagingStream: async ({ source }: { source: AsyncIterable<Uint8Array> }) => {
        for await (const chunk of source) received = Buffer.concat([received, chunk]);
        return { stagingKey: "imports/session-1/staging/123e4567-e89b-42d3-a456-426614174000", sha256: SHA, byteSize: 6 };
      },
      removeStaging: async () => undefined
    } as never
  });

  const result = await service.uploadFile(
    { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 6 },
    Readable.from([JPEG.subarray(0, 2), JPEG.subarray(2)])
  );

  assert.deepEqual(received, JPEG);
  assert.deepEqual(result, { fileId: "file-1", uploadStatus: "UPLOADING", byteSize: 6, sha256: SHA });
  assert.deepEqual(enqueued, {
    sessionId: "session-1",
    fileId: "file-1",
    idempotencyKey: (enqueued as { idempotencyKey: string }).idempotencyKey,
    stagingKey: "imports/session-1/staging/123e4567-e89b-42d3-a456-426614174000",
    sha256: SHA
  });
  assert.match((enqueued as { idempotencyKey: string }).idempotencyKey, /^asset-upload-[a-f0-9]{64}$/);
  assert.equal(ASSET_UPLOAD_PROBE_MAX_BYTES, 8 * 1024 * 1024);
});

test("same-byte re-upload uses a new archive operation identity after a terminal worker attempt", async () => {
  const idempotencyKeys: string[] = [];
  let stagingAttempt = 0;
  const service = new AssetImportApplicationService({
    repository: repository({
      enqueueArchiveFile: async (input: { idempotencyKey: string }) => {
        idempotencyKeys.push(input.idempotencyKey);
        return { jobId: `job-${idempotencyKeys.length}`, jobState: "QUEUED" };
      }
    }),
    archiveStore: {
      putStagingStream: async ({ source }: { source: AsyncIterable<Uint8Array> }) => {
        for await (const _chunk of source) void _chunk;
        stagingAttempt += 1;
        return {
          stagingKey: `imports/session-1/staging/123e4567-e89b-42d3-a456-42661417400${stagingAttempt}`,
          sha256: SHA,
          byteSize: 6
        };
      },
      removeStaging: async () => undefined
    } as never
  });

  await service.uploadFile(
    { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 6 },
    Readable.from([JPEG])
  );
  await service.uploadFile(
    { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 6 },
    Readable.from([JPEG])
  );

  assert.equal(idempotencyKeys.length, 2);
  assert.notEqual(idempotencyKeys[0], idempotencyKeys[1]);
});

test("matching archived re-upload verifies the stream and returns the existing archive without side effects", async () => {
  let mutatingCall = false;
  const archivedAt = new Date("2026-09-06T03:04:05.000Z");
  const archivedSha = "fc16d7dcee9cae83ef3923222a81ccd8fe96c9d25fdb7f504d66f1011e0cd870";
  const service = new AssetImportApplicationService({
    repository: repository({
      resolveUploadTarget: async () => ({
        sessionId: "session-1",
        fileId: "file-1",
        clientFileId: "client-1",
        relativePath: "photo.jpg",
        kind: "JPEG",
        byteSize: 6,
        state: "ARCHIVED",
        sha256: archivedSha,
        archiveKey: "imports/session-1/raw/photo.jpg",
        archivedAt
      }),
      enqueueArchiveFile: async () => {
        mutatingCall = true;
        throw new Error("must not enqueue");
      },
      failUploadReservation: async () => {
        mutatingCall = true;
        throw new Error("must not release");
      }
    }),
    archiveStore: {
      putStagingStream: async () => {
        mutatingCall = true;
        throw new Error("must not stage");
      },
      removeStaging: async () => {
        mutatingCall = true;
      }
    } as never
  });

  const result = await service.uploadFile(
    { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 6, declaredSha256: archivedSha },
    Readable.from([JPEG])
  );

  assert.deepEqual(result, {
    fileId: "file-1",
    uploadStatus: "ARCHIVED",
    byteSize: 6,
    sha256: archivedSha,
    archiveKey: "imports/session-1/raw/photo.jpg",
    archivedAt: "2026-09-06T03:04:05.000Z"
  });
  assert.equal(mutatingCall, false);

  await assert.rejects(
    () => service.uploadFile(
      { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 6 },
      Readable.from([Buffer.from("wrong!")])
    ),
    (error: unknown) => {
      assert.ok(error instanceof AssetImportApiError);
      assert.equal(error.transportCode, "CONFLICT");
      assert.equal(error.assetCode, "ARCHIVE_CONFLICT");
      return true;
    }
  );
  assert.equal(mutatingCall, false);
});

test("content mismatch removes staging and releases the reservation without masking the client error", async () => {
  const actions: string[] = [];
  const service = new AssetImportApplicationService({
    repository: repository({
      failUploadReservation: async () => {
        actions.push("release");
        throw new Error("private database cleanup failure");
      }
    }),
    archiveStore: {
      putStagingStream: async ({ source }: { source: AsyncIterable<Uint8Array> }) => {
        for await (const _chunk of source) void _chunk;
        return { stagingKey: "imports/session-1/staging/123e4567-e89b-42d3-a456-426614174000", sha256: SHA, byteSize: 6 };
      },
      removeStaging: async () => {
        actions.push("remove");
        throw new Error("private storage cleanup failure");
      }
    } as never
  });

  await assert.rejects(
    () => service.uploadFile(
      { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 6 },
      Readable.from([Buffer.from("notjpg")])
    ),
    (error: unknown) => {
      assert.ok(error instanceof AssetImportApiError);
      assert.equal(error.transportCode, "UNSUPPORTED_MEDIA_TYPE");
      assert.equal(error.assetCode, "UNSUPPORTED_FILE_KIND");
      assert.equal(error.message.includes("private"), false);
      return true;
    }
  );
  assert.deepEqual(actions, ["remove", "release"]);
});

test("declared SHA mismatch is a retryable archive verification error and releases the reservation", async () => {
  let released = false;
  const service = new AssetImportApplicationService({
    repository: repository({
      resolveUploadTarget: async () => ({
        sessionId: "session-1", fileId: "file-1", clientFileId: "client-1",
        relativePath: "photo.jpg", kind: "JPEG", byteSize: 6, state: "UPLOADING",
        declaredSha256: "a".repeat(64)
      }),
      failUploadReservation: async () => {
        released = true;
        return { sessionId: "session-1", fileId: "file-1", state: "FAILED", changed: true };
      }
    }),
    archiveStore: {
      putStagingStream: async ({ source }: { source: AsyncIterable<Uint8Array> }) => {
        for await (const _chunk of source) void _chunk;
        return { stagingKey: "imports/session-1/staging/123e4567-e89b-42d3-a456-426614174000", sha256: SHA, byteSize: 6 };
      },
      removeStaging: async () => undefined
    } as never
  });

  await assert.rejects(
    () => service.uploadFile(
      { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 6, declaredSha256: "a".repeat(64) },
      Readable.from([JPEG])
    ),
    (error: unknown) => {
      assert.ok(error instanceof AssetImportApiError);
      assert.equal(error.assetCode, "ARCHIVE_VERIFICATION_FAILED");
      return true;
    }
  );
  assert.equal(released, true);
});

test("declared kind mismatch is rejected after bounded probing and can be retried", async () => {
  let released = false;
  const service = new AssetImportApplicationService({
    repository: repository({
      resolveUploadTarget: async () => ({
        sessionId: "session-1", fileId: "file-1", clientFileId: "client-1",
        relativePath: "photo.png", kind: "PNG", byteSize: 6, state: "UPLOADING",
        declaredSha256: null
      }),
      failUploadReservation: async () => {
        released = true;
        return { sessionId: "session-1", fileId: "file-1", state: "FAILED", changed: true };
      }
    }),
    archiveStore: {
      putStagingStream: async ({ source }: { source: AsyncIterable<Uint8Array> }) => {
        for await (const _chunk of source) void _chunk;
        return { stagingKey: "imports/session-1/staging/123e4567-e89b-42d3-a456-426614174000", sha256: SHA, byteSize: 6 };
      },
      removeStaging: async () => undefined
    } as never
  });

  await assert.rejects(
    () => service.uploadFile(
      { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 6 },
      Readable.from([JPEG])
    ),
    (error: unknown) => {
      assert.ok(error instanceof AssetImportApiError);
      assert.equal(error.transportCode, "UNPROCESSABLE_ENTITY");
      assert.equal(error.assetCode, "CORRUPT_FILE_CONTENT");
      return true;
    }
  );
  assert.equal(released, true);
});

test("audited mutations use only the fixed server-side asset administrator actor", async () => {
  const actors: string[] = [];
  const captureActor = (actor: string) => actors.push(actor);
  const service = new AssetImportApplicationService({
    repository: repository({
      cancelSession: async (_sessionId: string, _input: unknown, actor: string) => {
        captureActor(actor);
        return { sessionId: "session-1", state: "CANCELLED", cancelledAt: new Date() };
      },
      updateGroup: async (_groupId: string, _input: unknown, actor: string) => {
        captureActor(actor);
        return { groupId: "group-1", state: "NAMED", revision: 2, memberFileIds: ["file-1"], crystalName: "紫水晶" };
      },
      selectProcessedVersion: async (_groupId: string, _input: unknown, actor: string) => {
        captureActor(actor);
        return { groupId: "group-1", state: "PROCESSED", selectedProcessingVersion: 1, updatedAt: new Date() };
      },
      reviewProcessedAsset: async (_groupId: string, _assetId: string, _input: unknown, actor: string) => {
        captureActor(actor);
        return { groupId: "group-1", processedAssetId: "asset-1", reviewAction: "REJECT", state: "RETIRED", revision: 3, reviewedAt: new Date() };
      },
      updateCrystalDraft: async (_draftId: string, _input: unknown, actor: string) => {
        captureActor(actor);
        return { crystalDraftId: "draft-1", revision: 2, curationComplete: false, missingFields: ["NAME_EN"], promotionEligible: false, updatedAt: new Date() };
      },
      publishGroup: async (_groupId: string, _input: unknown, actor: string) => {
        captureActor(actor);
        return { groupId: "group-1", state: "PUBLISHED", materialProductId: "product-1", crystalId: "crystal-1", inventorySnapshotId: "inventory-1", publishedAt: new Date(), publishedAssetKeys: [`approved:${"a".repeat(64)}`] };
      }
    }),
    archiveStore: {} as never
  });

  await service.cancelSession("session-1", {} as never);
  await service.updateGroup("group-1", {} as never);
  await service.selectProcessedVersion("group-1", {} as never);
  await service.reviewProcessedAsset("group-1", "asset-1", {} as never);
  await service.updateCrystalDraft("draft-1", {} as never);
  await service.publishGroup("group-1", {} as never);

  assert.deepEqual(actors, Array(6).fill("asset-admin-local-operator"));
});
