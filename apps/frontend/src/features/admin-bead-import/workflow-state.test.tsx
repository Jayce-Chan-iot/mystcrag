import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSET_IMPORT_SESSION_STATES,
  type AssetImportProcessedAssetView,
  type AssetImportSessionFileView,
  type AssetImportSessionGroupView,
  type AssetImportSessionResponse,
  type AssetImportSessionState
} from "@mystcrag/design-contract";

import { resolveWorkflowStep } from "./workflow-model";
import {
  CONFLICT_NOTICE_ID,
  CONFLICT_NOTICE_MESSAGE,
  LOAD_ERROR_NOTICE_ID,
  LOAD_ERROR_NOTICE_MESSAGE,
  STALE_GROUP_NOTICE_ID,
  UPLOAD_FAILURE_NOTICE_ID,
  canEditGroups,
  canSubmitGroupMutation,
  currentWorkflowStep,
  groupRevisionFor,
  initialWorkflowState,
  isSessionLocked,
  shouldPollSession,
  workflowReducer
} from "./workflow-state";

const SYNCED_AT = "2026-09-06T09:00:00.000Z";
const RESYNCED_AT = "2026-09-06T09:00:30.000Z";
const ARCHIVE_KEY = "asset-archive/2026-09-06/session-1/file-1.jpg";

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

const processedAsset: AssetImportProcessedAssetView = {
  processedAssetId: "processed-1",
  processingVersion: 1,
  state: "QC_PENDING",
  isCurrent: true,
  qcPassed: true,
  qcIssues: []
};

function sessionForState(state: AssetImportSessionState): AssetImportSessionResponse {
  switch (state) {
    case "CREATED":
      return makeSession({ state });
    case "UPLOADING":
      return makeSession({
        state,
        declaredFileCount: 2,
        declaredBytes: 4096,
        files: [makeFile({ state: "PENDING" }), makeFile({ fileId: "file-2", state: "UPLOADING" })]
      });
    case "ARCHIVING":
      return makeSession({
        state,
        lastVerifiedCheckpoint: "ARCHIVED",
        declaredFileCount: 1,
        archivedFileCount: 1,
        declaredBytes: 2048,
        uploadedBytes: 2048,
        files: [makeFile({ archiveKey: ARCHIVE_KEY })]
      });
    case "PROCESSING":
      return makeSession({
        state,
        lastVerifiedCheckpoint: "LABELED",
        declaredFileCount: 1,
        archivedFileCount: 1,
        files: [makeFile()],
        groups: [makeGroup({ state: "NAMED", crystalName: "白水晶" })]
      });
    case "NEEDS_REVIEW":
      return makeSession({
        state,
        lastVerifiedCheckpoint: "PROCESSED",
        declaredFileCount: 1,
        archivedFileCount: 1,
        files: [makeFile()],
        groups: [makeGroup({ state: "PROCESSED", crystalName: "白水晶", processedAssets: [processedAsset] })]
      });
    case "READY_TO_PUBLISH":
    case "PUBLISHING":
      return makeSession({
        state,
        lastVerifiedCheckpoint: "REVIEWED",
        declaredFileCount: 1,
        archivedFileCount: 1,
        files: [makeFile()],
        groups: [
          makeGroup({
            state: "READY",
            crystalName: "白水晶",
            processedAssets: [{ ...processedAsset, state: "APPROVED" }]
          })
        ]
      });
    case "PUBLISHED":
      return makeSession({
        state,
        lastVerifiedCheckpoint: "PUBLISHED",
        declaredFileCount: 1,
        archivedFileCount: 1,
        files: [makeFile()],
        groups: [
          makeGroup({
            state: "PUBLISHED",
            crystalName: "白水晶",
            processedAssets: [{ ...processedAsset, state: "APPROVED" }]
          })
        ]
      });
    case "PARTIALLY_FAILED":
      return makeSession({
        state,
        lastVerifiedCheckpoint: "ARCHIVED",
        declaredFileCount: 2,
        archivedFileCount: 1,
        failedFileCount: 1,
        declaredBytes: 4096,
        uploadedBytes: 2048,
        files: [
          makeFile({ archiveKey: ARCHIVE_KEY }),
          makeFile({ fileId: "file-2", state: "FAILED", relativePath: "batch-01/bead-02.jpg" })
        ]
      });
    case "FAILED":
      return makeSession({ state });
    case "CANCELLED":
      return makeSession({ state });
  }
}

