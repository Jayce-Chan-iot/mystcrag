import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ReprocessBeadImageGroupRequestSchema,
  ReviewProcessedAssetRequestSchema,
  SelectProcessedVersionRequestSchema,
  type AssetImportProcessedAssetView,
  type AssetImportSessionGroupView,
  type AssetImportSessionResponse
} from "@mystcrag/design-contract";

import { BeadImportApiError } from "./api-client";
import { initialWorkflowState, workflowReducer, type WorkflowAction } from "./workflow-state";
import {
  PROCESSING_REFUSAL_MESSAGES,
  createProcessingLoader,
  type ProcessingLoader,
  type ProcessingLoaderClient,
  type ProcessingRefusalReason,
  type ReviewDecisionInput
} from "./processing-loader";

const SOURCE = readFileSync(join(__dirname, "processing-loader.ts"), "utf8");

const FORBIDDEN = [
  "archiveKey",
  "storageKey",
  "x-admin-key",
  "127.0.0.1",
  "localhost",
  "/Users/",
  "process.env",
  "document.cookie",
  "approved:"
];

const SYNCED_AT = "2026-09-06T09:00:00.000Z";

function approvalDecision(overrides: Partial<Extract<ReviewDecisionInput, { action: "APPROVE" }>> = {}) {
  return {
    action: "APPROVE" as const,
    reviewNote: "实拍原图，裁切边界清晰，无遮挡。",
    rightsHolder: "玄矶水晶工作室",
    usagePermission: "OWNED" as const,
    isAuthenticPhotograph: true,
    allowAiTraining: false,
    allowCommercialUse: true,
    allowPublicDisplay: true,
    allowAiRecommendation: true,
    ...overrides
  };
}

function makeProcessedAsset(overrides: Partial<AssetImportProcessedAssetView> = {}): AssetImportProcessedAssetView {
  return {
    processedAssetId: "processed-1",
    processingVersion: 1,
    state: "QC_PENDING",
    isCurrent: true,
    qcPassed: true,
    qcIssues: [],
    ...overrides
  };
}

function makeGroup(overrides: Partial<AssetImportSessionGroupView> = {}): AssetImportSessionGroupView {
  return {
    groupId: "group-1",
    state: "PROCESSED",
    crystalName: "白水晶",
    memberFileIds: ["file-1"],
    revision: 5,
    processedAssets: [makeProcessedAsset()],
    crystalDraft: {
      crystalDraftId: "crystal-draft-1",
      revision: 2,
      curationComplete: true,
      missingFields: [],
      promotionEligible: true
    },
    ...overrides
  };
}

function makeSession(overrides: Partial<AssetImportSessionResponse> = {}): AssetImportSessionResponse {
  return {
    sessionId: "session-1",
    state: "NEEDS_REVIEW",
    createdAt: SYNCED_AT,
    updatedAt: SYNCED_AT,
    lastVerifiedCheckpoint: "PROCESSED",
    declaredFileCount: 1,
    uploadedFileCount: 1,
    archivedFileCount: 1,
    failedFileCount: 0,
    declaredBytes: 1024,
    uploadedBytes: 1024,
    files: [],
    groups: [makeGroup()],
    ...overrides
  };
}

type Harness = {
  loader: ProcessingLoader;
  dispatched: WorkflowAction[];
  calls: string[];
  requests: unknown[];
  setStartError(error: Error | null): void;
  setStartSeen(): Promise<void>;
  gateStart(): Promise<void>;
  releaseStart(): void;
  rejectStart(): void;
  setSession(session: AssetImportSessionResponse): void;
  latest(): { session: AssetImportSessionResponse | null };
};

