import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSET_IMPORT_SESSION_STATES,
  ASSET_IMPORT_SESSION_TERMINAL_STATES,
  AssetImportSessionResponseSchema,
  type AssetImportSessionFileView,
  type AssetImportSessionGroupView,
  type AssetImportSessionResponse,
  type AssetImportSessionState
} from "@mystcrag/design-contract";

import {
  WORKFLOW_STEPS,
  WORKFLOW_STEP_LABELS,
  allGroupsNamed,
  canRegisterManifest,
  canStartGrouping,
  canStartProcessing,
  canUploadFileContent,
  isTerminalSessionState,
  isWorkflowStepReachable,
  maxReachableWorkflowStep,
  resolveWorkflowStep,
  summarizeUploadProgress,
  workflowStepIndex
} from "./workflow-model";

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

function makeGroup(overrides: Partial<AssetImportSessionGroupView> = {}): AssetImportSessionGroupView {
  return {
    groupId: "group-1",
    state: "SUGGESTED",
    memberFileIds: ["file-1"],
    revision: 1,
    processedAssets: [],
    crystalDraft: null,
    productDraft: null,
    ...overrides
  };
}

function makeSession(overrides: Partial<AssetImportSessionResponse> = {}): AssetImportSessionResponse {
  return {
    sessionId: "session-1",
    state: "CREATED",
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:05:00.000Z",
    lastVerifiedCheckpoint: null,
    declaredFileCount: 0,
    uploadedFileCount: 0,
    archivedFileCount: 0,
    failedFileCount: 0,
    declaredBytes: 0,
    uploadedBytes: 0,
    files: [],
    groups: [],
    ...overrides
  };
}

const processedAsset = {
  processedAssetId: "processed-1",
  processingVersion: 1,
  state: "QC_PENDING" as const,
  isCurrent: true,
  qcPassed: true,
  qcIssues: [],
  approvedAssetKey: null
};

test("the fixture builder produces contract-valid sessions", () => {
  const session = makeSession({
    state: "NEEDS_REVIEW",
    lastVerifiedCheckpoint: "PROCESSED",
    declaredFileCount: 1,
    archivedFileCount: 1,
    declaredBytes: 2048,
    uploadedBytes: 2048,
    files: [makeFile({ sha256: "a".repeat(64) })],
    groups: [makeGroup({ state: "PROCESSED", crystalName: "白水晶", processedAssets: [processedAsset] })]
  });
  const result = AssetImportSessionResponseSchema.safeParse(session);
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
});

test("the workflow has exactly the four dispatched steps in order", () => {
  assert.deepEqual(WORKFLOW_STEPS, [
    "UPLOAD_FOLDER",
    "REVIEW_GROUPS",
    "NAME_AND_CURATE",
    "PROCESS_REVIEW_PUBLISH"
  ]);
  assert.deepEqual(
    WORKFLOW_STEPS.map((step) => workflowStepIndex(step)),
    [0, 1, 2, 3]
  );
});

test("every step carries an operator-facing label without efficacy claims", () => {
  for (const step of WORKFLOW_STEPS) {
    const label = WORKFLOW_STEP_LABELS[step];
    assert.ok(label.title.length > 0, `${step} needs a title`);
    assert.ok(label.hint.length > 0, `${step} needs a hint`);
    for (const forbidden of ["功效", "疗效", "治疗", "保证", "转运", "招财"]) {
      assert.ok(!label.title.includes(forbidden), `${step} title must not promise ${forbidden}`);
      assert.ok(!label.hint.includes(forbidden), `${step} hint must not promise ${forbidden}`);
    }
  }
});

test("terminal session states match the contract exactly", () => {
  const expected = new Set<string>(ASSET_IMPORT_SESSION_TERMINAL_STATES);
  for (const state of ASSET_IMPORT_SESSION_STATES) {
    assert.equal(isTerminalSessionState(state), expected.has(state), `terminal mismatch for ${state}`);
  }
  assert.deepEqual([...expected].sort(), ["CANCELLED", "FAILED", "PUBLISHED"]);
});