function load(session: AssetImportSessionResponse, syncedAt = SYNCED_AT) {
  return workflowReducer(initialWorkflowState(session.sessionId), {
    type: "SESSION_LOADED",
    session,
    syncedAt
  });
}

function groupedSession(overrides: Partial<AssetImportSessionGroupView> = {}): AssetImportSessionResponse {
  return makeSession({
    state: "NEEDS_REVIEW",
    lastVerifiedCheckpoint: "GROUPED",
    declaredFileCount: 1,
    archivedFileCount: 1,
    files: [makeFile()],
    groups: [makeGroup(overrides)]
  });
}

test("the initial state is idle on the upload step with no authority", () => {
  const state = initialWorkflowState();
  assert.equal(state.sessionId, null);
  assert.equal(state.session, null);
  assert.equal(state.status, "IDLE");
  assert.equal(state.resolvedStep, "UPLOAD_FOLDER");
  assert.equal(currentWorkflowStep(state), "UPLOAD_FOLDER");
  assert.equal(state.polling, false);
  assert.equal(state.blockedByConflict, false);
  assert.equal(state.refreshRequested, false);
  assert.equal(state.lastSyncedAt, null);
  assert.equal(state.error, null);
  assert.deepEqual(state.localEdits, {});
  assert.deepEqual(state.staleGroupIds, []);
  assert.deepEqual(state.inFlightGroupIds, []);
  assert.deepEqual(state.notices, []);
  assert.equal(initialWorkflowState("session-9").sessionId, "session-9");
  // Without a loaded session there is nothing to navigate to.
  assert.equal(workflowReducer(state, { type: "REQUEST_STEP", step: "REVIEW_GROUPS" }).requestedStep, null);
  assert.equal(canSubmitGroupMutation(state, "group-1"), false);
  assert.equal(canEditGroups(state, "group-1"), false);
  assert.equal(groupRevisionFor(state, "group-1"), null);
});

test("requesting a session clears the error but keeps unsaved operator edits", () => {
  const loaded = load(groupedSession());
  const edited = workflowReducer(loaded, {
    type: "EDIT_GROUP",
    edit: { groupId: "group-1", crystalName: "紫水晶" }
  });
  const failed = workflowReducer(edited, {
    type: "SESSION_FAILED",
    error: { code: "INTERNAL_ERROR", message: "The bead import service did not respond.", retryable: true }
  });
  assert.equal(failed.status, "ERROR");
  assert.equal(failed.polling, false);
  const notice = failed.notices.find((item) => item.id === LOAD_ERROR_NOTICE_ID);
  assert.ok(notice);
  assert.equal(notice.tone, "danger");
  assert.equal(notice.message, LOAD_ERROR_NOTICE_MESSAGE);
  // Previously loaded data survives so the operator does not lose context.
  assert.equal(failed.session, loaded.session);

  const requested = workflowReducer(failed, { type: "SESSION_REQUESTED", sessionId: "session-1" });
  assert.equal(requested.status, "LOADING");
  assert.equal(requested.error, null);
  assert.equal(requested.refreshRequested, false);
  assert.equal(requested.polling, false);
  assert.equal(
    requested.notices.some((item) => item.id === LOAD_ERROR_NOTICE_ID),
    false
  );
  assert.deepEqual(requested.localEdits, edited.localEdits);
});