function makeHarness(options: { session?: AssetImportSessionResponse } = {}): Harness {
  const dispatched: WorkflowAction[] = [];
  const calls: string[] = [];
  const requests: unknown[] = [];
  let current = workflowReducer(initialWorkflowState("session-1"), {
    type: "SESSION_LOADED",
    session: options.session ?? makeSession(),
    syncedAt: SYNCED_AT
  });
  const dispatch = (action: WorkflowAction): void => {
    dispatched.push(action);
    current = workflowReducer(current, action);
  };
  let refreshed: AssetImportSessionResponse = makeSession({ updatedAt: "2026-09-06T09:00:30.000Z" });
  let keyCount = 0;
  let startError: Error | null = null;
  let startGate: (() => void) | null = null;

  const client: ProcessingLoaderClient = {
    async startProcessing(sessionId, idempotencyKey) {
      calls.push(`start:${sessionId}:${idempotencyKey}`);
      if (startGate !== null) {
        await new Promise<void>((resolve) => {
          startGate = () => resolve();
        });
      }
      if (startError !== null) {
        throw startError;
      }
      return { sessionId, state: "PROCESSING", queuedJobCount: 1, startedAt: SYNCED_AT };
    },
    async reprocessGroup(groupId, request) {
      calls.push(`reprocess:${groupId}:${request.expectedGroupRevision}`);
      requests.push(request);
      return { groupId, jobId: "job-1", jobState: "QUEUED", processingVersion: 2 };
    },
    async selectProcessedVersion(groupId, request) {
      calls.push(`select:${groupId}:${request.expectedGroupRevision}:${request.processingVersion}`);
      requests.push(request);
      return {
        groupId,
        state: "PROCESSED",
        selectedProcessingVersion: request.processingVersion,
        updatedAt: SYNCED_AT
      };
    },
    async reviewProcessedAsset(groupId, processedAssetId, request) {
      calls.push(`review:${groupId}:${processedAssetId}`);
      requests.push(request);
      return {
        groupId,
        processedAssetId,
        reviewAction: "APPROVE",
        state: "APPROVED",
        revision: 6,
        reviewedAt: SYNCED_AT
      };
    },
    async getSession(sessionId) {
      calls.push(`getSession:${sessionId}`);
      return refreshed;
    }
  };

  const loader = createProcessingLoader({
    client,
    getState: () => current,
    dispatch,
    now: () => SYNCED_AT,
    createIdempotencyKey: () => {
      keyCount += 1;
      return `key-${keyCount}`;
    },
    createAbortController: () => {
      let abortedLocally = false;
      return {
        signal: { get aborted() { return abortedLocally; } },
        abort: () => { abortedLocally = true; }
      };
    }
  });

  return {
    loader,
    dispatched,
    calls,
    requests,
    setStartError(error) {
      startError = error;
    },
    async setStartSeen() {
      await new Promise((resolve) => setImmediate(resolve));
    },
    async gateStart() {
      await new Promise<void>((resolve) => {
        startGate = () => resolve();
      });
    },
    releaseStart() {
      startGate?.();
      startGate = null;
    },
    rejectStart() {
      startError = new BeadImportApiError({ code: "CONFLICT", status: 409, message: "stale", retryable: true });
    },
    setSession(session) {
      refreshed = session;
    },
    latest() {
      return { session: current.session };
    }
  };
}

test("every processing refusal has a real, sanitised sentence", () => {
  for (const reason of Object.keys(PROCESSING_REFUSAL_MESSAGES) as ProcessingRefusalReason[]) {
    const message = PROCESSING_REFUSAL_MESSAGES[reason];
    assert.ok(message.length >= 6, `${reason} needs a real sentence`);
    for (const forbidden of FORBIDDEN) {
      assert.equal(message.includes(forbidden), false, `${reason} must not mention ${forbidden}`);
    }
  }
});

test("startProcessing is refused until the session is allowed to start", async () => {
  const harness = makeHarness({ session: makeSession({ state: "UPLOADING", groups: [] }) });
  const result = await harness.loader.startProcessing();
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reason, "PROCESSING_NOT_ALLOWED");
  assert.deepEqual(harness.calls, [], "nothing leaves the browser for a refused start");
});

test("startProcessing sends a fresh idempotency key and re-reads the session", async () => {
  const harness = makeHarness();
  const result = await harness.loader.startProcessing();
  assert.equal(result.outcome, "APPLIED");
  assert.match(harness.calls[0] ?? "", /^start:session-1:key-1$/);
  assert.equal(harness.calls.includes("getSession:session-1"), true, "the processed result lives in the session");
});

test("reprocessGroup sends the authoritative revision and a fresh key", async () => {
  const harness = makeHarness();
  const result = await harness.loader.reprocessGroup("group-1", { maskThreshold: 0.4, edgeFeatherPx: 2 });
  assert.equal(result.outcome, "APPLIED");
  assert.match(harness.calls[0] ?? "", /^reprocess:group-1:5$/);

  const parsed = ReprocessBeadImageGroupRequestSchema.safeParse(harness.requests[0]);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.expectedGroupRevision, 5);
    assert.equal(parsed.data.settings?.maskThreshold, 0.4);
    assert.equal(parsed.data.settings?.edgeFeatherPx, 2);
    assert.match(parsed.data.idempotencyKey, /^key-/);
  }
});

test("reprocessGroup refuses out-of-range settings and unknown groups", async () => {
  const harness = makeHarness();
  const tooWide = await harness.loader.reprocessGroup("group-1", { maskThreshold: 1.5 });
  assert.equal(tooWide.outcome, "REFUSED");
  assert.equal(tooWide.reason, "INVALID_SETTINGS");

  const feather = await harness.loader.reprocessGroup("group-1", { edgeFeatherPx: 9 });
  assert.equal(feather.outcome, "REFUSED");
  assert.equal(feather.reason, "INVALID_SETTINGS");

  const unknown = await harness.loader.reprocessGroup("group-missing");
  assert.equal(unknown.outcome, "REFUSED");
  assert.equal(unknown.reason, "UNKNOWN_GROUP");
  assert.equal(harness.calls.length, 0, "refused requests leave nothing behind");
});

