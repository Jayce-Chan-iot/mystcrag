import assert from "node:assert/strict";
import test from "node:test";

import type { AssetImportSessionResponse, AssetImportSessionState } from "@mystcrag/design-contract";

import { createSessionLifecycle, type SessionLifecycleDeps } from "./session-lifecycle";
import type { WorkflowAction } from "./workflow-state";

const NOW = "2026-09-06T09:00:00.000Z";
const LATER = "2026-09-06T09:00:04.000Z";

function makeSession(state: AssetImportSessionState): AssetImportSessionResponse {
  return {
    sessionId: "session-1",
    state,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:05:00.000Z",
    lastVerifiedCheckpoint: state === "NEEDS_REVIEW" ? "PROCESSED" : null,
    declaredFileCount: 1,
    uploadedFileCount: 1,
    archivedFileCount: 1,
    failedFileCount: 0,
    declaredBytes: 2048,
    uploadedBytes: 2048,
    files: [],
    groups: []
  };
}

type ScheduledTimer = { handle: number; handler: () => void; ms: number };

function makeTimers() {
  const scheduled: ScheduledTimer[] = [];
  const cleared: number[] = [];
  let next = 1;
  return {
    scheduled,
    cleared,
    setTimeout(handler: () => void, ms: number): number {
      const handle = next;
      next += 1;
      scheduled.push({ handle, handler, ms });
      return handle;
    },
    clearTimeout(handle: unknown): void {
      const value = Number(handle);
      cleared.push(value);
      const index = scheduled.findIndex((timer) => timer.handle === value);
      if (index >= 0) {
        scheduled.splice(index, 1);
      }
    },
    runNext(): void {
      const timer = scheduled.shift();
      if (timer === undefined) {
        throw new Error("no timer was scheduled");
      }
      timer.handler();
    }
  };
}

function makeAborters() {
  const controllers: { signal: { aborted: boolean }; abort: () => void; reasons: unknown[] }[] = [];
  return {
    controllers,
    createAbortController() {
      const controller = {
        signal: { aborted: false },
        reasons: [] as unknown[],
        abort(reason?: unknown) {
          controller.signal.aborted = true;
          controller.reasons.push(reason);
        }
      };
      controllers.push(controller);
      return controller;
    }
  };
}

function makeObjectUrls() {
  const created: string[] = [];
  const revoked: string[] = [];
  let next = 1;
  return {
    created,
    revoked,
    createObjectUrl(): string {
      const url = `blob:preview-${next}`;
      next += 1;
      created.push(url);
      return url;
    },
    revokeObjectUrl(url: string): void {
      revoked.push(url);
    }
  };
}

type HarnessOptions = {
  responses?: (AssetImportSessionResponse | Error)[];
  fetchSession?: SessionLifecycleDeps["fetchSession"];
  pollIntervalMs?: number;
  clock?: string[];
};

function makeHarness(options: HarnessOptions = {}) {
  const timers = makeTimers();
  const aborters = makeAborters();
  const objectUrls = makeObjectUrls();
  const actions: WorkflowAction[] = [];
  const calls: { sessionId: string; signal: { aborted: boolean } }[] = [];
  const queue = options.responses ?? [makeSession("PROCESSING")];
  const clock = options.clock ?? [NOW];
  let tick = 0;

  const fetchSession: SessionLifecycleDeps["fetchSession"] =
    options.fetchSession ??
    (async (sessionId, init) => {
      calls.push({ sessionId, signal: init.signal });
      const next = queue.shift();
      if (next === undefined) {
        throw new Error("the test ran out of scripted responses");
      }
      if (next instanceof Error) {
        throw next;
      }
      return next;
    });

  const controller = createSessionLifecycle({
    timers,
    objectUrls,
    createAbortController: aborters.createAbortController,
    fetchSession,
    dispatch: (action) => actions.push(action),
    now: () => {
      const value = clock[Math.min(tick, clock.length - 1)];
      tick += 1;
      return value ?? NOW;
    },
    pollIntervalMs: options.pollIntervalMs
  });

  return { controller, timers, aborters, objectUrls, actions, calls };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

function transportError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

test("start loads the session through the proxy and reports it to the reducer", async () => {
  const session = makeSession("NEEDS_REVIEW");
  const harness = makeHarness({ responses: [session] });
  await harness.controller.start("session-1");
  await settle();
  assert.deepEqual(harness.actions, [
    { type: "SESSION_REQUESTED", sessionId: "session-1" },
    { type: "SESSION_LOADED", session, syncedAt: NOW }
  ]);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.controller.isRunning(), true);
});