test("a refresh always lands on the step resolved from Backend authority", () => {
  for (const state of ASSET_IMPORT_SESSION_STATES) {
    const session = sessionForState(state);
    const loaded = load(session);
    assert.equal(loaded.status, "READY", state);
    assert.equal(loaded.resolvedStep, resolveWorkflowStep(session), state);
    assert.equal(loaded.requestedStep, null, `${state} must not keep a stale navigation choice`);
    assert.equal(loaded.polling, shouldPollSession(session), state);
    assert.equal(loaded.lastSyncedAt, SYNCED_AT, state);
    assert.equal(loaded.error, null, state);
  }
});

test("polling only runs while the Backend advances the session on its own", () => {
  const expected: Record<AssetImportSessionState, boolean> = {
    CREATED: false,
    UPLOADING: true,
    ARCHIVING: true,
    PROCESSING: true,
    NEEDS_REVIEW: false,
    READY_TO_PUBLISH: false,
    PUBLISHING: true,
    PUBLISHED: false,
    PARTIALLY_FAILED: false,
    FAILED: false,
    CANCELLED: false
  };
  for (const state of ASSET_IMPORT_SESSION_STATES) {
    assert.equal(shouldPollSession(sessionForState(state)), expected[state], state);
  }
});

function withGroup(state: AssetImportSessionState): AssetImportSessionResponse {
  return makeSession({
    state,
    declaredFileCount: 1,
    archivedFileCount: 1,
    files: [makeFile()],
    groups: [makeGroup({ state: "SUGGESTED" })]
  });
}

test("group editing follows the Backend lock rules exactly", () => {
  const locked: AssetImportSessionState[] = ["PUBLISHING", "PUBLISHED", "FAILED", "CANCELLED"];
  for (const state of ASSET_IMPORT_SESSION_STATES) {
    const loaded = load(withGroup(state));
    assert.equal(isSessionLocked(loaded), locked.includes(state), state);
    assert.equal(canEditGroups(loaded, "group-1"), !locked.includes(state), state);
    assert.equal(canSubmitGroupMutation(loaded, "group-1"), !locked.includes(state), state);
  }
  // A published group can never be edited again, whatever the session state.
  const publishedGroup = load(groupedSession({ state: "PUBLISHED", crystalName: "白水晶" }));
  assert.equal(canEditGroups(publishedGroup, "group-1"), false);
  assert.equal(canSubmitGroupMutation(publishedGroup, "group-1"), false);
  // A group the server never returned carries no authority to edit.
  assert.equal(canEditGroups(publishedGroup, "group-missing"), false);
  assert.equal(canEditGroups(load(withGroup("NEEDS_REVIEW")), "group-missing"), false);
});

test("a terminal session never falls back to the upload step", () => {
  const published = load(sessionForState("PUBLISHED"));
  assert.equal(published.resolvedStep, "PROCESS_REVIEW_PUBLISH");
  assert.equal(published.polling, false);
  // Even a published session with no recorded checkpoint stays on the last step.
  const bare = load(
    makeSession({
      state: "PUBLISHED",
      lastVerifiedCheckpoint: null,
      files: [makeFile()],
      groups: [makeGroup({ state: "PUBLISHED", crystalName: "白水晶" })]
    })
  );
  assert.equal(bare.resolvedStep, "PROCESS_REVIEW_PUBLISH");
  for (const state of ["FAILED", "CANCELLED"] as const) {
    const terminal = load(sessionForState(state));
    assert.equal(terminal.polling, false, state);
    assert.equal(canSubmitGroupMutation(terminal, "group-1"), false, state);
  }
});

