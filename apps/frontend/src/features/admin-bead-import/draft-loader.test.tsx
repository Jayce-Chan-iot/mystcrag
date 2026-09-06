import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  SaveBeadProductDraftRequestSchema,
  UpdateCrystalDraftCurationRequestSchema,
  type AssetImportCrystalDraftView,
  type AssetImportSessionGroupView,
  type AssetImportSessionResponse,
  type CheckBeadProductDraftCompletenessResponse,
  type DraftCompletenessField,
  type SaveBeadProductDraftRequest,
  type SaveBeadProductDraftResponse,
  type UpdateCrystalDraftCurationRequest,
  type UpdateCrystalDraftCurationResponse
} from "@mystcrag/design-contract";

import { BeadImportApiError } from "./api-client";
import type { AbortSignalLike } from "./session-lifecycle";
import {
  CONFLICT_NOTICE_MESSAGE,
  initialWorkflowState,
  isCompletenessCurrent,
  workflowReducer,
  type BeadImportWorkflowState,
  type WorkflowAction
} from "./workflow-state";

import {
  DRAFT_REFUSAL_MESSAGES,
  createDraftLoader,
  type DraftLoader,
  type DraftLoaderClient,
  type DraftRefusalReason
} from "./draft-loader";

const SOURCE = readFileSync(join(__dirname, "draft-loader.ts"), "utf8");

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

const FORBIDDEN_CLAIMS = ["治疗", "疗愈", "疗效", "招财", "转运", "辟邪", "保证", "一定能", "必定", "功效"];

const FORBIDDEN_INFERENCE = ["自动识别", "推荐名称", "已为你推断", "根据文件名", "根据文件夹"];

const SYNCED_AT = "2026-09-06T09:00:00.000Z";
const RESYNCED_AT = "2026-09-06T09:00:30.000Z";
const CHECKED_AT = "2026-09-06T09:05:00.000Z";
const SAVED_AT = "2026-09-06T09:10:00.000Z";

const CRYSTAL_DRAFT: AssetImportCrystalDraftView = {
  crystalDraftId: "crystal-draft-1",
  revision: 4,
  curationComplete: false,
  missingFields: ["COLOR_TAGS", "PRICE_LEVEL"],
  promotionEligible: false
};

/** Values an operator typed by hand. Nothing here is read off a file or an image. */
const TYPED_TEXT = {
  displayName: "白水晶圆珠 8mm",
  sku: "MXJ-BEAD-QUARTZ-08",
  materialKey: "quartz-round-v1",
  diameterMm: "8",
  unitPrice: "39.90",
  cost: "12.00",
  availableQuantity: "24",
  qualityStatement: "天然白水晶，肉眼可见少量内含物。",
  qualitySource: "供应商提供的批次说明，已由运营核对。",
  rightsHolder: "玄矶水晶工作室"
};

const TYPED_DECISIONS = {
  isAuthenticPhotograph: true,
  allowAiTraining: false,
  allowCommercialUse: true,
  allowPublicDisplay: true,
  allowAiRecommendation: true
};

const TYPED_CURATION = {
  nameCn: "白水晶",
  nameEn: "Clear Quartz",
  mineralName: "石英（二氧化硅）",
  colorTags: "白色, 透明",
  visualTags: "玻璃光泽",
  styleTags: "简约",
  priceLevel: "3",
  complianceNote: "仅作装饰用途，不涉及任何健康或命理承诺。"
};

function makeGroup(
  overrides: Partial<AssetImportSessionGroupView> = {}
): AssetImportSessionGroupView {
  return {
    groupId: "group-1",
    state: "NAMED",
    crystalName: "白水晶",
    memberFileIds: ["file-1"],
    revision: 3,
    processedAssets: [],
    crystalDraft: CRYSTAL_DRAFT,
    ...overrides
  };
}

function makeSession(
  overrides: Partial<AssetImportSessionResponse> = {}
): AssetImportSessionResponse {
  return {
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
    groups: [makeGroup()],
    ...overrides
  };
}

