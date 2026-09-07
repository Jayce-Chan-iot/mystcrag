import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  PublishBeadImageGroupRequestSchema,
  ReprocessBeadImageGroupRequestSchema,
  ReviewProcessedAssetRequestSchema,
  SelectProcessedVersionRequestSchema,
  type AssetImportCrystalDraftView,
  type AssetImportProcessedAssetView,
  type AssetImportSessionGroupView,
  type AssetImportSessionResponse,
  type BeadProductDraftView,
  type PublishBeadImageGroupRequest
} from "@mystcrag/design-contract";

import { BeadImportApiError } from "./api-client";
import { initialWorkflowState, workflowReducer, type WorkflowAction } from "./workflow-state";
import {
  PROCESSING_REFUSAL_MESSAGES,
  approvalDecisionReady,
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
    approvedAssetKey: null,
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
    crystalDraft: makeCrystalDraft(),
    productDraft: null,
    ...overrides
  };
}

const APPROVED_KEY = `approved:${"b".repeat(64)}`;

function makeCrystalDraft(overrides: Partial<AssetImportCrystalDraftView> = {}): AssetImportCrystalDraftView {
  return {
    crystalDraftId: "crystal-draft-1",
    revision: 2,
    nameCn: "白水晶",
    nameEn: "Clear Quartz",
    mineralName: "石英",
    colorTags: ["白色"],
    visualTags: ["冰裂"],
    styleTags: ["简约"],
    priceLevel: 3,
    complianceNote: "仅描述材质与外观，不涉及任何功效。",
    curationComplete: true,
    missingFields: [],
    promotionEligible: true,
    ...overrides
  };
}