test("a partial upload failure lands on the retry step with a recovery notice", () => {
  const partial = load(sessionForState("PARTIALLY_FAILED"));
  assert.equal(partial.resolvedStep, "UPLOAD_FOLDER");
  assert.equal(partial.polling, false);
  const notice = partial.notices.find((item) => item.id === UPLOAD_FAILURE_NOTICE_ID);
  assert.ok(notice);
  assert.equal(notice.tone, "warning");
  assert.match(notice.message, /重试/);
  assert.match(notice.message, /1/);
  // Reloading a session without failures removes the stale recovery notice.
  const recovered = workflowReducer(partial, {
    type: "SESSION_LOADED",
    session: sessionForState("ARCHIVING"),
    syncedAt: RESYNCED_AT
  });
  assert.equal(
    recovered.notices.some((item) => item.id === UPLOAD_FAILURE_NOTICE_ID),
    false
  );
});

test("notices never leak archive keys, absolute paths or backend internals", () => {
  for (const state of ASSET_IMPORT_SESSION_STATES) {
    const loaded = load(sessionForState(state));
    const failed = workflowReducer(loaded, {
      type: "SESSION_FAILED",
      error: {
        code: "INTERNAL_ERROR",
        message: "connect ECONNREFUSED http://127.0.0.1:4000/api/admin/bead-import/sessions/session-1",
        retryable: true
      }
    });
    for (const notices of [loaded.notices, failed.notices]) {
      const blob = JSON.stringify(notices);
      assert.ok(!blob.includes("asset-archive"), state);
      assert.ok(!blob.includes("127.0.0.1"), state);
      assert.ok(!blob.includes("MYSTCRAG_ASSET_ARCHIVE_ROOT"), state);
      assert.ok(!blob.includes("x-admin-key"), state);
      assert.ok(!blob.includes("/Users/"), state);
      assert.ok(!/[A-Za-z]:\\\\/.test(blob), state);
    }
  }
});

test("polling never overwrites an unsaved human edit", () => {
  const loaded = load(groupedSession());
  const edited = workflowReducer(loaded, {
    type: "EDIT_GROUP",
    edit: { groupId: "group-1", crystalName: "紫水晶" }
  });
  assert.deepEqual(edited.localEdits["group-1"], {
    groupId: "group-1",
    baseRevision: 1,
    crystalName: "紫水晶"
  });
  assert.equal(groupRevisionFor(edited, "group-1"), 1);

  const moved = groupedSession({ revision: 3, crystalName: "海蓝宝", state: "NAMED" });
  const refreshed = workflowReducer(edited, {
    type: "SESSION_REFRESHED",
    session: moved,
    syncedAt: RESYNCED_AT
  });
  assert.deepEqual(refreshed.localEdits, edited.localEdits, "polling must not touch unsaved edits");
  assert.equal(refreshed.session?.groups[0]?.revision, 3, "the server stays authoritative for display");
  assert.equal(refreshed.session?.groups[0]?.crystalName, "海蓝宝");
  assert.deepEqual(refreshed.staleGroupIds, ["group-1"]);
  assert.equal(refreshed.lastSyncedAt, RESYNCED_AT);
  const stale = refreshed.notices.find((item) => item.id === STALE_GROUP_NOTICE_ID);
  assert.ok(stale);
  assert.equal(stale.tone, "warning");
  assert.equal(canSubmitGroupMutation(refreshed, "group-1"), false);

  // A quiet poll that changes nothing keeps the edit submittable and unstale.
  const quiet = workflowReducer(edited, {
    type: "SESSION_REFRESHED",
    session: groupedSession(),
    syncedAt: RESYNCED_AT
  });
  assert.deepEqual(quiet.localEdits, edited.localEdits);
  assert.deepEqual(quiet.staleGroupIds, []);
  assert.equal(canSubmitGroupMutation(quiet, "group-1"), true);
  assert.equal(
    quiet.notices.some((item) => item.id === STALE_GROUP_NOTICE_ID),
    false
  );
});