function draftSaved(
  overrides: Partial<SaveBeadProductDraftResponse> = {}
): SaveBeadProductDraftResponse {
  return {
    groupId: "group-1",
    state: "NAMED",
    revision: 4,
    crystalDraftId: "crystal-draft-1",
    crystalDraftRevision: 5,
    draftSavedAt: SAVED_AT,
    ...overrides
  };
}

function curationSaved(
  overrides: Partial<UpdateCrystalDraftCurationResponse> = {}
): UpdateCrystalDraftCurationResponse {
  return {
    crystalDraftId: "crystal-draft-1",
    revision: 5,
    curationComplete: true,
    missingFields: [],
    promotionEligible: true,
    updatedAt: SAVED_AT,
    ...overrides
  };
}

function completeness(
  overrides: Partial<CheckBeadProductDraftCompletenessResponse> = {}
): CheckBeadProductDraftCompletenessResponse {
  return {
    groupId: "group-1",
    state: "NAMED",
    complete: false,
    missingFields: ["TEXTURE_ASSET_KEY"] as DraftCompletenessField[],
    checkedAt: CHECKED_AT,
    ...overrides
  };
}

type RecordedDraft = {
  groupId: string;
  request: SaveBeadProductDraftRequest;
  signal: AbortSignalLike | undefined;
};

type RecordedCuration = {
  crystalDraftId: string;
  request: UpdateCrystalDraftCurationRequest;
  signal: AbortSignalLike | undefined;
};

type Harness = {
  loader: DraftLoader;
  dispatched: WorkflowAction[];
  drafts: RecordedDraft[];
  curations: RecordedCuration[];
  dispatch(action: WorkflowAction): void;
  types(): WorkflowAction["type"][];
  latest(): BeadImportWorkflowState;
  readonly sessionCalls: number;
  readonly completenessCalls: number;
  readonly aborted: number;
  setDraftResult(result: SaveBeadProductDraftResponse | Error | null): void;
  setCurationResult(result: UpdateCrystalDraftCurationResponse | Error | null): void;
  setCompletenessResult(result: CheckBeadProductDraftCompletenessResponse | Error): void;
  setSessionResult(session: AssetImportSessionResponse | Error): void;
  releaseDraft(result: SaveBeadProductDraftResponse | Error): void;
  releaseCuration(result: UpdateCrystalDraftCurationResponse | Error): void;
};

type HarnessOptions = {
  session?: AssetImportSessionResponse;
  withDraft?: boolean;
  withCuration?: boolean;
  gateDraft?: boolean;
  gateCuration?: boolean;
};

