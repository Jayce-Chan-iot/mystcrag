import assert from "node:assert/strict";
import test from "node:test";

import type { AssetImportSessionFileView, AssetImportSessionResponse } from "@mystcrag/design-contract";

import { decideUploadRecovery } from "./upload-recovery";

function makeFile(overrides: Partial<AssetImportSessionFileView> = {}): AssetImportSessionFileView {
  return {
    fileId: "file-1",
    clientFileId: "client-file-1",
    relativePath: "batch-01/bead-01.jpg",
    kind: "JPEG",
    state: "ARCHIVED",
    byteSize: 2048,
    ...overrides
  };
}

function makeSession(overrides: Partial<AssetImportSessionResponse> = {}): AssetImportSessionResponse {
  return {
    sessionId: "session-1",
    state: "PARTIALLY_FAILED",
    createdAt: "2026-09-07T08:00:00.000Z",
    updatedAt: "2026-09-07T08:05:00.000Z",
    lastVerifiedCheckpoint: null,
    declaredFileCount: 2,
    uploadedFileCount: 1,
    archivedFileCount: 1,
    failedFileCount: 1,
    declaredBytes: 4096,
    uploadedBytes: 2048,
    files: [
      makeFile({ state: "ARCHIVED" }),
      makeFile({ fileId: "file-2", clientFileId: "client-file-2", relativePath: "batch-01/bead-02.jpg", state: "FAILED" })
    ],
    groups: [],
    ...overrides
  };
}

test("a refreshed PARTIALLY_FAILED session retries its registered failed files", () => {
  const decision = decideUploadRecovery({
    session: makeSession(),
    pickedRelativePaths: ["batch-01/bead-01.jpg", "batch-01/bead-02.jpg"],
    newClientFileId: () => "cf-1"
  });

  assert.equal(decision.mode, "RETRY_REGISTERED");
  if (decision.mode !== "RETRY_REGISTERED") return;
  assert.deepEqual(decision.targets, [
    { fileId: "file-2", clientFileId: "cf-1", relativePath: "batch-01/bead-02.jpg", byteSize: 2048 }
  ]);
  assert.deepEqual(decision.unmatchedPickedPaths, ["batch-01/bead-01.jpg"]);
});

test("a refreshed session also retries registered files the queue never attempted", () => {
  const decision = decideUploadRecovery({
    session: makeSession({
      files: [
        makeFile({ state: "ARCHIVED" }),
        makeFile({ fileId: "file-2", clientFileId: "client-file-2", relativePath: "batch-01/bead-02.jpg", state: "PENDING" })
      ]
    }),
    pickedRelativePaths: ["batch-01/bead-02.jpg"],
    newClientFileId: () => "cf-1"
  });

  assert.equal(decision.mode, "RETRY_REGISTERED");
  if (decision.mode !== "RETRY_REGISTERED") return;
  assert.equal(decision.targets.length, 1);
  assert.deepEqual(decision.unmatchedPickedPaths, []);
});

test("a session that may still register a manifest uses the normal upload flow", () => {
  for (const state of ["CREATED", "UPLOADING"] as const) {
    const decision = decideUploadRecovery({
      session: makeSession({ state }),
      pickedRelativePaths: ["batch-01/bead-02.jpg"],
      newClientFileId: () => "cf-1"
    });
    assert.equal(decision.mode, "REGISTER_AND_UPLOAD", `${state} must register a fresh manifest`);
  }
});

test("a session without registered retries uses the normal upload flow", () => {
  const decision = decideUploadRecovery({
    session: makeSession({
      state: "PARTIALLY_FAILED",
      files: [makeFile({ state: "ARCHIVED" })]
    }),
    pickedRelativePaths: ["batch-01/bead-01.jpg"],
    newClientFileId: () => "cf-1"
  });
  assert.equal(decision.mode, "REGISTER_AND_UPLOAD");
});

test("retry matching is exact per relative path and issues one client id per target", () => {
  const decision = decideUploadRecovery({
    session: makeSession({
      files: [
        makeFile({ fileId: "file-2", clientFileId: "client-file-2", relativePath: "batch-01/bead-02.jpg", state: "FAILED" }),
        makeFile({ fileId: "file-3", clientFileId: "client-file-3", relativePath: "batch-01/bead-03.jpg", state: "FAILED" })
      ],
      failedFileCount: 2
    }),
    pickedRelativePaths: ["batch-01/bead-02.jpg", "batch-01/bead-03.jpg"],
    newClientFileId: (() => {
      let issued = 0;
      return () => `cf-${(issued += 1)}`;
    })()
  });

  assert.equal(decision.mode, "RETRY_REGISTERED");
  if (decision.mode !== "RETRY_REGISTERED") return;
  assert.deepEqual(
    decision.targets.map((target) => target.clientFileId),
    ["cf-1", "cf-2"],
    "every retry target gets its own upload identity"
  );
  assert.deepEqual(decision.unmatchedPickedPaths, []);
});