test("a revision conflict stops local submissions and demands a refresh", () => {
  const edited = workflowReducer(load(groupedSession()), {
    type: "EDIT_GROUP",
    edit: { groupId: "group-1", crystalName: "紫水晶" }
  });
  const started = workflowReducer(edited, { type: "GROUP_MUTATION_STARTED", groupId: "group-1" });
  assert.deepEqual(started.inFlightGroupIds, ["group-1"]);
  assert.equal(canSubmitGroupMutation(started, "group-1"), false);

  const conflicted = workflowReducer(started, { type: "GROUP_MUTATION_CONFLICT", groupId: "group-1" });
  assert.deepEqual(conflicted.inFlightGroupIds, []);
  assert.equal(conflicted.blockedByConflict, true);
  assert.equal(conflicted.refreshRequested, true);
  const notice = conflicted.notices.find((item) => item.id === CONFLICT_NOTICE_ID);
  assert.ok(notice);
  assert.equal(notice.tone, "danger");
  assert.equal(notice.message, CONFLICT_NOTICE_MESSAGE);
  assert.equal(canSubmitGroupMutation(conflicted, "group-1"), false);
  // A second conflict does not stack duplicate notices.
  const again = workflowReducer(
    workflowReducer(conflicted, { type: "GROUP_MUTATION_STARTED", groupId: "group-1" }),
    { type: "GROUP_MUTATION_CONFLICT", groupId: "group-1" }
  );
  assert.equal(
    again.notices.filter((item) => item.id === CONFLICT_NOTICE_ID).length,
    1
  );

  // The refresh the controller performs adopts the server revision but keeps the block.
  const reloaded = workflowReducer(conflicted, {
    type: "SESSION_LOADED",
    session: groupedSession({ revision: 4, crystalName: "海蓝宝", state: "NAMED" }),
    syncedAt: RESYNCED_AT
  });
  assert.equal(reloaded.refreshRequested, false);
  assert.equal(reloaded.blockedByConflict, true);
  assert.equal(groupRevisionFor(reloaded, "group-1"), 4);
  assert.equal(canSubmitGroupMutation(reloaded, "group-1"), false);

  const acknowledged = workflowReducer(reloaded, { type: "CONFLICT_ACKNOWLEDGED" });
  assert.equal(acknowledged.blockedByConflict, false);
  assert.deepEqual(acknowledged.staleGroupIds, []);
  assert.equal(
    acknowledged.notices.some((item) => item.id === CONFLICT_NOTICE_ID),
    false
  );
  assert.equal(
    acknowledged.notices.some((item) => item.id === STALE_GROUP_NOTICE_ID),
    false
  );
  assert.deepEqual(acknowledged.localEdits["group-1"], {
    groupId: "group-1",
    baseRevision: 4,
    crystalName: "紫水晶"
  });
  assert.equal(canSubmitGroupMutation(acknowledged, "group-1"), true);
});

test("applying a mutation adopts the returned revision without mutating the source", () => {
  const session = groupedSession();
  const edited = workflowReducer(load(session), {
    type: "EDIT_GROUP",
    edit: { groupId: "group-1", crystalName: "紫水晶", primaryFileId: "file-1" }
  });
  const started = workflowReducer(edited, { type: "GROUP_MUTATION_STARTED", groupId: "group-1" });
  const applied = workflowReducer(started, {
    type: "GROUP_MUTATION_APPLIED",
    groupId: "group-1",
    revision: 2
  });
  assert.deepEqual(applied.inFlightGroupIds, []);
  assert.equal(applied.localEdits["group-1"], undefined);
  assert.equal(groupRevisionFor(applied, "group-1"), 2);
  assert.equal(applied.session?.groups[0]?.revision, 2);
  assert.equal(session.groups[0]?.revision, 1, "the loaded session object must not be mutated");
  assert.deepEqual(applied.staleGroupIds, []);
  assert.equal(canSubmitGroupMutation(applied, "group-1"), true);
  // Applying also clears a stale flag raised by an earlier poll.
  const staleApplied = workflowReducer(
    workflowReducer(edited, {
      type: "SESSION_REFRESHED",
      session: groupedSession({ revision: 5 }),
      syncedAt: RESYNCED_AT
    }),
    { type: "GROUP_MUTATION_APPLIED", groupId: "group-1", revision: 6 }
  );
  assert.deepEqual(staleApplied.staleGroupIds, []);
});

