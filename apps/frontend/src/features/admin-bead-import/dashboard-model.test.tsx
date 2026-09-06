import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSET_IMPORT_SESSION_STATES,
  AssetImportSessionSummarySchema,
  type AssetImportSessionResponse,
  type AssetImportSessionState,
  type AssetImportSessionSummary
} from "@mystcrag/design-contract";

import { allGroupsNamed, resolveWorkflowStep } from "./workflow-model";

import {
  DASHBOARD_BUCKETS,
  DASHBOARD_BUCKET_LABELS,
  DASHBOARD_DEFAULT_LIMIT,
  SESSION_STATE_FILTERS,
  bucketForSessionSummary,
  dashboardReducer,
  groupSessionsByBucket,
  initialDashboardState,
  sessionStateLabel,
  summaryRecovery
} from "./dashboard-model";

const FORBIDDEN_CLAIMS = ["功效", "疗效", "治疗", "保证", "转运", "招财", "辟邪", "旺财"];
const FORBIDDEN_LEAKS = [
  "archiveKey",
  "asset-archive",
  "x-admin-key",
  "MYSTCRAG_ASSET_ADMIN_KEY",
  "ASSET_ADMIN_API_KEY",
  "MYSTCRAG_BACKEND_ORIGIN",
  "127.0.0.1",
  "/Users/",
  "localhost"
];

function makeSummary(overrides: Partial<AssetImportSessionSummary> = {}): AssetImportSessionSummary {
  return {
    sessionId: "session-1",
    state: "CREATED",
    lastVerifiedCheckpoint: null,
    declaredFileCount: 0,
    archivedFileCount: 0,
    failedFileCount: 0,
    groupCount: 0,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:05:00.000Z",
    ...overrides
  };
}

function assertClean(value: string, context: string): void {
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.ok(!value.includes(forbidden), `${context} must not mention ${forbidden}`);
  }
  for (const forbidden of FORBIDDEN_CLAIMS) {
    assert.ok(!value.includes(forbidden), `${context} must not promise ${forbidden}`);
  }
}

test("the fixture builder produces contract valid summaries", () => {
  const result = AssetImportSessionSummarySchema.safeParse(
    makeSummary({ state: "NEEDS_REVIEW", lastVerifiedCheckpoint: "GROUPED", groupCount: 3 })
  );
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
});

test("the dashboard exposes exactly the six operator facing buckets", () => {
  assert.deepEqual(DASHBOARD_BUCKETS, [
    "IN_FLIGHT",
    "AWAITING_NAMES",
    "AWAITING_PROCESSING",
    "AWAITING_REVIEW",
    "PUBLISHED",
    "NEEDS_ATTENTION"
  ]);
  for (const bucket of DASHBOARD_BUCKETS) {
    const label = DASHBOARD_BUCKET_LABELS[bucket];
    assert.ok(label.title.length > 0, `${bucket} needs a title`);
    assert.ok(label.hint.length > 0, `${bucket} needs a hint`);
    assertClean(label.title, `${bucket} title`);
    assertClean(label.hint, `${bucket} hint`);
  }
});

test("every session state lands in exactly one bucket", () => {
  const expectations: Record<AssetImportSessionState, string> = {
    CREATED: "IN_FLIGHT",
    UPLOADING: "IN_FLIGHT",
    ARCHIVING: "IN_FLIGHT",
    PROCESSING: "IN_FLIGHT",
    PUBLISHING: "IN_FLIGHT",
    NEEDS_REVIEW: "AWAITING_NAMES",
    READY_TO_PUBLISH: "AWAITING_REVIEW",
    PUBLISHED: "PUBLISHED",
    PARTIALLY_FAILED: "NEEDS_ATTENTION",
    FAILED: "NEEDS_ATTENTION",
    CANCELLED: "NEEDS_ATTENTION"
  };
  for (const state of ASSET_IMPORT_SESSION_STATES) {
    assert.equal(
      bucketForSessionSummary(makeSummary({ state })),
      expectations[state],
      `bucket for ${state} without a checkpoint`
    );
  }
});