test("action availability mirrors the Backend state guards", () => {
  // registerManifest: CREATED | UPLOADING
  // upload file content: UPLOADING | ARCHIVING | PARTIALLY_FAILED
  // grouping/start: ARCHIVING | PARTIALLY_FAILED
  // processing/start: NEEDS_REVIEW | PARTIALLY_FAILED
  const expectations: Record<
    AssetImportSessionState,
    [manifest: boolean, upload: boolean, grouping: boolean, processing: boolean]
  > = {
    CREATED: [true, false, false, false],
    UPLOADING: [true, true, false, false],
    ARCHIVING: [false, true, true, false],
    PROCESSING: [false, false, false, false],
    NEEDS_REVIEW: [false, false, false, true],
    READY_TO_PUBLISH: [false, false, false, false],
    PUBLISHING: [false, false, false, false],
    PUBLISHED: [false, false, false, false],
    PARTIALLY_FAILED: [false, true, true, true],
    FAILED: [false, false, false, false],
    CANCELLED: [false, false, false, false]
  };
  for (const state of ASSET_IMPORT_SESSION_STATES) {
    const expected = expectations[state];
    assert.ok(expected !== undefined);
    assert.equal(canRegisterManifest(state), expected[0], `manifest for ${state}`);
    assert.equal(canUploadFileContent(state), expected[1], `upload for ${state}`);
    assert.equal(canStartGrouping(state), expected[2], `grouping for ${state}`);
    assert.equal(canStartProcessing(state), expected[3], `processing for ${state}`);
  }
});

test("allGroupsNamed only trusts the human-entered crystalName", () => {
  assert.equal(allGroupsNamed([]), false);
  assert.equal(allGroupsNamed([makeGroup()]), false);
  assert.equal(allGroupsNamed([makeGroup({ crystalName: "白水晶" })]), true);
  assert.equal(
    allGroupsNamed([makeGroup({ crystalName: "白水晶" }), makeGroup({ groupId: "group-2" })]),
    false
  );
  // A file or folder name is never a crystal identity.
  assert.equal(
    allGroupsNamed([
      makeGroup({ groupId: "group-2", memberFileIds: ["folder-01/img-001.arw"], crystalName: undefined })
    ]),
    false
  );
});

test("a session with no progress resolves to the upload step", () => {
  assert.equal(resolveWorkflowStep(makeSession()), "UPLOAD_FOLDER");
  assert.equal(
    resolveWorkflowStep(
      makeSession({
        state: "UPLOADING",
        declaredFileCount: 2,
        files: [makeFile({ state: "PENDING" }), makeFile({ fileId: "file-2", state: "UPLOADING" })]
      })
    ),
    "UPLOAD_FOLDER"
  );
  assert.equal(
    resolveWorkflowStep(
      makeSession({
        state: "ARCHIVING",
        lastVerifiedCheckpoint: "ARCHIVED",
        declaredFileCount: 1,
        archivedFileCount: 1,
        files: [makeFile()]
      })
    ),
    "UPLOAD_FOLDER"
  );
});

test("a partial upload failure stays on the upload step for retry", () => {
  const session = makeSession({
    state: "PARTIALLY_FAILED",
    lastVerifiedCheckpoint: "ARCHIVED",
    declaredFileCount: 3,
    archivedFileCount: 2,
    failedFileCount: 1,
    files: [
      makeFile(),
      makeFile({ fileId: "file-2", state: "ARCHIVED", relativePath: "batch-01/bead-02.jpg" }),
      makeFile({ fileId: "file-3", state: "FAILED", relativePath: "batch-01/bead-03.jpg" })
    ]
  });
  assert.equal(resolveWorkflowStep(session), "UPLOAD_FOLDER");
  assert.equal(maxReachableWorkflowStep(session), "UPLOAD_FOLDER");
  assert.equal(summarizeUploadProgress(session).hasFailures, true);
});