test("polling is scheduled only while the Backend advances on its own", async () => {
  const polling = makeHarness({ responses: [makeSession("PROCESSING")] });
  await polling.controller.start("session-1");
  await settle();
  assert.equal(polling.timers.scheduled.length, 1);
  assert.equal(polling.timers.scheduled[0]?.ms, 4000);

  const resting = makeHarness({ responses: [makeSession("NEEDS_REVIEW")] });
  await resting.controller.start("session-1");
  await settle();
  assert.deepEqual(resting.timers.scheduled, []);

  const custom = makeHarness({ responses: [makeSession("ARCHIVING")], pollIntervalMs: 1500 });
  await custom.controller.start("session-1");
  await settle();
  assert.equal(custom.timers.scheduled[0]?.ms, 1500);
});

test("a poll tick refreshes without stealing navigation and reschedules", async () => {
  const harness = makeHarness({
    responses: [makeSession("PROCESSING"), makeSession("PROCESSING")],
    clock: [NOW, LATER]
  });
  await harness.controller.start("session-1");
  await settle();
  harness.timers.runNext();
  await settle();
  assert.deepEqual(harness.actions[2], {
    type: "SESSION_REFRESHED",
    session: makeSession("PROCESSING"),
    syncedAt: LATER
  });
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.timers.scheduled.length, 1, "the next tick must be scheduled");
});

test("polling stops as soon as the session rests or terminates", async () => {
  for (const state of ["NEEDS_REVIEW", "PUBLISHED", "FAILED", "PARTIALLY_FAILED"] as const) {
    const harness = makeHarness({ responses: [makeSession("PROCESSING"), makeSession(state)] });
    await harness.controller.start("session-1");
    await settle();
    harness.timers.runNext();
    await settle();
    assert.deepEqual(harness.timers.scheduled, [], `${state} must not keep polling`);
  }
});

test("a retryable failure keeps polling and a permanent one stops it", async () => {
  const retryable = makeHarness({
    responses: [transportError("INTERNAL_ERROR", "The bead import service did not respond."), makeSession("PROCESSING")]
  });
  await retryable.controller.start("session-1");
  await settle();
  const failed = retryable.actions[1];
  assert.equal(failed?.type, "SESSION_FAILED");
  if (failed?.type === "SESSION_FAILED") {
    assert.equal(failed.error.code, "INTERNAL_ERROR");
    assert.equal(failed.error.retryable, true);
  }
  assert.equal(retryable.timers.scheduled.length, 1, "a transient failure must be retried");
  retryable.timers.runNext();
  await settle();
  assert.equal(retryable.actions[2]?.type, "SESSION_LOADED");

  for (const code of ["UNAUTHORIZED", "NOT_FOUND", "VALIDATION_ERROR"]) {
    const permanent = makeHarness({ responses: [transportError(code, "rejected")] });
    await permanent.controller.start("session-1");
    await settle();
    const action = permanent.actions[1];
    assert.equal(action?.type, "SESSION_FAILED", code);
    if (action?.type === "SESSION_FAILED") {
      assert.equal(action.error.retryable, false, code);
      assert.equal(action.error.code, code, code);
    }
    assert.deepEqual(permanent.timers.scheduled, [], `${code} must stop polling`);
  }
});

test("an unknown failure is classified without leaking the thrown message", async () => {
  const harness = makeHarness({
    responses: [new TypeError("fetch failed for http://127.0.0.1:4000/api/admin/bead-import/sessions/session-1")]
  });
  await harness.controller.start("session-1");
  await settle();
  const action = harness.actions[1];
  assert.equal(action?.type, "SESSION_FAILED");
  if (action?.type === "SESSION_FAILED") {
    assert.equal(action.error.code, "INTERNAL_ERROR");
    assert.equal(action.error.retryable, true);
    assert.ok(!action.error.message.includes("127.0.0.1"));
    assert.ok(!action.error.message.includes("http"));
  }
});

