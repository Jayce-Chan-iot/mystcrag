import assert from "node:assert/strict";
import test from "node:test";

import type {
  AssetImportSessionState,
  AssetImportSessionSummary,
  CreateAssetImportSessionResponse,
  ListAssetImportSessionsQuery,
  ListAssetImportSessionsResponse
} from "@mystcrag/design-contract";

import { BeadImportApiError } from "./api-client";
import type { AbortSignalLike } from "./session-lifecycle";

import { createDashboardLoader, type DashboardLoaderAction } from "./dashboard-loader";

const FORBIDDEN_LEAKS = ["127.0.0.1", "localhost", "x-admin-key", "asset-archive", "/Users/", "ECONNREFUSED"];

function makeSummary(sessionId: string, state: AssetImportSessionState = "CREATED"): AssetImportSessionSummary {
  return {
    sessionId,
    state,
    lastVerifiedCheckpoint: null,
    declaredFileCount: 1,
    archivedFileCount: 1,
    failedFileCount: 0,
    groupCount: 0,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:05:00.000Z"
  };
}

function listResponse(
  sessions: AssetImportSessionSummary[],
  nextCursor: string | null = null
): ListAssetImportSessionsResponse {
  return { sessions, nextCursor };
}

type Harness = {
  actions: DashboardLoaderAction[];
  queries: ListAssetImportSessionsQuery[];
  signals: (AbortSignalLike | undefined)[];
  createdKeys: string[];
  opened: string[];
  aborted: number;
  gates: ((value: ListAssetImportSessionsResponse) => void)[];
  loader: ReturnType<typeof createDashboardLoader>;
  setListResult(result: ListAssetImportSessionsResponse | Error): void;
  setCreateResult(result: CreateAssetImportSessionResponse | Error): void;
  now(): string;
};

function makeHarness(options: { clock?: string[]; deferList?: boolean } = {}): Harness {
  const actions: DashboardLoaderAction[] = [];
  const queries: ListAssetImportSessionsQuery[] = [];
  const signals: (AbortSignalLike | undefined)[] = [];
  const createdKeys: string[] = [];
  const opened: string[] = [];
  const gates: ((value: ListAssetImportSessionsResponse) => void)[] = [];
  let listResult: ListAssetImportSessionsResponse | Error = listResponse([]);
  let createResult: CreateAssetImportSessionResponse | Error = {
    sessionId: "session-new",
    state: "CREATED",
    createdAt: "2026-09-06T09:00:00.000Z"
  };
  let aborted = 0;
  const clock = options.clock ?? ["2026-09-06T09:00:00.000Z"];
  let tick = 0;

  const loader = createDashboardLoader({
    client: {
      listSessions: async (query, requestOptions) => {
        queries.push({ ...query });
        signals.push(requestOptions?.signal);
        if (options.deferList === true) {
          return new Promise<ListAssetImportSessionsResponse>((resolve) => {
            gates.push(resolve);
          });
        }
        if (listResult instanceof Error) {
          throw listResult;
        }
        return listResult;
      },
      createSession: async (idempotencyKey) => {
        createdKeys.push(idempotencyKey);
        if (createResult instanceof Error) {
          throw createResult;
        }
        return createResult;
      }
    },
    dispatch: (action) => actions.push(action),
    now: () => clock[Math.min(tick++, clock.length - 1)] as string,
    createAbortController: () => {
      let abortedLocally = false;
      return {
        signal: { get aborted() { return abortedLocally; } },
        abort: () => {
          abortedLocally = true;
          aborted += 1;
        }
      };
    },
    newIdempotencyKey: () => `key-${createdKeys.length + 1}`,
    openSession: (sessionId) => opened.push(sessionId)
  });

  return {
    actions,
    queries,
    signals,
    createdKeys,
    opened,
    gates,
    get aborted() {
      return aborted;
    },
    loader,
    setListResult(result) {
      listResult = result;
    },
    setCreateResult(result) {
      createResult = result;
    },
    now: () => clock[0] as string
  };
}

function apiError(code: string, message: string, retryable: boolean): BeadImportApiError {
  return new BeadImportApiError({ code, status: 500, message, retryable });
}

test("loading the first page reports the filter, the limit and the sync time", async () => {
  const harness = makeHarness();
  harness.setListResult(listResponse([makeSummary("s-1", "NEEDS_REVIEW")], "s-2"));
  await harness.loader.load({ filter: "NEEDS_REVIEW", limit: 25 });

  assert.deepEqual(harness.queries, [{ state: "NEEDS_REVIEW", limit: 25 }]);
  assert.deepEqual(harness.actions, [
    { type: "LOAD_STARTED" },
    {
      type: "LOAD_SUCCEEDED",
      sessions: [makeSummary("s-1", "NEEDS_REVIEW")],
      nextCursor: "s-2",
      syncedAt: "2026-09-06T09:00:00.000Z"
    }
  ]);
});

test("the all filter never sends a state the contract does not define", async () => {
  const harness = makeHarness();
  await harness.loader.load({ filter: "ALL", limit: 25 });
  assert.deepEqual(harness.queries, [{ limit: 25 }]);
  assert.equal("state" in (harness.queries[0] as object), false);
});