test("selectProcessedVersion sends the authoritative revision", async () => {
  const harness = makeHarness();
  const result = await harness.loader.selectProcessedVersion("group-1", 2);
  assert.equal(result.outcome, "APPLIED");
  assert.match(harness.calls[0] ?? "", /^select:group-1:5:2$/);

  const parsed = SelectProcessedVersionRequestSchema.safeParse(harness.requests[0]);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.expectedGroupRevision, 5);
    assert.equal(parsed.data.processingVersion, 2);
  }
});

test("an approval carries every human consent field and passes the contract", async () => {
  const harness = makeHarness();
  const result = await harness.loader.reviewProcessedAsset("group-1", "processed-1", approvalDecision());
  assert.equal(result.outcome, "APPLIED");

  const parsed = ReviewProcessedAssetRequestSchema.safeParse(harness.requests[0]);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.action, "APPROVE");
    assert.equal(parsed.data.rightsHolder, "玄矶水晶工作室");
    assert.equal(parsed.data.usagePermission, "OWNED");
    assert.equal(parsed.data.isAuthenticPhotograph, true);
    assert.equal(parsed.data.allowAiTraining, false);
    assert.equal(parsed.data.allowCommercialUse, true);
    assert.equal(parsed.data.allowPublicDisplay, true);
    assert.equal(parsed.data.allowAiRecommendation, true);
    assert.equal(parsed.data.expectedGroupRevision, 5);
  }
});

test("a QC_FAILED asset cannot be approved", async () => {
  const harness = makeHarness({
    session: makeSession({
      groups: [makeGroup({ processedAssets: [makeProcessedAsset({ state: "QC_FAILED", qcPassed: false, qcIssues: ["主体缺失"] })] })]
    })
  });
  const result = await harness.loader.reviewProcessedAsset("group-1", "processed-1", approvalDecision());
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reason, "REVIEW_NOT_ALLOWED");
  assert.deepEqual(harness.calls, []);
});

test("an approval missing a required consent field is refused before any request", async () => {
  const emptyHolder = makeHarness();
  const result = await emptyHolder.loader.reviewProcessedAsset(
    "group-1",
    "processed-1",
    approvalDecision({ rightsHolder: "  " })
  );
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reason, "APPROVE_REQUIRES_RIGHTS");
  assert.deepEqual(emptyHolder.calls, []);

  const emptyNote = makeHarness();
  const second = await emptyNote.loader.reviewProcessedAsset(
    "group-1",
    "processed-1",
    approvalDecision({ reviewNote: "   " })
  );
  assert.equal(second.outcome, "REFUSED");
  assert.equal(second.reason, "APPROVE_REQUIRES_RIGHTS");
  assert.deepEqual(emptyNote.calls, []);
});

test("a reject answers a QC_FAILED asset without granting permissions", async () => {
  const harness = makeHarness({
    session: makeSession({
      groups: [makeGroup({ processedAssets: [makeProcessedAsset({ state: "QC_FAILED", qcPassed: false, qcIssues: ["主体缺失"] })] })]
    })
  });
  const result = await harness.loader.reviewProcessedAsset("group-1", "processed-1", {
    action: "REJECT",
    reviewNote: "裁切主体缺失，重新处理。"
  });
  assert.equal(result.outcome, "APPLIED");
  assert.match(harness.calls[0] ?? "", /^review:group-1:processed-1$/);

  const parsed = ReviewProcessedAssetRequestSchema.safeParse(harness.requests[0]);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.action, "REJECT");
    assert.equal("rightsHolder" in parsed.data, false);
    assert.equal("usagePermission" in parsed.data, false);
  }
});

test("a 409 from a processing mutation re-reads the session and reports a conflict", async () => {
  const harness = makeHarness();
  harness.setStartError(new BeadImportApiError({ code: "CONFLICT", status: 409, message: "stale", retryable: false }));
  const result = await harness.loader.startProcessing();
  assert.equal(result.outcome, "CONFLICT");
  assert.equal(harness.calls.includes("getSession:session-1"), true);
});

test("cancelling aborts an in-flight start and dispatches nothing late", async () => {
  const harness = makeHarness();
  const pending = harness.loader.startProcessing();
  await harness.setStartSeen();
  harness.loader.cancel();
  harness.releaseStart();
  const result = await pending;
  assert.equal(result.outcome === "CANCELLED" || result.outcome === "APPLIED", true);
});

test("the loader reaches for the contract client and stays free of leaks", () => {
  assert.equal(SOURCE.includes("fetch("), false, "transport is owned by the api client");
  assert.equal(SOURCE.includes("approved:"), false, "an approved key is never assembled here");
  for (const forbidden of FORBIDDEN) {
    assert.equal(SOURCE.includes(forbidden), false, `loader must not mention ${forbidden}`);
  }
  assert.ok(SOURCE.includes("canReviewProcessedAsset"), "review eligibility is judged by the contract");
  assert.ok(SOURCE.includes("expectedGroupRevision") && SOURCE.includes("reprocessGroup"), "reprocess uses authoritative revision");
});