test("navigation is bounded by verified progress and discarded on refresh", () => {
  const grouped = load(groupedSession());
  assert.equal(workflowReducer(grouped, { type: "REQUEST_STEP", step: "NAME_AND_CURATE" }).requestedStep, null);
  const back = workflowReducer(grouped, { type: "REQUEST_STEP", step: "UPLOAD_FOLDER" });
  assert.equal(currentWorkflowStep(back), "UPLOAD_FOLDER");

  const named = load(groupedSession({ state: "NAMED", crystalName: "白水晶" }));
  const forward = workflowReducer(named, { type: "REQUEST_STEP", step: "PROCESS_REVIEW_PUBLISH" });
  assert.equal(currentWorkflowStep(forward), "PROCESS_REVIEW_PUBLISH");
  // A refresh hands the landing decision back to the server.
  assert.equal(currentWorkflowStep(load(groupedSession({ state: "NAMED", crystalName: "白水晶" }))), "NAME_AND_CURATE");
});

test("edits without Backend authority are ignored and blank names clear the field", () => {
  const idle = initialWorkflowState("session-1");
  assert.deepEqual(workflowReducer(idle, { type: "EDIT_GROUP", edit: { groupId: "group-1", crystalName: "白水晶" } }).localEdits, {});

  const loaded = load(groupedSession());
  const unknown = workflowReducer(loaded, {
    type: "EDIT_GROUP",
    edit: { groupId: "group-missing", crystalName: "白水晶" }
  });
  assert.deepEqual(unknown.localEdits, {});

  const edited = workflowReducer(loaded, {
    type: "EDIT_GROUP",
    edit: { groupId: "group-1", crystalName: "紫水晶" }
  });
  const blanked = workflowReducer(edited, {
    type: "EDIT_GROUP",
    edit: { groupId: "group-1", crystalName: "   " }
  });
  assert.equal(blanked.localEdits["group-1"]?.crystalName, undefined);
  assert.equal(blanked.localEdits["group-1"]?.baseRevision, 1);

  const discarded = workflowReducer(edited, { type: "DISCARD_GROUP_EDIT", groupId: "group-1" });
  assert.equal(discarded.localEdits["group-1"], undefined);

  const dismissed = workflowReducer(load(sessionForState("PARTIALLY_FAILED")), {
    type: "DISMISS_NOTICE",
    noticeId: UPLOAD_FAILURE_NOTICE_ID
  });
  assert.equal(
    dismissed.notices.some((item) => item.id === UPLOAD_FAILURE_NOTICE_ID),
    false
  );
});

test("a stale edit re-bases onto the authoritative revision when the operator continues", () => {
  const edited = workflowReducer(load(groupedSession()), {
    type: "EDIT_GROUP",
    edit: { groupId: "group-1", crystalName: "紫水晶" }
  });
  const stale = workflowReducer(edited, {
    type: "SESSION_REFRESHED",
    session: groupedSession({ revision: 7 }),
    syncedAt: RESYNCED_AT
  });
  assert.deepEqual(stale.staleGroupIds, ["group-1"]);
  const continued = workflowReducer(stale, {
    type: "EDIT_GROUP",
    edit: { groupId: "group-1", crystalName: "紫水晶" }
  });
  assert.deepEqual(continued.staleGroupIds, []);
  assert.equal(continued.localEdits["group-1"]?.baseRevision, 7);
  assert.equal(
    continued.notices.some((item) => item.id === STALE_GROUP_NOTICE_ID),
    false
  );
  assert.equal(canSubmitGroupMutation(continued, "group-1"), true);
});
