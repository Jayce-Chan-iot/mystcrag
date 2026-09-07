import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  UpdateBeadImageGroupRequestSchema,
  type AssetImportSessionGroupView,
  type AssetImportSessionResponse,
  type UpdateBeadImageGroupRequest,
  type UpdateBeadImageGroupResponse
} from "@mystcrag/design-contract";

import { BeadImportApiError } from "./api-client";
import type { AbortSignalLike } from "./session-lifecycle";
import {
  CONFLICT_NOTICE_MESSAGE,
  STALE_GROUP_NOTICE_MESSAGE,
  initialWorkflowState,
  workflowReducer,
  type BeadImportWorkflowState,
  type WorkflowAction
} from "./workflow-state";

import {
  GROUP_REFUSAL_MESSAGES,
  buildGroupMutation,
  createGroupLoader,
  type GroupLoader,
  type GroupMutationInput,
  type GroupRefusalReason,
  type GroupSubmitResult
} from "./group-loader";

const FORBIDDEN_LEAKS = [
  "archiveKey",
  "storageKey",
  "x-admin-key",
  "MYSTCRAG_ASSET_ADMIN_KEY",
  "ASSET_ADMIN_API_KEY",
  "MYSTCRAG_BACKEND_ORIGIN",
  "127.0.0.1",
  "localhost",
  "/Users/",
  "C:\\",
  "ECONNREFUSED",
  "prisma",
  "postgres",
  "process.env",
  "document.cookie",
  "localStorage",
  "sessionStorage"
];

const SYNCED_AT = "2026-09-06T09:00:00.000Z";
const RESYNCED_AT = "2026-09-06T09:00:30.000Z";

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
    state: "NEEDS_REVIEW",
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:05:00.000Z",
    lastVerifiedCheckpoint: null,
    declaredFileCount: 2,
    uploadedFileCount: 2,
    archivedFileCount: 2,
    failedFileCount: 0,
    declaredBytes: 4096,
    uploadedBytes: 4096,
    files: [],
    groups: [makeGroup()],
    ...overrides
  };
}

function applied(groupId: string, revision: number): UpdateBeadImageGroupResponse {
  return { groupId, state: "NAMED", revision, memberFileIds: ["file-1"] };
}

type RecordedUpdate = {
  groupId: string;
  request: UpdateBeadImageGroupRequest;
  signal: AbortSignalLike | undefined;
};

type Harness = {
  loader: GroupLoader;
  dispatch(action: WorkflowAction): void;
  dispatched: WorkflowAction[];
  updates: RecordedUpdate[];
  types(): WorkflowAction["type"][];
  latest(): BeadImportWorkflowState;
  readonly sessionCalls: number;
  readonly aborted: number;
  setUpdateResult(result: UpdateBeadImageGroupResponse | Error | null): void;
  setSessionResult(session: AssetImportSessionResponse | Error): void;
  releaseUpdate(result: UpdateBeadImageGroupResponse | Error): void;
};

function makeHarness(options: { gateUpdate?: boolean; session?: AssetImportSessionResponse } = {}): Harness {
  const dispatch = (action: WorkflowAction): void => {
    dispatched.push(action);
    current = workflowReducer(current, action);
  };
  const dispatched: WorkflowAction[] = [];
  const updates: RecordedUpdate[] = [];
  let current = workflowReducer(initialWorkflowState("session-1"), {
    type: "SESSION_LOADED",
    session: options.session ?? makeSession(),
    syncedAt: SYNCED_AT
  });
  let sessionCalls = 0;
  let aborted = 0;
  let updateResult: UpdateBeadImageGroupResponse | Error | null = null;
  let refreshedSession: AssetImportSessionResponse | Error = makeSession({ updatedAt: RESYNCED_AT });
  let gate: ((result: UpdateBeadImageGroupResponse | Error) => void) | null = null;

  const loader = createGroupLoader({
    getState: () => current,
    dispatch,
    now: () => RESYNCED_AT,
    createAbortController: () => {
      let abortedLocally = false;
      return {
        signal: {
          get aborted() {
            return abortedLocally;
          }
        },
        abort: () => {
          abortedLocally = true;
          aborted += 1;
        }
      };
    },
    client: {
      async updateGroup(groupId, request, requestOptions) {
        updates.push({ groupId, request, signal: requestOptions?.signal });
        if (options.gateUpdate === true) {
          assert.equal(gate, null, "only one gated update may be in flight");
          const result = await new Promise<UpdateBeadImageGroupResponse | Error>((resolve) => {
            gate = resolve;
          });
          gate = null;
          if (result instanceof Error) {
            throw result;
          }
          return result;
        }
        if (updateResult instanceof Error) {
          throw updateResult;
        }
        if (updateResult !== null) {
          return updateResult;
        }
        return applied(groupId, request.expectedGroupRevision + 1);
      },
      async getSession(sessionId, requestOptions) {
        sessionCalls += 1;
        assert.equal(sessionId, "session-1");
        assert.equal(requestOptions?.signal !== undefined, true);
        if (refreshedSession instanceof Error) {
          throw refreshedSession;
        }
        return refreshedSession;
      }
    }
  });

  return {
    loader,
    dispatch,
    dispatched,
    updates,
    types() {
      return dispatched.map((action) => action.type);
    },
    latest() {
      return current;
    },
    get sessionCalls() {
      return sessionCalls;
    },
    get aborted() {
      return aborted;
    },
    setUpdateResult(result) {
      updateResult = result;
    },
    setSessionResult(session) {
      refreshedSession = session;
    },
    releaseUpdate(result) {
      const release = gate;
      gate = null;
      assert.ok(release !== null, "an update must be in flight before it is released");
      release(result);
    }
  };
}