test("loading more passes the cursor and appends", async () => {
  const harness = makeHarness({ clock: ["2026-09-06T09:00:00.000Z", "2026-09-06T09:01:00.000Z"] });
  harness.setListResult(listResponse([makeSummary("s-3")], null));
  await harness.loader.load({ filter: "ALL", limit: 25 });
  harness.actions.length = 0;
  harness.queries.length = 0;
  await harness.loader.load({ filter: "ALL", limit: 25, cursor: "s-2", append: true });

  assert.deepEqual(harness.queries, [{ limit: 25, cursor: "s-2" }]);
  assert.deepEqual(harness.actions, [
    { type: "LOAD_MORE_STARTED" },
    {
      type: "APPEND_SUCCEEDED",
      sessions: [makeSummary("s-3")],
      nextCursor: null,
      syncedAt: "2026-09-06T09:01:00.000Z"
    }
  ]);
});

test("a lost admin session is reported with its own code and never retried blindly", async () => {
  const harness = makeHarness();
  harness.setListResult(apiError("UNAUTHORIZED", "管理员会话已失效，请重新登录。", false));
  await harness.loader.load({ filter: "ALL", limit: 25 });
  assert.deepEqual(harness.actions, [
    { type: "LOAD_STARTED" },
    {
      type: "LOAD_FAILED",
      code: "UNAUTHORIZED",
      message: "管理员会话已失效，请重新登录。",
      retryable: false
    }
  ]);
});

test("a retryable outage keeps its retryable flag", async () => {
  const harness = makeHarness();
  harness.setListResult(apiError("NETWORK_ERROR", "无法连接珠子素材导入服务，请稍后重试。", true));
  await harness.loader.load({ filter: "ALL", limit: 25 });
  const failure = harness.actions[1];
  assert.ok(failure !== undefined && failure.type === "LOAD_FAILED");
  assert.equal(failure.retryable, true);
  assert.equal(failure.code, "NETWORK_ERROR");
});

test("an unexpected throw is classified safely without echoing the detail", async () => {
  const harness = makeHarness();
  harness.setListResult(new TypeError("fetch failed: connect ECONNREFUSED http://127.0.0.1:4000/api/admin/bead-import/sessions"));
  await harness.loader.load({ filter: "ALL", limit: 25 });
  const failure = harness.actions[1];
  assert.ok(failure !== undefined && failure.type === "LOAD_FAILED");
  assert.equal(failure.code, "NETWORK_ERROR");
  assert.equal(failure.retryable, true);
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.ok(!failure.message.includes(forbidden), `${failure.message} must not mention ${forbidden}`);
  }
});

test("creating a session opens the workflow with a unique idempotency key", async () => {
  const harness = makeHarness();
  await harness.loader.create();
  assert.deepEqual(harness.createdKeys, ["key-1"]);
  assert.deepEqual(harness.actions, [
    { type: "CREATE_REQUESTED" },
    { type: "CREATE_SUCCEEDED", sessionId: "session-new" }
  ]);
  assert.deepEqual(harness.opened, ["session-new"]);

  await harness.loader.create();
  assert.deepEqual(harness.createdKeys, ["key-1", "key-2"]);
});

test("a failed creation reports the failure and opens nothing", async () => {
  const harness = makeHarness();
  harness.setCreateResult(apiError("UNAUTHORIZED", "管理员会话已失效，请重新登录。", false));
  await harness.loader.create();
  assert.deepEqual(harness.actions, [
    { type: "CREATE_REQUESTED" },
    {
      type: "CREATE_FAILED",
      code: "UNAUTHORIZED",
      message: "管理员会话已失效，请重新登录。",
      retryable: false
    }
  ]);
  assert.deepEqual(harness.opened, []);
});

test("cancelling aborts the in-flight request and drops its late result", async () => {
  const harness = makeHarness({ deferList: true });
  const pending = harness.loader.load({ filter: "ALL", limit: 25 });
  harness.loader.cancel();
  assert.equal(harness.aborted, 1);
  assert.equal(harness.signals[0]?.aborted, true);
  harness.gates[0]?.(listResponse([makeSummary("s-late")]));
  await pending;

  assert.deepEqual(harness.queries, [{ limit: 25 }]);
  assert.deepEqual(harness.actions, [{ type: "LOAD_STARTED" }]);
});

test("a newer load supersedes an in-flight one", async () => {
  const harness = makeHarness({ deferList: true });
  const first = harness.loader.load({ filter: "ALL", limit: 25 });
  const second = harness.loader.load({ filter: "PUBLISHED", limit: 25 });
  assert.equal(harness.signals[0]?.aborted, true);
  assert.equal(harness.signals[1]?.aborted, false);
  harness.gates[0]?.(listResponse([makeSummary("s-old", "PUBLISHED")]));
  harness.gates[1]?.(listResponse([makeSummary("s-new", "PUBLISHED")]));
  await Promise.all([first, second]);

  assert.deepEqual(harness.queries, [{ limit: 25 }, { state: "PUBLISHED", limit: 25 }]);
  assert.deepEqual(
    harness.actions.filter((action) => action.type === "LOAD_SUCCEEDED"),
    [
      {
        type: "LOAD_SUCCEEDED",
        sessions: [makeSummary("s-new", "PUBLISHED")],
        nextCursor: null,
        syncedAt: "2026-09-06T09:00:00.000Z"
      }
    ]
  );
});