test("a NEEDS_REVIEW session is bucketed by its verified checkpoint", () => {
  assert.equal(
    bucketForSessionSummary(makeSummary({ state: "NEEDS_REVIEW", lastVerifiedCheckpoint: null })),
    "AWAITING_NAMES"
  );
  assert.equal(
    bucketForSessionSummary(makeSummary({ state: "NEEDS_REVIEW", lastVerifiedCheckpoint: "ARCHIVED" })),
    "AWAITING_NAMES"
  );
  assert.equal(
    bucketForSessionSummary(makeSummary({ state: "NEEDS_REVIEW", lastVerifiedCheckpoint: "GROUPED" })),
    "AWAITING_NAMES"
  );
  assert.equal(
    bucketForSessionSummary(makeSummary({ state: "NEEDS_REVIEW", lastVerifiedCheckpoint: "LABELED" })),
    "AWAITING_PROCESSING"
  );
  assert.equal(
    bucketForSessionSummary(makeSummary({ state: "NEEDS_REVIEW", lastVerifiedCheckpoint: "PROCESSED" })),
    "AWAITING_REVIEW"
  );
  assert.equal(
    bucketForSessionSummary(makeSummary({ state: "NEEDS_REVIEW", lastVerifiedCheckpoint: "REVIEWED" })),
    "AWAITING_REVIEW"
  );
});

test("a partially failed session that reached review still demands attention first", () => {
  assert.equal(
    bucketForSessionSummary(
      makeSummary({ state: "PARTIALLY_FAILED", lastVerifiedCheckpoint: "PROCESSED", failedFileCount: 2 })
    ),
    "NEEDS_ATTENTION"
  );
  assert.equal(
    bucketForSessionSummary(makeSummary({ state: "PROCESSING", lastVerifiedCheckpoint: "LABELED" })),
    "IN_FLIGHT"
  );
  // A published session is never re-bucketed by an older checkpoint.
  assert.equal(
    bucketForSessionSummary(makeSummary({ state: "PUBLISHED", lastVerifiedCheckpoint: "ARCHIVED" })),
    "PUBLISHED"
  );
});

test("bucketing keeps every bucket addressable and preserves list order", () => {
  const sessions = [
    makeSummary({ sessionId: "s-1", state: "UPLOADING" }),
    makeSummary({ sessionId: "s-2", state: "NEEDS_REVIEW", lastVerifiedCheckpoint: "GROUPED" }),
    makeSummary({ sessionId: "s-3", state: "PUBLISHED", lastVerifiedCheckpoint: "PUBLISHED" }),
    makeSummary({ sessionId: "s-4", state: "FAILED" })
  ];
  const grouped = groupSessionsByBucket(sessions);
  assert.deepEqual(Object.keys(grouped).sort(), [...DASHBOARD_BUCKETS].sort());
  assert.deepEqual(grouped.IN_FLIGHT.map((session) => session.sessionId), ["s-1"]);
  assert.deepEqual(grouped.AWAITING_NAMES.map((session) => session.sessionId), ["s-2"]);
  assert.deepEqual(grouped.PUBLISHED.map((session) => session.sessionId), ["s-3"]);
  assert.deepEqual(grouped.NEEDS_ATTENTION.map((session) => session.sessionId), ["s-4"]);
  assert.deepEqual(grouped.AWAITING_PROCESSING, []);
  assert.deepEqual(grouped.AWAITING_REVIEW, []);
  assert.deepEqual(groupSessionsByBucket([]).IN_FLIGHT, []);
});

test("only a partially failed session offers a recovery entry", () => {
  const attention = summaryRecovery(makeSummary({ state: "PARTIALLY_FAILED", failedFileCount: 2 }));
  assert.ok(attention !== null);
  assert.equal(attention.resumable, true);
  assert.match(attention.label, /重试/);
  assert.match(attention.label, /2/);

  for (const state of ["FAILED", "CANCELLED"] as const) {
    const closed = summaryRecovery(makeSummary({ state }));
    assert.ok(closed !== null);
    assert.equal(closed.resumable, false);
    assert.match(closed.label, /原因/);
    assertClean(closed.label, `${state} recovery label`);
  }

  for (const state of ["CREATED", "UPLOADING", "NEEDS_REVIEW", "PUBLISHED"] as const) {
    assert.equal(summaryRecovery(makeSummary({ state })), null);
  }
});