function refusalOf(result: GroupSubmitResult): GroupRefusalReason {
  assert.equal(result.outcome, "REFUSED");
  return result.reason;
}

function messageOf(result: GroupSubmitResult): string {
  assert.ok(result.outcome === "REFUSED" || result.outcome === "FAILED");
  return result.message;
}

/** One microtask hop is not enough: the loader resumes through several awaited hops. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test("each of the six group mutations builds the exact contract body", () => {
  const cases: [GroupMutationInput, Record<string, unknown>][] = [
    [{ action: "SET_NAME", crystalName: "紫水晶 8mm" }, { crystalName: "紫水晶 8mm" }],
    [{ action: "MERGE_GROUPS", sourceGroupIds: ["group-1", "group-2"] }, { sourceGroupIds: ["group-1", "group-2"] }],
    [{ action: "SPLIT_GROUP", partitions: [["file-1"], ["file-2"]] }, { partitions: [["file-1"], ["file-2"]] }],
    [
      { action: "MOVE_FILES", fileIds: ["file-2"], targetGroupId: "group-3" },
      { fileIds: ["file-2"], targetGroupId: "group-3" }
    ],
    [{ action: "SET_PRIMARY", primaryFileId: "file-1" }, { primaryFileId: "file-1" }],
    [
      { action: "IGNORE_FILES", fileIds: ["file-1"], reason: "重复拍摄的同一颗珠子" },
      { fileIds: ["file-1"], reason: "重复拍摄的同一颗珠子" }
    ]
  ];

  for (const [input, extra] of cases) {
    const request = buildGroupMutation(input, 7);
    assert.deepEqual(request, { action: input.action, expectedGroupRevision: 7, ...extra });
    assert.equal(
      UpdateBeadImageGroupRequestSchema.safeParse(request).success,
      true,
      `${input.action} must satisfy the contract`
    );
  }
});

test("a submitted mutation carries the revision of the authoritative session", async () => {
  const harness = makeHarness({ session: makeSession({ groups: [makeGroup({ revision: 5 })] }) });

  const result = await harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });

  assert.equal(result.outcome, "APPLIED");
  assert.equal(harness.updates.length, 1);
  assert.deepEqual(harness.updates[0]?.request, {
    action: "SET_NAME",
    expectedGroupRevision: 5,
    crystalName: "白水晶"
  });
});

test("a locked session refuses every mutation without a request", async () => {
  const harness = makeHarness({ session: makeSession({ state: "PUBLISHED" }) });

  const result = await harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });

  assert.equal(refusalOf(result), "GROUP_LOCKED");
  assert.equal(messageOf(result), GROUP_REFUSAL_MESSAGES.GROUP_LOCKED);
  assert.deepEqual(harness.updates, []);
  assert.deepEqual(harness.types(), []);
  assert.equal(harness.sessionCalls, 0);
});

test("a group the session no longer reports is refused, not invented", async () => {
  const harness = makeHarness();

  const result = await harness.loader.submit("group-missing", { action: "SET_NAME", crystalName: "白水晶" });

  assert.equal(refusalOf(result), "UNKNOWN_GROUP");
  assert.deepEqual(harness.updates, []);
  assert.deepEqual(harness.types(), []);
  assert.equal(harness.sessionCalls, 0);
});

test("an unloaded session refuses every mutation", async () => {
  const harness = makeHarness();
  const loader = createGroupLoader({
    getState: () => initialWorkflowState("session-1"),
    dispatch: harness.dispatch,
    now: () => RESYNCED_AT,
    createAbortController: () => ({ signal: { aborted: false }, abort: () => {} }),
    client: {
      updateGroup: async () => {
        throw new Error("an unloaded session must never reach the Backend");
      },
      getSession: async () => {
        throw new Error("an unloaded session must never reach the Backend");
      }
    }
  });

  const result = await loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });

  assert.equal(refusalOf(result), "NO_SESSION");
  assert.deepEqual(harness.types(), []);
});

test("a name that is only whitespace never reaches the Backend", async () => {
  const harness = makeHarness();

  const result = await harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "   " });

  assert.equal(refusalOf(result), "EMPTY_NAME");
  assert.equal(messageOf(result), GROUP_REFUSAL_MESSAGES.EMPTY_NAME);
  assert.deepEqual(harness.updates, []);
});

test("a known conflict blocks every later submission until it is acknowledged", async () => {
  const harness = makeHarness();
  harness.dispatch({ type: "GROUP_MUTATION_CONFLICT", groupId: "group-1" });

  const result = await harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });

  assert.equal(refusalOf(result), "CONFLICT_BLOCKED");
  assert.equal(messageOf(result), CONFLICT_NOTICE_MESSAGE);
  assert.deepEqual(harness.updates, []);
});

test("a group whose local edit predates the server revision is refused as stale", async () => {
  const harness = makeHarness({ session: makeSession({ groups: [makeGroup({ revision: 4 })] }) });
  harness.dispatch({ type: "EDIT_GROUP", edit: { groupId: "group-1", crystalName: "旧名字" } });
  harness.dispatch({
    type: "SESSION_REFRESHED",
    session: makeSession({ groups: [makeGroup({ revision: 9 })], updatedAt: RESYNCED_AT }),
    syncedAt: RESYNCED_AT
  });

  const result = await harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });

  assert.equal(refusalOf(result), "STALE");
  assert.equal(messageOf(result), STALE_GROUP_NOTICE_MESSAGE);
  assert.deepEqual(harness.updates, []);
});

test("a second submission for the same in-flight group is refused", async () => {
  const harness = makeHarness({ gateUpdate: true });
  const running = harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });
  await settled();

  const second = await harness.loader.submit("group-1", { action: "SET_PRIMARY", primaryFileId: "file-1" });

  assert.equal(refusalOf(second), "IN_FLIGHT");
  assert.equal(harness.updates.length, 1);
  harness.releaseUpdate(applied("group-1", 2));
  assert.equal((await running).outcome, "APPLIED");
});

test("an applied mutation reports the server revision and then re-reads the session", async () => {
  const harness = makeHarness();
  harness.setUpdateResult({
    groupId: "group-1",
    state: "NAMED",
    revision: 12,
    memberFileIds: ["file-1"],
    crystalName: "白水晶"
  });

  const result = await harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });

  assert.ok(result.outcome === "APPLIED");
  assert.equal(result.revision, 12);
  assert.deepEqual(harness.types(), ["GROUP_MUTATION_STARTED", "GROUP_MUTATION_APPLIED", "SESSION_REFRESHED"]);
  const appliedAction = harness.dispatched[1];
  assert.ok(appliedAction !== undefined && appliedAction.type === "GROUP_MUTATION_APPLIED");
  assert.equal(appliedAction.revision, 12, "the reported revision is the server's, not the one asked for");
  assert.equal(harness.sessionCalls, 1);
  const state = harness.latest();
  assert.deepEqual(state.localEdits, {});
  assert.deepEqual(state.inFlightGroupIds, []);
  assert.equal(state.lastSyncedAt, RESYNCED_AT);
  assert.equal(state.session?.groups[0]?.revision, 1, "the re-read stays authoritative over the patch");
});

test("a merge is followed by a session re-read so no member file is lost", async () => {
  const harness = makeHarness({
    session: makeSession({
      groups: [makeGroup(), makeGroup({ groupId: "group-2", memberFileIds: ["file-2"], revision: 3 })]
    })
  });
  harness.setSessionResult(
    makeSession({
      updatedAt: RESYNCED_AT,
      groups: [makeGroup({ revision: 2, memberFileIds: ["file-1", "file-2"] })]
    })
  );

  await harness.loader.submit("group-1", { action: "MERGE_GROUPS", sourceGroupIds: ["group-1", "group-2"] });

  assert.equal(harness.sessionCalls, 1, "membership is only authoritative after a re-read");
  const groups = harness.latest().session?.groups ?? [];
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.memberFileIds, ["file-1", "file-2"]);
});

test("a 409 stops local submission, re-reads the session and says the data changed", async () => {
  const harness = makeHarness();
  harness.setUpdateResult(
    new BeadImportApiError({
      code: "CONFLICT",
      status: 409,
      message: "服务端数据已更新，请确认后重试。",
      retryable: false
    })
  );

  const result = await harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });

  assert.equal(result.outcome, "CONFLICT");
  assert.deepEqual(harness.types(), ["GROUP_MUTATION_STARTED", "GROUP_MUTATION_CONFLICT", "SESSION_REFRESHED"]);
  assert.equal(harness.sessionCalls, 1);
  const state = harness.latest();
  assert.equal(state.blockedByConflict, true);
  assert.deepEqual(state.inFlightGroupIds, []);
  assert.equal(
    state.notices.some((notice) => notice.message === CONFLICT_NOTICE_MESSAGE && notice.tone === "danger"),
    true
  );
  assert.equal(state.session?.groups[0]?.revision, 1, "a conflict must never patch a refused revision");
});

test("any other failure keeps the server revision and frees the group again", async () => {
  const harness = makeHarness();
  harness.setUpdateResult(
    new BeadImportApiError({
      code: "INTERNAL_ERROR",
      status: 500,
      message: "珠子素材导入服务暂时不可用。",
      retryable: true
    })
  );

  const result = await harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });

  assert.ok(result.outcome === "FAILED");
  assert.equal(result.code, "INTERNAL_ERROR");
  assert.equal(result.retryable, true);
  assert.equal(messageOf(result), "珠子素材导入服务暂时不可用。");
  assert.deepEqual(harness.types(), ["GROUP_MUTATION_STARTED", "GROUP_MUTATION_FAILED"]);
  assert.equal(harness.sessionCalls, 0, "a failure is not a reason to re-read the session");
  const state = harness.latest();
  assert.deepEqual(state.inFlightGroupIds, [], "a failed group must be editable again");
  assert.equal(state.blockedByConflict, false);
  assert.equal(state.session?.groups[0]?.revision, 1);
  assert.equal(state.notices.some((notice) => notice.id === "group-mutation-failure:group-1"), true);
});

test("an unexpected transport throw is reported without echoing its detail", async () => {
  const harness = makeHarness();
  harness.setUpdateResult(
    new TypeError("fetch failed: connect ECONNREFUSED http://127.0.0.1:4000/api/admin/bead-import/groups")
  );

  const result = await harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });

  assert.ok(result.outcome === "FAILED");
  assert.equal(result.code, "NETWORK_ERROR");
  const message = result.message;
  assert.ok(message !== "");
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.ok(!message.includes(forbidden), `${message} must not mention ${forbidden}`);
  }
});

test("a failing session re-read after an applied mutation still reports the application", async () => {
  const harness = makeHarness();
  harness.setSessionResult(
    new BeadImportApiError({
      code: "UNAUTHORIZED",
      status: 401,
      message: "管理员会话已失效，请重新登录。",
      retryable: false
    })
  );

  const result = await harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });

  assert.equal(result.outcome, "APPLIED");
  const state = harness.latest();
  assert.equal(state.status, "ERROR");
  assert.deepEqual(state.inFlightGroupIds, []);
  assert.deepEqual(harness.types(), ["GROUP_MUTATION_STARTED", "GROUP_MUTATION_APPLIED", "SESSION_FAILED"]);
});

test("cancelling aborts the in-flight mutation and reports nothing afterwards", async () => {
  const harness = makeHarness({ gateUpdate: true });
  const running = harness.loader.submit("group-1", { action: "SET_NAME", crystalName: "白水晶" });
  await settled();
  assert.equal(harness.updates.length, 1);

  harness.loader.cancel();
  assert.equal(harness.aborted, 1);
  const dispatchedBefore = harness.dispatched.length;
  harness.releaseUpdate(applied("group-1", 2));
  const result = await running;

  assert.equal(result.outcome, "CANCELLED");
  assert.equal(harness.dispatched.length, dispatchedBefore, "an unmounted loader must not dispatch");
  assert.equal(harness.sessionCalls, 0);
});

test("every refusal reason has operator copy and none of it leaks", () => {
  const reasons: GroupRefusalReason[] = [
    "NO_SESSION",
    "UNKNOWN_GROUP",
    "GROUP_LOCKED",
    "CONFLICT_BLOCKED",
    "IN_FLIGHT",
    "STALE",
    "EMPTY_NAME"
  ];
  assert.deepEqual(Object.keys(GROUP_REFUSAL_MESSAGES).sort(), [...reasons].sort());
  for (const reason of reasons) {
    const message = GROUP_REFUSAL_MESSAGES[reason];
    assert.ok(message.trim() !== "");
    for (const forbidden of FORBIDDEN_LEAKS) {
      assert.ok(!message.includes(forbidden));
    }
  }
});

test("the loader holds no transport detail and no configuration of its own", () => {
  const source = readFileSync(join(__dirname, "group-loader.ts"), "utf8");
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.ok(!source.includes(forbidden), `group-loader.ts must not mention ${forbidden}`);
  }
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("XMLHttpRequest"), false);
  assert.ok(source.includes("groupSubmissionBlocker"), "the guard must come from the workflow state");
  assert.ok(source.includes("groupRevisionFor"), "the revision must come from the workflow state");
  assert.ok(source.includes("expectedGroupRevision"));
});