test("grouping in flight and suggested groups resolve to the review step", () => {
  assert.equal(
    resolveWorkflowStep(makeSession({ state: "PROCESSING", lastVerifiedCheckpoint: "ARCHIVED" })),
    "REVIEW_GROUPS"
  );
  const grouped = makeSession({
    state: "NEEDS_REVIEW",
    lastVerifiedCheckpoint: "GROUPED",
    declaredFileCount: 1,
    archivedFileCount: 1,
    files: [makeFile()],
    groups: [makeGroup()]
  });
  assert.equal(resolveWorkflowStep(grouped), "REVIEW_GROUPS");
  assert.equal(maxReachableWorkflowStep(grouped), "REVIEW_GROUPS");
});

test("human-entered names move the session to the naming and curation step", () => {
  const named = makeSession({
    state: "NEEDS_REVIEW",
    lastVerifiedCheckpoint: "GROUPED",
    groups: [makeGroup({ state: "NAMED", crystalName: "白水晶" })]
  });
  assert.equal(resolveWorkflowStep(named), "NAME_AND_CURATE");
  // Processing may now be started, so the last step becomes reachable without
  // stealing the landing spot from the unfinished draft.
  assert.equal(maxReachableWorkflowStep(named), "PROCESS_REVIEW_PUBLISH");
  assert.equal(
    resolveWorkflowStep(makeSession({ state: "NEEDS_REVIEW", lastVerifiedCheckpoint: "LABELED", groups: [makeGroup({ state: "NAMED", crystalName: "白水晶" })] })),
    "NAME_AND_CURATE"
  );
});

test("processing, review, publishing and published states resolve to the last step", () => {
  const cases: AssetImportSessionResponse[] = [
    makeSession({ state: "PROCESSING", lastVerifiedCheckpoint: "LABELED", groups: [makeGroup({ state: "NAMED", crystalName: "白水晶" })] }),
    makeSession({ state: "NEEDS_REVIEW", lastVerifiedCheckpoint: "PROCESSED", groups: [makeGroup({ state: "PROCESSED", crystalName: "白水晶", processedAssets: [processedAsset] })] }),
    makeSession({ state: "READY_TO_PUBLISH", lastVerifiedCheckpoint: "REVIEWED", groups: [makeGroup({ state: "READY", crystalName: "白水晶", processedAssets: [processedAsset] })] }),
    makeSession({ state: "PUBLISHING", lastVerifiedCheckpoint: "REVIEWED", groups: [makeGroup({ state: "READY", crystalName: "白水晶", processedAssets: [processedAsset] })] }),
    makeSession({ state: "PUBLISHED", lastVerifiedCheckpoint: "PUBLISHED", groups: [makeGroup({ state: "PUBLISHED", crystalName: "白水晶", processedAssets: [processedAsset] })] }),
    // A published session must never be thrown back to the upload step, even
    // when no checkpoint was recorded.
    makeSession({ state: "PUBLISHED", lastVerifiedCheckpoint: null, files: [makeFile()], groups: [makeGroup({ state: "PUBLISHED", crystalName: "白水晶" })] }),
    // Existing processed output alone is enough to reach the review step.
    makeSession({ state: "NEEDS_REVIEW", lastVerifiedCheckpoint: "LABELED", groups: [makeGroup({ state: "PROCESSED", crystalName: "白水晶", processedAssets: [processedAsset] })] })
  ];
  for (const session of cases) {
    assert.equal(resolveWorkflowStep(session), "PROCESS_REVIEW_PUBLISH", `state ${session.state}`);
    assert.equal(maxReachableWorkflowStep(session), "PROCESS_REVIEW_PUBLISH");
  }
});