test("the state filter covers every contract state plus an all option", () => {
  const values = SESSION_STATE_FILTERS.map((filter) => filter.value);
  assert.equal(values[0], "ALL");
  assert.deepEqual(values.slice(1), [...ASSET_IMPORT_SESSION_STATES]);
  for (const filter of SESSION_STATE_FILTERS) {
    assert.ok(filter.label.length > 0, `${filter.value} needs a label`);
    assertClean(filter.label, `${filter.value} filter label`);
  }
  for (const state of ASSET_IMPORT_SESSION_STATES) {
    assert.equal(sessionStateLabel(state), SESSION_STATE_FILTERS.find((f) => f.value === state)?.label);
    assertClean(sessionStateLabel(state), `${state} label`);
  }
});

test("dashboard buckets never contradict the four step workflow", () => {
  const groups = (crystalName?: string) => [
    {
      groupId: "group-1",
      state: crystalName === undefined ? ("SUGGESTED" as const) : ("NAMED" as const),
      memberFileIds: ["file-1"],
      revision: 1,
      processedAssets: [],
      crystalDraft: null,
      crystalName
    }
  ];
  const base: AssetImportSessionResponse = {
    sessionId: "session-1",
    state: "NEEDS_REVIEW",
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:05:00.000Z",
    lastVerifiedCheckpoint: "GROUPED",
    declaredFileCount: 1,
    uploadedFileCount: 1,
    archivedFileCount: 1,
    failedFileCount: 0,
    declaredBytes: 2048,
    uploadedBytes: 2048,
    files: [],
    groups: groups() as AssetImportSessionResponse["groups"]
  };
  const cases: { session: AssetImportSessionResponse; bucket: string }[] = [
    { session: { ...base, state: "UPLOADING", lastVerifiedCheckpoint: null, groups: [] }, bucket: "IN_FLIGHT" },
    { session: base, bucket: "AWAITING_NAMES" },
    {
      session: {
        ...base,
        lastVerifiedCheckpoint: "LABELED",
        groups: groups("白水晶") as AssetImportSessionResponse["groups"]
      },
      bucket: "AWAITING_PROCESSING"
    },
    {
      session: { ...base, state: "PROCESSING", lastVerifiedCheckpoint: "LABELED", groups: groups("白水晶") as AssetImportSessionResponse["groups"] },
      bucket: "IN_FLIGHT"
    },
    {
      session: { ...base, state: "READY_TO_PUBLISH", lastVerifiedCheckpoint: "REVIEWED", groups: groups("白水晶") as AssetImportSessionResponse["groups"] },
      bucket: "AWAITING_REVIEW"
    },
    {
      session: { ...base, state: "PUBLISHED", lastVerifiedCheckpoint: "PUBLISHED", groups: groups("白水晶") as AssetImportSessionResponse["groups"] },
      bucket: "PUBLISHED"
    },
    { session: { ...base, state: "PARTIALLY_FAILED", failedFileCount: 1 }, bucket: "NEEDS_ATTENTION" }
  ];
  for (const { session, bucket } of cases) {
    const step = resolveWorkflowStep(session);
    const named = allGroupsNamed(session.groups);
    assert.equal(bucketForSessionSummary(summaryOf(session)), bucket, `state ${session.state}`);
    if (bucket === "AWAITING_NAMES") {
      assert.ok(step === "REVIEW_GROUPS" || (step === "NAME_AND_CURATE" && !named));
    }
    if (bucket === "AWAITING_PROCESSING") {
      assert.equal(step, "NAME_AND_CURATE");
      assert.equal(named, true);
    }
    if (bucket === "AWAITING_REVIEW" || bucket === "PUBLISHED") {
      assert.equal(step, "PROCESS_REVIEW_PUBLISH");
    }
  }
});