test("an explicit refresh that lands on an in-flight read is queued, never dropped", async () => {
  const releases: ((session: AssetImportSessionResponse) => void)[] = [];
  const harness = makeHarness({
    fetchSession: (sessionId, init) => {
      harness.calls.push({ sessionId, signal: init.signal });
      return new Promise<AssetImportSessionResponse>((resolve) => {
        releases.push(resolve);
      });
    }
  });
  const first = harness.controller.start("session-1");
  await settle();

  // A poll is in flight when the upload completes and asks for a refresh.
  await harness.controller.refresh();
  assert.equal(harness.calls.length, 1, "one request at a time while a read is in flight");

  // The in-flight read returns a pre-upload snapshot that would stop polling.
  releases[0]?.(makeSession("NEEDS_REVIEW"));
  await first;
  await settle();

  assert.equal(
    harness.calls.length,
    2,
    "the queued refresh must run once the in-flight read has settled"
  );
  releases[1]?.(makeSession("READY_TO_PUBLISH"));
  await settle();

  assert.equal(harness.actions[1]?.type, "SESSION_LOADED");
  assert.equal(harness.actions[2]?.type, "SESSION_REFRESHED");
  const refreshed = harness.actions[2];
  assert.ok(refreshed?.type === "SESSION_REFRESHED");
  assert.equal(
    refreshed.session.state,
    "READY_TO_PUBLISH",
    "the workflow must end on the post-upload authoritative session, not the stale poll"
  );
  assert.deepEqual(harness.calls.map(() => true).length, 2);
});

test("stop clears the timer, aborts the request and releases every preview url", async () => {
  const harness = makeHarness({ responses: [makeSession("PROCESSING"), makeSession("PROCESSING")] });
  await harness.controller.start("session-1");
  await settle();
  const first = harness.controller.trackObjectUrl(new Blob(["preview"]));
  const second = harness.controller.trackObjectUrl(new Blob(["preview-2"]));
  assert.deepEqual(harness.objectUrls.created, [first, second]);
  assert.notEqual(first, second);

  const handle = harness.timers.scheduled[0]?.handle;
  harness.controller.stop();
  assert.deepEqual(harness.timers.cleared, [handle]);
  assert.deepEqual(harness.timers.scheduled, []);
  assert.deepEqual(harness.objectUrls.revoked.sort(), [first, second].sort());
  assert.equal(harness.controller.isRunning(), false);

  // Releasing twice never revokes the same url twice.
  harness.controller.releaseObjectUrl(first);
  harness.controller.stop();
  assert.deepEqual(harness.objectUrls.revoked.sort(), [first, second].sort());
});

test("an in-flight request is aborted on stop and its late response is ignored", async () => {
  let release: ((session: AssetImportSessionResponse) => void) | undefined;
  const requested: string[] = [];
  const harness = makeHarness({
    fetchSession: (sessionId, init) => {
      requested.push(sessionId);
      return new Promise<AssetImportSessionResponse>((resolve, reject) => {
        release = resolve;
        if (init.signal.aborted) {
          reject(new Error("already aborted"));
        }
      });
    }
  });
  const pending = harness.controller.start("session-1");
  await settle();
  assert.deepEqual(requested, ["session-1"]);
  assert.equal(harness.aborters.controllers.length, 1);
  harness.controller.stop();
  assert.equal(harness.aborters.controllers[0]?.signal.aborted, true);
  release?.(makeSession("PUBLISHED"));
  await pending.catch(() => undefined);
  await settle();
  assert.deepEqual(harness.actions, [{ type: "SESSION_REQUESTED", sessionId: "session-1" }]);
});

test("a stopped controller never polls again", async () => {
  const harness = makeHarness({ responses: [makeSession("PROCESSING"), makeSession("PROCESSING")] });
  await harness.controller.start("session-1");
  await settle();
  harness.controller.stop();
  assert.deepEqual(harness.timers.scheduled, []);
  await harness.controller.refresh();
  await settle();
  assert.equal(harness.calls.length, 1, "no request after stop");
  assert.deepEqual(harness.actions.map((action) => action.type), ["SESSION_REQUESTED", "SESSION_LOADED"]);
});

test("start can be called again after stop for a different session", async () => {
  const harness = makeHarness({ responses: [makeSession("NEEDS_REVIEW"), makeSession("NEEDS_REVIEW")] });
  await harness.controller.start("session-1");
  await settle();
  harness.controller.stop();
  await harness.controller.start("session-2");
  await settle();
  assert.equal(harness.controller.isRunning(), true);
  assert.equal(harness.calls.length, 2);
  assert.deepEqual(harness.actions.map((action) => action.type), [
    "SESSION_REQUESTED",
    "SESSION_LOADED",
    "SESSION_REQUESTED",
    "SESSION_LOADED"
  ]);
  assert.equal(harness.actions[3]?.type === "SESSION_LOADED" ? harness.actions[3].syncedAt : null, NOW);
});