test("terminal failures land on the step matching their verified progress", () => {
  assert.equal(resolveWorkflowStep(makeSession({ state: "FAILED" })), "UPLOAD_FOLDER");
  assert.equal(
    resolveWorkflowStep(makeSession({ state: "FAILED", lastVerifiedCheckpoint: "PROCESSED", groups: [makeGroup({ state: "PROCESSED", crystalName: "白水晶", processedAssets: [processedAsset] })] })),
    "PROCESS_REVIEW_PUBLISH"
  );
  assert.equal(
    resolveWorkflowStep(makeSession({ state: "CANCELLED", lastVerifiedCheckpoint: "GROUPED", groups: [makeGroup()] })),
    "REVIEW_GROUPS"
  );
  assert.equal(resolveWorkflowStep(makeSession({ state: "CANCELLED" })), "UPLOAD_FOLDER");
  // A terminal session can never advance, whatever was named before.
  const cancelledNamed = makeSession({
    state: "CANCELLED",
    lastVerifiedCheckpoint: "LABELED",
    groups: [makeGroup({ state: "NAMED", crystalName: "白水晶" })]
  });
  assert.equal(resolveWorkflowStep(cancelledNamed), "NAME_AND_CURATE");
  assert.equal(maxReachableWorkflowStep(cancelledNamed), "NAME_AND_CURATE");
});

test("step reachability is monotonic and bounded by real progress", () => {
  const grouped = makeSession({
    state: "NEEDS_REVIEW",
    lastVerifiedCheckpoint: "GROUPED",
    groups: [makeGroup()]
  });
  assert.deepEqual(
    WORKFLOW_STEPS.map((step) => isWorkflowStepReachable(grouped, step)),
    [true, true, false, false]
  );

  const named = makeSession({
    state: "NEEDS_REVIEW",
    lastVerifiedCheckpoint: "GROUPED",
    groups: [makeGroup({ state: "NAMED", crystalName: "白水晶" })]
  });
  assert.deepEqual(
    WORKFLOW_STEPS.map((step) => isWorkflowStepReachable(named, step)),
    [true, true, true, true]
  );

  const fresh = makeSession();
  assert.deepEqual(
    WORKFLOW_STEPS.map((step) => isWorkflowStepReachable(fresh, step)),
    [true, false, false, false]
  );
});

test("upload progress is summarized per file state with a safe byte ratio", () => {
  const empty = summarizeUploadProgress(makeSession());
  assert.deepEqual(empty, {
    declaredFileCount: 0,
    pending: 0,
    uploading: 0,
    archived: 0,
    failed: 0,
    skippedDuplicate: 0,
    declaredBytes: 0,
    uploadedBytes: 0,
    byteProgress: 0,
    isComplete: false,
    hasFailures: false
  });

  const partial = summarizeUploadProgress(
    makeSession({
      state: "UPLOADING",
      declaredFileCount: 4,
      declaredBytes: 1000,
      uploadedBytes: 250,
      files: [
        makeFile({ state: "ARCHIVED" }),
        makeFile({ fileId: "file-2", state: "UPLOADING" }),
        makeFile({ fileId: "file-3", state: "PENDING" }),
        makeFile({ fileId: "file-4", state: "FAILED" })
      ]
    })
  );
  assert.equal(partial.archived, 1);
  assert.equal(partial.uploading, 1);
  assert.equal(partial.pending, 1);
  assert.equal(partial.failed, 1);
  assert.equal(partial.skippedDuplicate, 0);
  assert.equal(partial.byteProgress, 0.25);
  assert.equal(partial.isComplete, false);
  assert.equal(partial.hasFailures, true);

  const complete = summarizeUploadProgress(
    makeSession({
      state: "ARCHIVING",
      lastVerifiedCheckpoint: "ARCHIVED",
      declaredFileCount: 2,
      archivedFileCount: 1,
      declaredBytes: 4096,
      uploadedBytes: 4096,
      files: [makeFile({ state: "ARCHIVED" }), makeFile({ fileId: "file-2", state: "SKIPPED_DUPLICATE" })]
    })
  );
  assert.equal(complete.archived, 1);
  assert.equal(complete.skippedDuplicate, 1);
  assert.equal(complete.isComplete, true);
  assert.equal(complete.hasFailures, false);
  assert.equal(complete.byteProgress, 1);
});