function summaryOf(session: AssetImportSessionResponse): AssetImportSessionSummary {
  return makeSummary({
    sessionId: session.sessionId,
    state: session.state,
    lastVerifiedCheckpoint: session.lastVerifiedCheckpoint,
    declaredFileCount: session.declaredFileCount,
    archivedFileCount: session.archivedFileCount,
    failedFileCount: session.failedFileCount,
    groupCount: session.groups.length
  });
}

test("the dashboard starts idle and announces loading before any data exists", () => {
  const state = initialDashboardState();
  assert.equal(state.status, "IDLE");
  assert.deepEqual(state.sessions, []);
  assert.equal(state.filter, "ALL");
  assert.equal(state.limit, DASHBOARD_DEFAULT_LIMIT);
  assert.equal(state.nextCursor, null);
  assert.equal(state.error, null);

  const loading = dashboardReducer(state, { type: "LOAD_STARTED" });
  assert.equal(loading.status, "LOADING");
  assert.deepEqual(loading.sessions, []);
});

test("a successful load replaces the page and records the sync time", () => {
  const sessions = [makeSummary({ sessionId: "s-1", state: "UPLOADING" })];
  const state = dashboardReducer(initialDashboardState(), { type: "LOAD_STARTED" });
  const loaded = dashboardReducer(state, {
    type: "LOAD_SUCCEEDED",
    sessions,
    nextCursor: "s-2",
    syncedAt: "2026-09-06T09:00:00.000Z"
  });
  assert.equal(loaded.status, "READY");
  assert.deepEqual(loaded.sessions, sessions);
  assert.equal(loaded.nextCursor, "s-2");
  assert.equal(loaded.syncedAt, "2026-09-06T09:00:00.000Z");
  assert.equal(loaded.error, null);
});

test("loading more appends the next page without duplicating a session", () => {
  let state = dashboardReducer(initialDashboardState(), { type: "LOAD_STARTED" });
  state = dashboardReducer(state, {
    type: "LOAD_SUCCEEDED",
    sessions: [makeSummary({ sessionId: "s-1" })],
    nextCursor: "s-1",
    syncedAt: "2026-09-06T09:00:00.000Z"
  });
  state = dashboardReducer(state, { type: "LOAD_MORE_STARTED" });
  assert.equal(state.status, "LOADING_MORE");
  assert.equal(state.sessions.length, 1);
  state = dashboardReducer(state, {
    type: "APPEND_SUCCEEDED",
    sessions: [makeSummary({ sessionId: "s-1" }), makeSummary({ sessionId: "s-2" })],
    nextCursor: null,
    syncedAt: "2026-09-06T09:01:00.000Z"
  });
  assert.equal(state.status, "READY");
  assert.deepEqual(state.sessions.map((session) => session.sessionId), ["s-1", "s-2"]);
  assert.equal(state.nextCursor, null);
});

test("changing the filter drops the previous page and its cursor", () => {
  let state = dashboardReducer(initialDashboardState(), { type: "LOAD_STARTED" });
  state = dashboardReducer(state, {
    type: "LOAD_SUCCEEDED",
    sessions: [makeSummary({ state: "PUBLISHED", lastVerifiedCheckpoint: "PUBLISHED" })],
    nextCursor: "s-9",
    syncedAt: "2026-09-06T09:00:00.000Z"
  });
  const filtered = dashboardReducer(state, { type: "FILTER_CHANGED", state: "NEEDS_REVIEW" });
  assert.equal(filtered.filter, "NEEDS_REVIEW");
  assert.equal(filtered.status, "LOADING");
  assert.deepEqual(filtered.sessions, []);
  assert.equal(filtered.nextCursor, null);
  assert.equal(filtered.error, null);

  const sameFilter = dashboardReducer(filtered, { type: "FILTER_CHANGED", state: "NEEDS_REVIEW" });
  assert.equal(sameFilter, filtered, "re-selecting the current filter must not clear the page again");
});