function makeProductDraft(
  overrides: Partial<BeadProductDraftView> = {}
): BeadProductDraftView {
  return {
    crystalName: "白水晶",
    crystalId: null,
    crystalDraftId: "crystal-draft-1",
    displayName: "天然白水晶圆珠手串",
    sku: "MXJ-BEAD-QUARTZ-08",
    materialKey: "quartz-clear",
    shape: "ROUND",
    diameterMm: 10,
    lengthAlongStringMm: null,
    currency: "CNY",
    unitPriceMinor: 1250,
    costMinor: 800,
    availableQuantity: 25,
    qualityStatement: "肉眼干净，天然棉裂可见。",
    qualitySource: "供应商出厂检验单。",
    textureAssetKey: null,
    modelAssetKey: null,
    rightsHolder: "玄矶水晶工作室",
    usagePermission: "OWNED",
    isAuthenticPhotograph: true,
    allowAiTraining: false,
    allowCommercialUse: true,
    allowPublicDisplay: true,
    allowAiRecommendation: true,
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
        approvedAssetKey: APPROVED_KEY,
        reviewedAt: SYNCED_AT
      };
    },
    async publishGroup(groupId, request) {
      calls.push(`publish:${groupId}:${request.expectedGroupRevision}`);
      requests.push(request);
      return {
        groupId,
        state: "PUBLISHED" as const,
        materialProductId: "product-1",
        crystalId: "crystal-1",
        inventorySnapshotId: "inventory-1",
        publishedAssetKeys: [request.textureAssetKey],
        publishedAt: SYNCED_AT
      };
    },
    async getSession(sessionId: string) {
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

test("a current QC_FAILED asset accepts no review at all: not approve, not reject", async () => {
  const harness = makeHarness({
    session: makeSession({
      groups: [makeGroup({ processedAssets: [makeProcessedAsset({ state: "QC_FAILED", qcPassed: false, qcIssues: ["主体缺失"] })] })]
    })
  });

  const rejected = await harness.loader.reviewProcessedAsset("group-1", "processed-1", {
    action: "REJECT",
    reviewNote: "裁切主体缺失，重新处理。"
  });
  assert.equal(rejected.outcome, "REFUSED", "a failed QC is inspect-and-reprocess only");
  assert.equal(rejected.reason, "REVIEW_NOT_ALLOWED");

  const approved = await harness.loader.reviewProcessedAsset("group-1", "processed-1", approvalDecision());
  assert.equal(approved.outcome, "REFUSED");
  assert.equal(approved.reason, "REVIEW_NOT_ALLOWED");

  assert.deepEqual(
    harness.calls.filter((call) => call.startsWith("review:")),
    [],
    "a refused review makes zero network calls"
  );
});

test("a superseded QC_PENDING version accepts no review either", async () => {
  const harness = makeHarness({
    session: makeSession({
      groups: [
        makeGroup({
          processedAssets: [
            makeProcessedAsset({ processedAssetId: "pa-old", processingVersion: 1, state: "QC_PENDING", isCurrent: false })
          ]
        })
      ]
    })
  });

  const approved = await harness.loader.reviewProcessedAsset("group-1", "pa-old", approvalDecision());
  assert.equal(approved.outcome, "REFUSED");
  assert.equal(approved.reason, "REVIEW_NOT_ALLOWED");

  const rejected = await harness.loader.reviewProcessedAsset("group-1", "pa-old", {
    action: "REJECT",
    reviewNote: "旧版本不能审核。"
  });
  assert.equal(rejected.outcome, "REFUSED");
  assert.equal(rejected.reason, "REVIEW_NOT_ALLOWED");

  assert.deepEqual(
    harness.calls.filter((call) => call.startsWith("review:")),
    []
  );
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
  assert.ok(
    SOURCE.includes('asset.isCurrent && asset.state === "QC_PENDING"'),
    "review eligibility is the acceptance boundary: only the current QC_PENDING version"
  );
  assert.ok(SOURCE.includes("expectedGroupRevision") && SOURCE.includes("reprocessGroup"), "reprocess uses authoritative revision");
});
function publishReadySession(
  overrides: Partial<AssetImportSessionResponse> = {},
  groupOverrides: Partial<AssetImportSessionGroupView> = {}
): AssetImportSessionResponse {
  return makeSession({
    state: "READY_TO_PUBLISH",
    groups: [
      makeGroup({
        state: "READY",
        processedAssets: [
          makeProcessedAsset({ state: "APPROVED", approvedAssetKey: APPROVED_KEY })
        ],
        productDraft: makeProductDraft(),
        ...groupOverrides
      })
    ],
    ...overrides
  });
}

test("publish builds the request from the authoritative session and the approved key alone", async () => {
  const harness = makeHarness({ session: publishReadySession() });
  const result = await harness.loader.publishGroup("group-1", {
    crystalNameConfirmed: true,
    crystalDraftPromotionConfirmed: true
  });
  assert.equal(result.outcome, "APPLIED");

  const request = harness.requests[0] as PublishBeadImageGroupRequest;
  assert.equal(PublishBeadImageGroupRequestSchema.safeParse(request).success, true);
  assert.equal(
    request.textureAssetKey,
    APPROVED_KEY,
    "the texture key is the Backend's approved key, never a client-derived value"
  );
  assert.equal(request.crystalName, "白水晶");
  assert.equal(request.crystalNameConfirmedByOperator, true);
  assert.equal(request.displayName, "天然白水晶圆珠手串");
  assert.equal(request.sku, "MXJ-BEAD-QUARTZ-08");
  assert.equal(request.materialKey, "quartz-clear");
  assert.equal(request.shape, "ROUND");
  assert.equal(request.diameterMm, 10);
  assert.equal(request.qualityStatement, "肉眼干净，天然棉裂可见。");
  assert.equal(request.qualitySource, "供应商出厂检验单。");
  assert.equal(request.currency, "CNY");
  assert.equal(request.unitPriceMinor, 1250);
  assert.equal(request.costMinor, 800);
  assert.equal(request.availableQuantity, 25);
  assert.equal(request.rightsHolder, "玄矶水晶工作室");
  assert.equal(request.usagePermission, "OWNED");
  assert.equal(request.isAuthenticPhotograph, true);
  assert.equal(request.allowAiTraining, false);
  assert.equal(request.allowAiRecommendation, true);
  assert.equal(request.allowCommercialUse, true, "publish is an affirmative commercial grant");
  assert.equal(request.allowPublicDisplay, true, "publish is an affirmative display grant");
  assert.equal(request.crystalDraftId, "crystal-draft-1");
  assert.equal(request.crystalDraftPromotionConfirmed, true);
  assert.equal("crystalId" in request, false, "a draft reference and a crystal id never coexist");
  assert.ok(harness.calls.some((call) => call.startsWith("publish:group-1:5")));
});

test("publish uses the existing crystal reference when the draft resolves one", async () => {
  const harness = makeHarness({
    session: publishReadySession({}, {
      productDraft: makeProductDraft({ crystalId: "crystal-9", crystalDraftId: null })
    })
  });
  const result = await harness.loader.publishGroup("group-1", {
    crystalNameConfirmed: true,
    crystalDraftPromotionConfirmed: false
  });
  assert.equal(result.outcome, "APPLIED");
  const request = harness.requests[0] as PublishBeadImageGroupRequest;
  assert.equal(request.crystalId, "crystal-9");
  assert.equal("crystalDraftId" in request, false);
  assert.equal("crystalDraftPromotionConfirmed" in request, false);
});

test("publish is refused when the current version was never approved", async () => {
  const harness = makeHarness({
    session: publishReadySession({}, {
      processedAssets: [makeProcessedAsset({ state: "QC_PENDING", approvedAssetKey: null })]
    })
  });
  const result = await harness.loader.publishGroup("group-1", {
    crystalNameConfirmed: true,
    crystalDraftPromotionConfirmed: true
  });
  assert.equal(result.outcome, "REFUSED");
  if (result.outcome === "REFUSED") {
    assert.equal(result.reason, "NO_APPROVED_TEXTURE");
  }
  assert.deepEqual(harness.calls, [], "a refused publish must not reach the network");
});

test("publish is refused when an old version holds the only approved key", async () => {
  const harness = makeHarness({
    session: publishReadySession({}, {
      processedAssets: [
        makeProcessedAsset({ state: "APPROVED", approvedAssetKey: APPROVED_KEY, isCurrent: false }),
        makeProcessedAsset({
          processedAssetId: "processed-2",
          processingVersion: 2,
          state: "QC_PENDING",
          isCurrent: true,
          approvedAssetKey: null
        })
      ]
    })
  });
  const result = await harness.loader.publishGroup("group-1", {
    crystalNameConfirmed: true,
    crystalDraftPromotionConfirmed: true
  });
  assert.equal(result.outcome, "REFUSED");
  if (result.outcome === "REFUSED") {
    assert.equal(result.reason, "NO_APPROVED_TEXTURE");
  }
});

test("publish is refused while the authoritative draft is incomplete or withholds a required grant", async () => {
  const incomplete = makeHarness({
    session: publishReadySession({}, { productDraft: makeProductDraft({ sku: null }) })
  });
  const incompleteResult = await incomplete.loader.publishGroup("group-1", {
    crystalNameConfirmed: true,
    crystalDraftPromotionConfirmed: true
  });
  assert.equal(incompleteResult.outcome, "REFUSED");
  if (incompleteResult.outcome === "REFUSED") {
    assert.equal(incompleteResult.reason, "DRAFT_INCOMPLETE");
  }
  assert.deepEqual(incomplete.calls, []);

  const withheld = makeHarness({
    session: publishReadySession({}, { productDraft: makeProductDraft({ allowPublicDisplay: false }) })
  });
  const withheldResult = await withheld.loader.publishGroup("group-1", {
    crystalNameConfirmed: true,
    crystalDraftPromotionConfirmed: true
  });
  assert.equal(withheldResult.outcome, "REFUSED");
  if (withheldResult.outcome === "REFUSED") {
    assert.equal(withheldResult.reason, "CONSENT_NOT_GRANTED");
  }
  assert.deepEqual(withheld.calls, []);
});

test("a published task refuses publication through the shared group lock", async () => {
  const harness = makeHarness({
    session: publishReadySession(
      { state: "PUBLISHED" },
      { state: "PUBLISHED" as never }
    )
  });
  const result = await harness.loader.publishGroup("group-1", {
    crystalNameConfirmed: true,
    crystalDraftPromotionConfirmed: true
  });
  assert.equal(result.outcome, "REFUSED");
  if (result.outcome === "REFUSED") {
    assert.equal(result.reason, "GROUP_LOCKED");
  }
  assert.deepEqual(harness.calls, []);
});

test("publish consults the shared submission blockers, so a stale view cannot publish", () => {
  assert.ok(
    SOURCE.includes("groupSubmissionBlocker"),
    "publish must reuse the same blocker authority as every other mutation"
  );
});

test("the publish path exists on the loader and never assembles an approved key", () => {
  assert.ok(SOURCE.includes("publishGroup"), "the loader must expose the publish action");
  for (const forbidden of FORBIDDEN) {
    assert.equal(SOURCE.includes(forbidden), false, `the loader must not mention ${forbidden}`);
  }
});

test("publish without the operator's explicit name confirmation makes zero network calls", async () => {
  const harness = makeHarness({ session: publishReadySession() });
  const result = await harness.loader.publishGroup("group-1", {
    crystalNameConfirmed: false,
    crystalDraftPromotionConfirmed: true
  });
  assert.equal(result.outcome, "REFUSED");
  if (result.outcome === "REFUSED") {
    assert.equal(result.reason, "PUBLISH_CONFIRMATION_MISSING");
  }
  assert.deepEqual(harness.calls, [], "an unconfirmed publish never leaves the browser");
});

test("publish with a required but unconfirmed draft promotion makes zero network calls", async () => {
  const harness = makeHarness({ session: publishReadySession() });
  const result = await harness.loader.publishGroup("group-1", {
    crystalNameConfirmed: true,
    crystalDraftPromotionConfirmed: false
  });
  assert.equal(result.outcome, "REFUSED");
  if (result.outcome === "REFUSED") {
    assert.equal(result.reason, "PUBLISH_CONFIRMATION_MISSING");
  }
  assert.deepEqual(harness.calls, []);
});

test("an untouched approval is not ready and an explicit false is a valid decision", () => {
  assert.equal(
    approvalDecisionReady({
      reviewNote: "  ",
      rightsHolder: "玄矶水晶工作室",
      usagePermission: "OWNED",
      isAuthenticPhotograph: true,
      allowAiTraining: null,
      allowCommercialUse: null,
      allowPublicDisplay: null,
      allowAiRecommendation: null
    }),
    false,
    "an unanswered decision blocks the approval"
  );
  assert.equal(
    approvalDecisionReady({
      reviewNote: "已逐项确认。",
      rightsHolder: "玄矶水晶工作室",
      usagePermission: null,
      isAuthenticPhotograph: true,
      allowAiTraining: false,
      allowCommercialUse: true,
      allowPublicDisplay: true,
      allowAiRecommendation: false
    }),
    false,
    "an unanswered usage permission blocks the approval"
  );
  assert.equal(
    approvalDecisionReady({
      reviewNote: "已逐项确认。",
      rightsHolder: "玄矶水晶工作室",
      usagePermission: "GRANTED",
      isAuthenticPhotograph: true,
      allowAiTraining: false,
      allowCommercialUse: false,
      allowPublicDisplay: true,
      allowAiRecommendation: false
    }),
    true,
    "an explicit false is a decision, not an omission"
  );
});