/** Refusal tests only need to know that nothing was sent. */
function unreachableClient(): DraftLoaderClient {
  const unused = (surface: string): never => {
    throw new assert.AssertionError({ message: `${surface} must not be called` });
  };
  return {
    saveGroupDraft: () => unused("saveGroupDraft"),
    getDraftCompleteness: () => unused("getDraftCompleteness"),
    updateCrystalDraft: () => unused("updateCrystalDraft"),
    getSession: () => unused("getSession")
  };
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const dispatched: WorkflowAction[] = [];
  const drafts: RecordedDraft[] = [];
  const curations: RecordedCuration[] = [];
  let current = workflowReducer(initialWorkflowState("session-1"), {
    type: "SESSION_LOADED",
    session: options.session ?? makeSession(),
    syncedAt: SYNCED_AT
  });
  if (options.withDraft !== false) {
    current = workflowReducer(current, {
      type: "EDIT_PRODUCT_DRAFT",
      groupId: "group-1",
      patch: { text: TYPED_TEXT, decisions: TYPED_DECISIONS, shape: "ROUND", currency: "CNY", usagePermission: "OWNED" }
    });
  }
  if (options.withCuration === true) {
    current = workflowReducer(current, {
      type: "EDIT_CURATION_DRAFT",
      crystalDraftId: "crystal-draft-1",
      patch: TYPED_CURATION
    });
  }

  const dispatch = (action: WorkflowAction): void => {
    dispatched.push(action);
    current = workflowReducer(current, action);
  };

  let sessionCalls = 0;
  let completenessCalls = 0;
  let aborted = 0;
  let draftResult: SaveBeadProductDraftResponse | Error | null = null;
  let curationResult: UpdateCrystalDraftCurationResponse | Error | null = null;
  let completenessResult: CheckBeadProductDraftCompletenessResponse | Error = completeness();
  let refreshedSession: AssetImportSessionResponse | Error = makeSession({ updatedAt: RESYNCED_AT });
  let keyCount = 0;
  let draftGate: ((result: SaveBeadProductDraftResponse | Error) => void) | null = null;
  let curationGate: ((result: UpdateCrystalDraftCurationResponse | Error) => void) | null = null;

  const loader = createDraftLoader({
    getState: () => current,
    dispatch,
    now: () => RESYNCED_AT,
    createIdempotencyKey: () => {
      keyCount += 1;
      return `curation-key-${keyCount}`;
    },
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
      async saveGroupDraft(groupId, request, requestOptions) {
        drafts.push({ groupId, request, signal: requestOptions?.signal });
        if (options.gateDraft === true) {
          assert.equal(draftGate, null, "only one gated draft save may be in flight");
          const result = await new Promise<SaveBeadProductDraftResponse | Error>((resolve) => {
            draftGate = resolve;
          });
          draftGate = null;
          if (result instanceof Error) {
            throw result;
          }
          return result;
        }
        if (draftResult instanceof Error) {
          throw draftResult;
        }
        if (draftResult !== null) {
          return draftResult;
        }
        return draftSaved({ groupId, revision: request.expectedGroupRevision + 1 });
      },
      async getDraftCompleteness(groupId, requestOptions) {
        completenessCalls += 1;
        assert.equal(groupId, "group-1");
        assert.equal(requestOptions?.signal !== undefined, true);
        if (completenessResult instanceof Error) {
          throw completenessResult;
        }
        return completenessResult;
      },
      async updateCrystalDraft(crystalDraftId, request, requestOptions) {
        curations.push({ crystalDraftId, request, signal: requestOptions?.signal });
        if (options.gateCuration === true) {
          assert.equal(curationGate, null, "only one gated curation save may be in flight");
          const result = await new Promise<UpdateCrystalDraftCurationResponse | Error>((resolve) => {
            curationGate = resolve;
          });
          curationGate = null;
          if (result instanceof Error) {
            throw result;
          }
          return result;
        }
        if (curationResult instanceof Error) {
          throw curationResult;
        }
        if (curationResult !== null) {
          return curationResult;
        }
        return curationSaved({ revision: request.expectedRevision + 1 });
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
    dispatched,
    drafts,
    curations,
    dispatch,
    types() {
      return dispatched.map((action) => action.type);
    },
    latest() {
      return current;
    },
    get sessionCalls() {
      return sessionCalls;
    },
    get completenessCalls() {
      return completenessCalls;
    },
    get aborted() {
      return aborted;
    },
    setDraftResult(result) {
      draftResult = result;
    },
    setCurationResult(result) {
      curationResult = result;
    },
    setCompletenessResult(result) {
      completenessResult = result;
    },
    setSessionResult(session) {
      refreshedSession = session;
    },
    releaseDraft(result) {
      const release = draftGate;
      draftGate = null;
      assert.ok(release !== null, "a draft save must be in flight before it is released");
      release(result);
    },
    releaseCuration(result) {
      const release = curationGate;
      curationGate = null;
      assert.ok(release !== null, "a curation save must be in flight before it is released");
      release(result);
    }
  };
}

function conflict(): Error {
  return new BeadImportApiError({ code: "CONFLICT", message: "stale", retryable: true, status: 409 });
}

/** One microtask hop is not enough: the loader resumes through several awaited hops. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test("every refusal the loader can make has copy an operator can act on", () => {
  const reasons = Object.keys(DRAFT_REFUSAL_MESSAGES).sort() as DraftRefusalReason[];
  for (const expected of [
    "NO_SESSION",
    "UNKNOWN_GROUP",
    "NOTHING_TO_SAVE",
    "INVALID_INPUT",
    "NO_CRYSTAL_DRAFT",
    "GROUP_LOCKED",
    "CONFLICT_BLOCKED",
    "IN_FLIGHT",
    "STALE"
  ]) {
    assert.ok(reasons.includes(expected as DraftRefusalReason), `${expected} must have copy`);
  }

  for (const reason of reasons) {
    const message = DRAFT_REFUSAL_MESSAGES[reason];
    assert.ok(message.length >= 6, `${reason} needs a real sentence`);
    for (const forbidden of [...FORBIDDEN_LEAKS, ...FORBIDDEN_CLAIMS, ...FORBIDDEN_INFERENCE]) {
      assert.equal(message.includes(forbidden), false, `${reason} must not mention ${forbidden}`);
    }
  }
  assert.equal(
    DRAFT_REFUSAL_MESSAGES.CONFLICT_BLOCKED,
    CONFLICT_NOTICE_MESSAGE,
    "a conflict reads the same everywhere in this console"
  );
});

test("a draft save is refused before any request when there is nothing to send", async () => {
  const harness = makeHarness({ withDraft: false });
  const result = await harness.loader.saveProductDraft("group-1");

  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reason, "NOTHING_TO_SAVE");
  assert.deepEqual(harness.drafts, [], "no request leaves the browser for an untouched form");
  assert.deepEqual(harness.dispatched, []);
});

test("a draft save is refused when the session has not loaded or the group is gone", async () => {
  const dispatched: WorkflowAction[] = [];
  const unloaded = createDraftLoader({
    client: unreachableClient(),
    getState: () => initialWorkflowState("session-1"),
    dispatch: (action) => dispatched.push(action),
    now: () => RESYNCED_AT,
    createIdempotencyKey: () => "k",
    createAbortController: () => ({ signal: { aborted: false }, abort: () => {} })
  });

  const missingSession = await unloaded.saveProductDraft("group-1");
  assert.equal(missingSession.outcome, "REFUSED");
  assert.equal(missingSession.reason, "NO_SESSION");

  const missingCuration = await unloaded.saveCuration("crystal-draft-1");
  assert.equal(missingCuration.outcome, "REFUSED");
  assert.equal(missingCuration.reason, "NO_SESSION");

  const missingCheck = await unloaded.checkCompleteness("group-1");
  assert.equal(missingCheck.outcome, "REFUSED");
  assert.equal(missingCheck.reason, "NO_SESSION");

  assert.deepEqual(dispatched, [], "a refusal before the session loaded changes nothing");

  const harness = makeHarness();
  const unknown = await harness.loader.saveProductDraft("group-missing");
  assert.equal(unknown.outcome, "REFUSED");
  assert.equal(unknown.reason, "UNKNOWN_GROUP");
  assert.deepEqual(harness.drafts, []);
});

test("a draft save sends the revision from the session, never one the operator typed", async () => {
  const harness = makeHarness();
  harness.dispatch({ type: "EDIT_PRODUCT_DRAFT", groupId: "group-1", patch: { text: { sku: "MXJ-2" } } });

  const result = await harness.loader.saveProductDraft("group-1");
  assert.equal(result.outcome, "APPLIED");
  assert.equal(harness.drafts.length, 1);

  const request = harness.drafts[0]?.request;
  assert.ok(request !== undefined);
  assert.equal(request.expectedGroupRevision, 3, "the group revision comes from the loaded session");
  assert.equal(request.sku, "MXJ-2");
  assert.equal(request.displayName, TYPED_TEXT.displayName);
  assert.equal(request.unitPriceMinor, 3990);
  assert.equal(request.crystalDraftId, "crystal-draft-1", "the draft the session carries is the one written");
  assert.equal("crystalId" in request, false, "no crystal id is invented here");
  assert.equal("textureAssetKey" in request, false, "an approved key is written by the Backend");

  const parsed = SaveBeadProductDraftRequestSchema.safeParse(request);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

test("a draft save is refused with the offending fields when the contract rejects the values", async () => {
  const harness = makeHarness();
  harness.dispatch({
    type: "EDIT_PRODUCT_DRAFT",
    groupId: "group-1",
    patch: { text: { sku: "   ", diameterMm: "0" } }
  });

  const result = await harness.loader.saveProductDraft("group-1");
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reason, "INVALID_INPUT");
  const fields = result.issues.map((issue) => issue.field).sort();
  assert.deepEqual(fields, ["diameterMm", "sku"]);
  assert.deepEqual(harness.drafts, [], "a body the contract refuses is never sent");
  assert.deepEqual(harness.types(), ["EDIT_PRODUCT_DRAFT"], "a refusal changes no state");
});

test("an accepted draft save records what the server accepted", async () => {
  const harness = makeHarness();
  const result = await harness.loader.saveProductDraft("group-1");

  assert.equal(result.outcome, "APPLIED");
  assert.deepEqual(harness.types(), ["GROUP_MUTATION_STARTED", "PRODUCT_DRAFT_SAVED"]);
  assert.equal(harness.sessionCalls, 0, "the response already describes the group it changed");

  const state = harness.latest();
  assert.equal(state.session?.groups[0]?.revision, 4);
  assert.equal(state.session?.groups[0]?.crystalDraft?.revision, 5);
  assert.deepEqual(state.inFlightGroupIds, []);
  assert.equal(state.draftForms["group-1"]?.baseRevision, 4);
  assert.equal(
    state.draftForms["group-1"]?.saved?.text.sku,
    TYPED_TEXT.sku,
    "what was accepted is remembered so a later edit reads as unsaved again"
  );
});

test("a draft save that creates a crystal draft reads the session back instead of guessing", async () => {
  const harness = makeHarness({ session: makeSession({ groups: [makeGroup({ crystalDraft: null })] }) });
  harness.setDraftResult(draftSaved({ crystalDraftId: "crystal-draft-9", crystalDraftRevision: 1 }));
  harness.setSessionResult(
    makeSession({
      groups: [
        makeGroup({
          revision: 4,
          crystalDraft: { ...CRYSTAL_DRAFT, crystalDraftId: "crystal-draft-9", revision: 1 }
        })
      ]
    })
  );

  const result = await harness.loader.saveProductDraft("group-1");
  assert.equal(result.outcome, "APPLIED");
  assert.equal(harness.sessionCalls, 1, "the save response carries no curation verdict to show");
  assert.equal(harness.latest().session?.groups[0]?.crystalDraft?.crystalDraftId, "crystal-draft-9");
});

test("a draft save that meets a 409 stops local submission and re-reads the server", async () => {
  const harness = makeHarness();
  harness.setDraftResult(conflict());
  harness.setSessionResult(makeSession({ groups: [makeGroup({ revision: 9 })] }));

  const result = await harness.loader.saveProductDraft("group-1");
  assert.equal(result.outcome, "CONFLICT");
  assert.deepEqual(harness.types(), ["GROUP_MUTATION_STARTED", "GROUP_MUTATION_CONFLICT", "SESSION_REFRESHED"]);
  assert.equal(harness.sessionCalls, 1);

  const state = harness.latest();
  assert.equal(state.blockedByConflict, true);
  assert.equal(state.refreshRequested, false, "the re-read already happened");
  assert.deepEqual(state.inFlightGroupIds, []);
  assert.equal(
    state.draftForms["group-1"]?.form.text.sku,
    TYPED_TEXT.sku,
    "a conflict is a reason to confirm, not to discard what the operator typed"
  );

  const blocked = await harness.loader.saveProductDraft("group-1");
  assert.equal(blocked.outcome, "REFUSED");
  assert.equal(blocked.reason, "CONFLICT_BLOCKED");
  assert.equal(harness.drafts.length, 1, "a blocked console sends nothing further");
});

test("a draft save that fails keeps the work and reports sanitised copy", async () => {
  const harness = makeHarness();
  harness.setDraftResult(
    new BeadImportApiError({
      code: "VALIDATION_ERROR",
      message: "column bead_product_draft.sku violates /Users/operator/secret",
      retryable: false,
      status: 422
    })
  );

  const result = await harness.loader.saveProductDraft("group-1");
  assert.equal(result.outcome, "FAILED");
  assert.equal(result.code, "VALIDATION_ERROR");
  assert.equal(result.retryable, false);
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.equal(result.message.includes(forbidden), false, `copy must not mention ${forbidden}`);
  }

  const state = harness.latest();
  assert.deepEqual(harness.types(), ["GROUP_MUTATION_STARTED", "GROUP_MUTATION_FAILED"]);
  assert.deepEqual(state.inFlightGroupIds, []);
  assert.equal(state.blockedByConflict, false, "a refusal is not a conflict");
  assert.equal(state.draftForms["group-1"]?.saved, null);
  assert.ok(
    state.notices.some((notice) => notice.id === "group-mutation-failure:group-1"),
    "the refusal is visible where the operator is working"
  );
});

test("a draft save for a locked group, a stale revision or an in-flight group is refused", async () => {
  const locked = makeHarness({
    session: makeSession({ state: "PUBLISHED", groups: [makeGroup({ state: "PUBLISHED" })] })
  });
  const lockedResult = await locked.loader.saveProductDraft("group-1");
  assert.equal(lockedResult.outcome, "REFUSED");
  assert.equal(lockedResult.reason, "GROUP_LOCKED");

  const harness = makeHarness();
  harness.dispatch({ type: "GROUP_MUTATION_STARTED", groupId: "group-1" });
  const inFlight = await harness.loader.saveProductDraft("group-1");
  assert.equal(inFlight.outcome, "REFUSED");
  assert.equal(inFlight.reason, "IN_FLIGHT");

  const stale = makeHarness();
  stale.dispatch({ type: "SESSION_REFRESHED", session: makeSession({ groups: [makeGroup({ revision: 8 })] }), syncedAt: RESYNCED_AT });
  const staleResult = await stale.loader.saveProductDraft("group-1");
  assert.equal(staleResult.outcome, "REFUSED");
  assert.equal(staleResult.reason, "STALE");
  assert.deepEqual(stale.drafts, []);
});

test("a completeness answer is stored against the revision the server was describing", async () => {
  const harness = makeHarness();
  const result = await harness.loader.checkCompleteness("group-1");

  assert.equal(result.outcome, "CHECKED");
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingFields, ["TEXTURE_ASSET_KEY"]);
  assert.equal(harness.completenessCalls, 1);
  assert.deepEqual(harness.types(), ["COMPLETENESS_CHECKED"]);

  const state = harness.latest();
  assert.equal(isCompletenessCurrent(state, "group-1"), true);
  assert.equal(state.draftCompleteness["group-1"]?.groupRevision, 3);
  assert.equal(state.draftCompleteness["group-1"]?.checkedAt, CHECKED_AT);
});

test("a completeness check that fails stores nothing and reports copy", async () => {
  const harness = makeHarness();
  harness.setCompletenessResult(
    new BeadImportApiError({ code: "NETWORK_ERROR", status: 0, message: "fetch failed", retryable: true })
  );

  const result = await harness.loader.checkCompleteness("group-1");
  assert.equal(result.outcome, "FAILED");
  assert.equal(result.retryable, true);
  assert.deepEqual(harness.dispatched, [], "an answer that never arrived is not recorded");
  assert.equal(harness.latest().draftCompleteness["group-1"], undefined);

  const refused = await makeHarness().loader.checkCompleteness("group-missing");
  assert.equal(refused.outcome, "REFUSED");
  assert.equal(refused.reason, "UNKNOWN_GROUP");
});

test("a curation save carries the draft's own revision and a fresh idempotency key", async () => {
  const harness = makeHarness({ withCuration: true });
  const result = await harness.loader.saveCuration("crystal-draft-1");

  assert.equal(result.outcome, "APPLIED");
  assert.equal(harness.curations.length, 1);
  const request = harness.curations[0]?.request;
  assert.ok(request !== undefined);
  assert.equal(request.expectedRevision, 4, "a curation patch is revisioned by the crystal draft");
  assert.equal(request.idempotencyKey, "curation-key-1");
  assert.equal(request.nameCn, TYPED_CURATION.nameCn);
  assert.deepEqual(request.colorTags, ["白色", "透明"]);
  assert.equal(request.priceLevel, 3);

  const parsed = UpdateCrystalDraftCurationRequestSchema.safeParse(request);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));

  const state = harness.latest();
  assert.deepEqual(harness.types(), ["CURATION_SAVE_STARTED", "CURATION_SAVE_APPLIED"]);
  assert.equal(state.session?.groups[0]?.crystalDraft?.curationComplete, true);
  assert.equal(state.session?.groups[0]?.crystalDraft?.promotionEligible, true);
  assert.deepEqual(state.session?.groups[0]?.crystalDraft?.missingFields, []);
  assert.deepEqual(state.inFlightCrystalDraftIds, []);
  assert.equal(state.curationForms["crystal-draft-1"]?.baseRevision, 5);
  assert.equal(harness.sessionCalls, 0, "the response carries the whole verdict");
});

test("a second curation save gets its own idempotency key so a retry cannot be replayed", async () => {
  const harness = makeHarness({ withCuration: true });
  await harness.loader.saveCuration("crystal-draft-1");
  harness.dispatch({
    type: "EDIT_CURATION_DRAFT",
    crystalDraftId: "crystal-draft-1",
    patch: { priceLevel: "4" }
  });
  await harness.loader.saveCuration("crystal-draft-1");

  assert.equal(harness.curations.length, 2);
  assert.equal(harness.curations[0]?.request.idempotencyKey, "curation-key-1");
  assert.equal(harness.curations[1]?.request.idempotencyKey, "curation-key-2");
  assert.equal(harness.curations[1]?.request.expectedRevision, 5);
});

test("a curation save is refused when the session carries no such crystal draft", async () => {
  const harness = makeHarness({ withCuration: true });
  const unknown = await harness.loader.saveCuration("crystal-draft-missing");
  assert.equal(unknown.outcome, "REFUSED");
  assert.equal(unknown.reason, "NO_CRYSTAL_DRAFT");

  const noDraft = makeHarness({
    session: makeSession({ groups: [makeGroup({ crystalDraft: null })] })
  });
  const absent = await noDraft.loader.saveCuration("crystal-draft-1");
  assert.equal(absent.outcome, "REFUSED");
  assert.equal(absent.reason, "NO_CRYSTAL_DRAFT");
  assert.deepEqual(noDraft.curations, []);

  const untouched = makeHarness();
  const nothing = await untouched.loader.saveCuration("crystal-draft-1");
  assert.equal(nothing.outcome, "REFUSED");
  assert.equal(nothing.reason, "NOTHING_TO_SAVE");
});

test("a curation save is refused with the offending fields when the contract rejects them", async () => {
  const harness = makeHarness();
  harness.dispatch({
    type: "EDIT_CURATION_DRAFT",
    crystalDraftId: "crystal-draft-1",
    patch: { ...TYPED_CURATION, priceLevel: "9", colorTags: "白色, 白色" }
  });

  const result = await harness.loader.saveCuration("crystal-draft-1");
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.reason, "INVALID_INPUT");
  assert.deepEqual(
    result.issues.map((issue) => issue.field).sort(),
    ["colorTags", "priceLevel"]
  );
  assert.deepEqual(harness.curations, []);
});

test("a curation 409 blocks submission, keeps the answers and re-reads the session", async () => {
  const harness = makeHarness({ withCuration: true });
  harness.setCurationResult(conflict());
  harness.setSessionResult(
    makeSession({ groups: [makeGroup({ crystalDraft: { ...CRYSTAL_DRAFT, revision: 12 } })] })
  );

  const result = await harness.loader.saveCuration("crystal-draft-1");
  assert.equal(result.outcome, "CONFLICT");
  assert.deepEqual(harness.types(), [
    "CURATION_SAVE_STARTED",
    "CURATION_SAVE_CONFLICT",
    "SESSION_REFRESHED"
  ]);
  assert.equal(harness.sessionCalls, 1);

  const state = harness.latest();
  assert.equal(state.blockedByConflict, true);
  assert.deepEqual(state.inFlightCrystalDraftIds, []);
  assert.equal(state.curationForms["crystal-draft-1"]?.form.priceLevel, TYPED_CURATION.priceLevel);

  const blocked = await harness.loader.saveCuration("crystal-draft-1");
  assert.equal(blocked.outcome, "REFUSED");
  assert.equal(blocked.reason, "CONFLICT_BLOCKED");
  assert.equal(harness.curations.length, 1);
});

test("a curation failure gets its own notice slot and leaves the work in place", async () => {
  const harness = makeHarness({ withCuration: true });
  harness.setCurationResult(
    new BeadImportApiError({
      code: "UNEXPECTED_RESPONSE",
      status: 200,
      message: "backend at http://127.0.0.1:4000 returned html",
      retryable: true
    })
  );

  const result = await harness.loader.saveCuration("crystal-draft-1");
  assert.equal(result.outcome, "FAILED");
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.equal(result.message.includes(forbidden), false, `copy must not mention ${forbidden}`);
  }

  const state = harness.latest();
  assert.deepEqual(harness.types(), ["CURATION_SAVE_STARTED", "CURATION_SAVE_FAILED"]);
  assert.deepEqual(state.inFlightCrystalDraftIds, []);
  assert.equal(state.blockedByConflict, false);
  assert.ok(state.notices.some((notice) => notice.id === "curation-failure:crystal-draft-1"));
  assert.equal(state.curationForms["crystal-draft-1"]?.saved, null);
});

test("cancelling aborts a live draft save and stops the loader dispatching", async () => {
  const harness = makeHarness({ gateDraft: true });
  const pending = harness.loader.saveProductDraft("group-1");
  await settled();
  assert.deepEqual(harness.types(), ["GROUP_MUTATION_STARTED"]);

  harness.loader.cancel();
  harness.releaseDraft(draftSaved());
  const result = await pending;
  await settled();

  assert.equal(result.outcome, "CANCELLED");
  assert.equal(harness.aborted, 1, "unmounting must not leave a request running");
  assert.deepEqual(
    harness.types(),
    ["GROUP_MUTATION_STARTED"],
    "a cancelled loader tells the state nothing more"
  );
  assert.equal(harness.sessionCalls, 0);
  assert.deepEqual(harness.latest().inFlightGroupIds, ["group-1"], "the state was not told to clear it");
});

test("cancelling also aborts a live curation save", async () => {
  const harness = makeHarness({ withCuration: true, gateCuration: true });
  const pending = harness.loader.saveCuration("crystal-draft-1");
  await settled();
  assert.deepEqual(harness.types(), ["CURATION_SAVE_STARTED"]);

  harness.loader.cancel();
  harness.releaseCuration(curationSaved());
  const result = await pending;
  await settled();

  assert.equal(result.outcome, "CANCELLED");
  assert.equal(harness.aborted, 1);
  assert.deepEqual(harness.types(), ["CURATION_SAVE_STARTED"]);
});

test("the loader reaches for the contract client and nothing else", () => {
  assert.equal(SOURCE.startsWith('"use client"'), false);
  assert.equal(SOURCE.includes("fetch("), false, "the api client owns transport");
  assert.equal(SOURCE.includes("XMLHttpRequest"), false);
  assert.equal(
    SOURCE.includes("approved:"),
    false,
    "an approved asset key is written by the Backend, never assembled here"
  );
  for (const forbidden of [...FORBIDDEN_LEAKS, ...FORBIDDEN_CLAIMS, ...FORBIDDEN_INFERENCE]) {
    assert.equal(SOURCE.includes(forbidden), false, `the loader must not mention ${forbidden}`);
  }
  assert.ok(
    SOURCE.includes("buildProductDraftRequest") && SOURCE.includes("buildCurationRequest"),
    "every bound is judged by the shared model, which the contract judges"
  );
});