test("an expired admin session is reported as a permission failure, not a generic error", () => {
  const state = dashboardReducer(initialDashboardState(), { type: "LOAD_STARTED" });
  const unauthorized = dashboardReducer(state, {
    type: "LOAD_FAILED",
    code: "UNAUTHORIZED",
    message: "管理员会话已失效，请重新登录。",
    retryable: false
  });
  assert.equal(unauthorized.status, "UNAUTHORIZED");
  assert.equal(unauthorized.error?.code, "UNAUTHORIZED");
  assert.equal(unauthorized.error?.retryable, false);
  assert.match(unauthorized.error?.message ?? "", /重新登录/);
  assertClean(unauthorized.error?.message ?? "", "unauthorized copy");
});

test("a transport outage stays retryable and keeps the last known page", () => {
  const sessions = [makeSummary({ sessionId: "s-1" })];
  let state = dashboardReducer(initialDashboardState(), { type: "LOAD_STARTED" });
  state = dashboardReducer(state, {
    type: "LOAD_SUCCEEDED",
    sessions,
    nextCursor: null,
    syncedAt: "2026-09-06T09:00:00.000Z"
  });
  state = dashboardReducer(state, { type: "LOAD_STARTED" });
  const failed = dashboardReducer(state, {
    type: "LOAD_FAILED",
    code: "NETWORK_ERROR",
    message: "无法连接珠子素材导入服务，请稍后重试。",
    retryable: true
  });
  assert.equal(failed.status, "ERROR");
  assert.equal(failed.error?.retryable, true);
  assert.deepEqual(failed.sessions, sessions, "a refresh failure must not erase the visible page");
  assertClean(failed.error?.message ?? "", "network copy");
});

test("a contract violation is surfaced as retryable false and never names the field", () => {
  const failed = dashboardReducer(initialDashboardState(), {
    type: "LOAD_FAILED",
    code: "CONTRACT_VIOLATION",
    message: "服务返回的数据不符合契约。",
    retryable: false
  });
  assert.equal(failed.status, "ERROR");
  assert.equal(failed.error?.retryable, false);
  assertClean(failed.error?.message ?? "", "contract copy");
});

test("creating a session records the pending request and its outcome", () => {
  let state = dashboardReducer(initialDashboardState(), { type: "CREATE_REQUESTED" });
  assert.equal(state.creating, true);
  assert.equal(state.error, null);
  state = dashboardReducer(state, { type: "CREATE_SUCCEEDED", sessionId: "session-9" });
  assert.equal(state.creating, false);
  assert.equal(state.pendingSessionId, "session-9");
  assert.equal(state.status, "IDLE", "the operator still has to load the list");

  const failed = dashboardReducer(initialDashboardState(), { type: "CREATE_REQUESTED" });
  const afterFailure = dashboardReducer(failed, {
    type: "CREATE_FAILED",
    code: "UNAUTHORIZED",
    message: "管理员会话已失效，请重新登录。",
    retryable: false
  });
  assert.equal(afterFailure.creating, false);
  assert.equal(afterFailure.pendingSessionId, null);
  assert.equal(afterFailure.status, "UNAUTHORIZED");
});

test("no dashboard copy can carry storage paths, keys or backend origins", () => {
  const collected: string[] = [];
  for (const bucket of DASHBOARD_BUCKETS) {
    collected.push(DASHBOARD_BUCKET_LABELS[bucket].title, DASHBOARD_BUCKET_LABELS[bucket].hint);
  }
  for (const filter of SESSION_STATE_FILTERS) {
    collected.push(filter.label);
  }
  for (const state of ASSET_IMPORT_SESSION_STATES) {
    collected.push(sessionStateLabel(state));
  }
  collected.push(
    summaryRecovery(makeSummary({ state: "PARTIALLY_FAILED", failedFileCount: 1 }))?.label ?? "",
    summaryRecovery(makeSummary({ state: "FAILED" }))?.label ?? ""
  );
  assert.ok(collected.length > 20);
  for (const copy of collected) {
    assertClean(copy, "dashboard copy");
  }
});
