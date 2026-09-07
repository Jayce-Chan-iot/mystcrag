import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type {
  AssetImportCrystalDraftView,
  AssetImportSessionFileView,
  AssetImportSessionGroupView,
  AssetImportSessionResponse,
  BeadProductDraftView,
  SaveBeadProductDraftResponse,
  UpdateCrystalDraftCurationResponse
} from "@mystcrag/design-contract";

import { emptyProductDraftForm, type DraftCompletenessSnapshot } from "./draft-form";
import {
  CONFLICT_NOTICE_ID,
  CONFLICT_NOTICE_MESSAGE,
  CURATION_FAILURE_NOTICE_PREFIX,
  STALE_GROUP_NOTICE_ID,
  STALE_GROUP_NOTICE_MESSAGE,
  canSubmitCuration,
  canSubmitGroupMutation,
  completenessRecordFor,
  curationEntryFor,
  curationSubmissionBlocker,
  crystalDraftViewFor,
  groupIdOfCrystalDraft,
  groupSubmissionBlocker,
  initialWorkflowState,
  isCompletenessCurrent,
  isCurationDirty,
  isProductDraftDirty,
  productDraftEntryFor,
  workflowReducer
} from "./workflow-state";

const SOURCE = readFileSync(join(__dirname, "workflow-state.ts"), "utf8");

const SYNCED_AT = "2026-09-06T09:00:00.000Z";
const RESYNCED_AT = "2026-09-06T09:00:30.000Z";
const CHECKED_AT = "2026-09-06T09:05:00.000Z";
const SAVED_AT = "2026-09-06T09:10:00.000Z";

const CRYSTAL_DRAFT: AssetImportCrystalDraftView = {
  crystalDraftId: "crystal-draft-1",
  revision: 4,
  nameCn: null,
  nameEn: null,
  mineralName: null,
  colorTags: null,
  visualTags: null,
  styleTags: null,
  priceLevel: null,
  complianceNote: null,
  curationComplete: false,
  missingFields: ["COLOR_TAGS", "PRICE_LEVEL"],
  promotionEligible: false
};

const PRODUCT_DRAFT: BeadProductDraftView = {
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
  rightsHolder: "玄矶工作室",
  usagePermission: "OWNED",
  isAuthenticPhotograph: true,
  allowAiTraining: false,
  allowCommercialUse: true,
  allowPublicDisplay: true,
  allowAiRecommendation: false
};

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

function namedGroup(
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
    productDraft: null,
    ...overrides
  };
}

function reviewSession(
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
    files: [makeFile()],
    groups: [namedGroup()],
    ...overrides
  };
}

function loaded(sessionOverrides: Partial<AssetImportSessionResponse> = {}) {
  return workflowReducer(initialWorkflowState("session-1"), {
    type: "SESSION_LOADED",
    session: reviewSession(sessionOverrides),
    syncedAt: SYNCED_AT
  });
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

const COMPLETE: DraftCompletenessSnapshot = {
  complete: true,
  missingFields: [],
  checkedAt: CHECKED_AT
};

function checked(state: ReturnType<typeof loaded>, groupRevision = 3) {
  return workflowReducer(state, {
    type: "COMPLETENESS_CHECKED",
    groupId: "group-1",
    snapshot: COMPLETE,
    groupRevision
  });
}

function typed(state: ReturnType<typeof loaded>) {
  return workflowReducer(state, {
    type: "EDIT_PRODUCT_DRAFT",
    groupId: "group-1",
    patch: { text: { sku: "MXJ-BEAD-QUARTZ-08" }, decisions: { allowAiTraining: false } }
  });
}

function curated(state: ReturnType<typeof loaded>) {
  return workflowReducer(state, {
    type: "EDIT_CURATION_DRAFT",
    crystalDraftId: "crystal-draft-1",
    patch: { colorTags: "白色, 透明", priceLevel: "3" }
  });
}

function noticeIds(state: ReturnType<typeof loaded>): string[] {
  return state.notices.map((notice) => notice.id);
}

test("a fresh workflow state carries no naming work and no completeness answer", () => {
  const state = initialWorkflowState("session-1");
  assert.deepEqual(state.draftForms, {});
  assert.deepEqual(state.curationForms, {});
  assert.deepEqual(state.draftCompleteness, {});
  assert.deepEqual(state.staleCrystalDraftIds, []);
  assert.deepEqual(state.inFlightCrystalDraftIds, []);
  assert.equal(productDraftEntryFor(state, "group-1"), null);
  assert.equal(curationEntryFor(state, "crystal-draft-1"), null);
  assert.equal(completenessRecordFor(state, "group-1"), null);
  assert.equal(isCompletenessCurrent(state, "group-1"), false);
});

test("editing a product draft starts from an empty form and ignores a group it does not know", () => {
  const before = loaded();
  const after = typed(before);

  const entry = productDraftEntryFor(after, "group-1");
  assert.ok(entry !== null);
  assert.equal(entry.form.text.sku, "MXJ-BEAD-QUARTZ-08");
  assert.equal(entry.form.decisions.allowAiTraining, false);
  assert.equal(entry.form.text.displayName, "", "an unpatched field stays untouched");
  assert.equal(entry.saved, null, "nothing has been accepted by the server yet");
  assert.equal(entry.baseRevision, 3, "the save will carry the revision the operator is looking at");

  const unknown = workflowReducer(before, {
    type: "EDIT_PRODUCT_DRAFT",
    groupId: "group-missing",
    patch: { text: { sku: "MXJ-1" } }
  });
  assert.equal(unknown, before, "an edit for a group the session does not carry changes nothing");
  assert.equal(productDraftEntryFor(unknown, "group-missing"), null);
});

test("an answered rights decision is unsaved work and an untouched form is not", () => {
  const before = loaded();
  assert.equal(isProductDraftDirty(before, "group-1"), false);

  const answered = workflowReducer(before, {
    type: "EDIT_PRODUCT_DRAFT",
    groupId: "group-1",
    patch: { decisions: { allowAiTraining: false } }
  });
  assert.equal(
    isProductDraftDirty(answered, "group-1"),
    true,
    "an explicit no is a decision the server has not seen"
  );

  const putBack = workflowReducer(answered, {
    type: "EDIT_PRODUCT_DRAFT",
    groupId: "group-1",
    patch: { decisions: { allowAiTraining: null } }
  });
  assert.equal(isProductDraftDirty(putBack, "group-1"), false);

  const reset = workflowReducer(typed(before), { type: "RESET_PRODUCT_DRAFT", groupId: "group-1" });
  assert.equal(productDraftEntryFor(reset, "group-1"), null);
  assert.equal(isProductDraftDirty(reset, "group-1"), false);
});

test("saving a product draft records what was saved and rebases on the revision the server returned", () => {
  const before = typed(loaded());
  const saved = workflowReducer(before, {
    type: "PRODUCT_DRAFT_SAVED",
    groupId: "group-1",
    form: before.draftForms["group-1"]?.form ?? emptyProductDraftForm(),
    response: draftSaved()
  });

  const entry = productDraftEntryFor(saved, "group-1");
  assert.ok(entry !== null);
  assert.ok(entry.saved !== null);
  assert.equal(entry.saved.text.sku, "MXJ-BEAD-QUARTZ-08");
  assert.equal(entry.baseRevision, 4);
  assert.equal(isProductDraftDirty(saved, "group-1"), false, "what was accepted is no longer pending");
  assert.deepEqual(saved.inFlightGroupIds, []);
  assert.deepEqual(saved.staleGroupIds, []);

  const group = saved.session?.groups[0];
  assert.ok(group !== undefined);
  assert.equal(group.revision, 4, "the session view follows the server, not the operator's memory");
  assert.equal(group.crystalDraft?.revision, 5);

  const editedAgain = workflowReducer(saved, {
    type: "EDIT_PRODUCT_DRAFT",
    groupId: "group-1",
    patch: { text: { sku: "MXJ-BEAD-QUARTZ-10" } }
  });
  assert.equal(isProductDraftDirty(editedAgain, "group-1"), true);
});

test("saving a product draft drops the completeness answer it invalidates", () => {
  const before = checked(loaded());
  assert.equal(isCompletenessCurrent(before, "group-1"), true);

  const saved = workflowReducer(before, {
    type: "PRODUCT_DRAFT_SAVED",
    groupId: "group-1",
    form: emptyProductDraftForm(),
    response: draftSaved()
  });
  assert.equal(completenessRecordFor(saved, "group-1"), null);
  assert.equal(
    isCompletenessCurrent(saved, "group-1"),
    false,
    "the server has not re-checked the values it just accepted"
  );
});

test("a completeness answer stops being current when the group revision moves but is not forgotten", () => {
  const before = checked(loaded());
  assert.equal(isCompletenessCurrent(before, "group-1"), true);

  const renamed = workflowReducer(before, {
    type: "GROUP_MUTATION_APPLIED",
    groupId: "group-1",
    revision: 4
  });
  const record = completenessRecordFor(renamed, "group-1");
  assert.ok(record !== null, "the answer is kept so the operator can see what was checked");
  assert.equal(record.groupRevision, 3);
  assert.equal(
    isCompletenessCurrent(renamed, "group-1"),
    false,
    "a moved revision means the answer describes values that are no longer there"
  );

  const rechecked = workflowReducer(renamed, {
    type: "COMPLETENESS_CHECKED",
    groupId: "group-1",
    snapshot: { complete: false, missingFields: ["TEXTURE_ASSET_KEY"], checkedAt: CHECKED_AT },
    groupRevision: 4
  });
  assert.equal(isCompletenessCurrent(rechecked, "group-1"), true);
  assert.deepEqual(completenessRecordFor(rechecked, "group-1")?.missingFields, ["TEXTURE_ASSET_KEY"]);
});

test("a completeness answer for a group the session does not carry is refused", () => {
  const before = loaded();
  const after = workflowReducer(before, {
    type: "COMPLETENESS_CHECKED",
    groupId: "group-missing",
    snapshot: { ...COMPLETE },
    groupRevision: 3
  });
  assert.equal(after, before);
});

test("a draft save that creates a crystal draft asks for the session instead of inventing one", () => {
  const before = loaded({ groups: [namedGroup({ crystalDraft: null })] });
  const saved = workflowReducer(before, {
    type: "PRODUCT_DRAFT_SAVED",
    groupId: "group-1",
    form: emptyProductDraftForm(),
    response: draftSaved()
  });

  const group = saved.session?.groups[0];
  assert.ok(group !== undefined);
  assert.equal(
    group.crystalDraft,
    null,
    "the save response carries no curation verdict, so a view must not be fabricated"
  );
  assert.equal(saved.refreshRequested, true, "the authoritative session has to be read back");
});

test("a poll that still carries the group never overwrites unsaved naming work", () => {
  const before = typed(curated(loaded()));
  const polled = workflowReducer(before, {
    type: "SESSION_REFRESHED",
    session: reviewSession({ groups: [namedGroup({ revision: 3 })] }),
    syncedAt: RESYNCED_AT
  });

  assert.equal(polled.session?.groups[0]?.revision, 3);
  assert.equal(productDraftEntryFor(polled, "group-1")?.form.text.sku, "MXJ-BEAD-QUARTZ-08");
  assert.equal(curationEntryFor(polled, "crystal-draft-1")?.form.priceLevel, "3");
  assert.deepEqual(polled.staleGroupIds, []);
  assert.deepEqual(polled.staleCrystalDraftIds, []);
  assert.equal(polled.lastSyncedAt, RESYNCED_AT);
});

test("a poll that moves the group revision marks unsaved naming work stale", () => {
  const before = typed(curated(loaded()));
  const polled = workflowReducer(before, {
    type: "SESSION_REFRESHED",
    session: reviewSession({ groups: [namedGroup({ revision: 7 })] }),
    syncedAt: RESYNCED_AT
  });

  assert.deepEqual(polled.staleGroupIds, ["group-1"]);
  assert.ok(noticeIds(polled).includes(STALE_GROUP_NOTICE_ID));
  assert.equal(
    polled.notices.find((notice) => notice.id === STALE_GROUP_NOTICE_ID)?.message,
    STALE_GROUP_NOTICE_MESSAGE
  );
  assert.equal(
    productDraftEntryFor(polled, "group-1")?.form.text.sku,
    "MXJ-BEAD-QUARTZ-08",
    "stale means the operator has to confirm, not that the typing is thrown away"
  );
  assert.equal(canSubmitGroupMutation(polled, "group-1"), false);
  assert.deepEqual(
    polled.staleCrystalDraftIds,
    [],
    "a curation patch carries the crystal draft's own revision, so a moved group does not invalidate it"
  );
  assert.equal(canSubmitCuration(polled, "crystal-draft-1"), true);
});

test("a poll that moves the crystal draft revision marks unsaved curation stale", () => {
  const before = curated(loaded());
  const polled = workflowReducer(before, {
    type: "SESSION_REFRESHED",
    session: reviewSession({
      groups: [namedGroup({ crystalDraft: { ...CRYSTAL_DRAFT, revision: 6 } })]
    }),
    syncedAt: RESYNCED_AT
  });

  assert.deepEqual(polled.staleCrystalDraftIds, ["crystal-draft-1"]);
  assert.deepEqual(polled.staleGroupIds, [], "the group revision has not moved");
  assert.ok(noticeIds(polled).includes(STALE_GROUP_NOTICE_ID));
  assert.equal(canSubmitCuration(polled, "crystal-draft-1"), false);
  assert.equal(
    curationEntryFor(polled, "crystal-draft-1")?.form.priceLevel,
    "3",
    "the operator keeps what they typed and confirms it against the new revision"
  );

  const confirmed = workflowReducer(polled, {
    type: "EDIT_CURATION_DRAFT",
    crystalDraftId: "crystal-draft-1",
    patch: { priceLevel: "4" }
  });
  assert.deepEqual(confirmed.staleCrystalDraftIds, []);
  assert.equal(confirmed.curationForms["crystal-draft-1"]?.baseRevision, 6);
  assert.equal(canSubmitCuration(confirmed, "crystal-draft-1"), true);
});

test("already saved naming work is not reported stale when the server moves on", () => {
  const before = typed(loaded());
  const saved = workflowReducer(before, {
    type: "PRODUCT_DRAFT_SAVED",
    groupId: "group-1",
    form: before.draftForms["group-1"]?.form ?? emptyProductDraftForm(),
    response: draftSaved({ revision: 4, crystalDraftRevision: 5 })
  });
  const polled = workflowReducer(saved, {
    type: "SESSION_REFRESHED",
    session: reviewSession({
      groups: [namedGroup({ revision: 9, crystalDraft: { ...CRYSTAL_DRAFT, revision: 9 } })]
    }),
    syncedAt: RESYNCED_AT
  });

  assert.deepEqual(polled.staleGroupIds, []);
  assert.deepEqual(polled.staleCrystalDraftIds, []);
});

test("a session that drops the group drops the local work keyed to it", () => {
  const edited = workflowReducer(loaded(), {
    type: "EDIT_GROUP",
    edit: { groupId: "group-1", crystalName: "紫水晶" }
  });
  const before = checked(typed(curated(edited)));
  assert.ok(before.localEdits["group-1"] !== undefined);
  assert.ok(completenessRecordFor(before, "group-1") !== null);

  const pruned = workflowReducer(before, {
    type: "SESSION_REFRESHED",
    session: reviewSession({ groups: [] }),
    syncedAt: RESYNCED_AT
  });

  assert.deepEqual(pruned.localEdits, {});
  assert.deepEqual(pruned.draftForms, {});
  assert.deepEqual(pruned.curationForms, {});
  assert.deepEqual(pruned.draftCompleteness, {});
  assert.deepEqual(pruned.staleGroupIds, []);
  assert.deepEqual(pruned.staleCrystalDraftIds, []);
  assert.equal(
    pruned.notices.some((notice) => notice.id === STALE_GROUP_NOTICE_ID),
    false,
    "a group the server no longer carries cannot be waiting on the operator"
  );
});

test("curation edits are keyed by the crystal draft the session actually carries", () => {
  const before = loaded();
  const after = curated(before);

  const entry = curationEntryFor(after, "crystal-draft-1");
  assert.ok(entry !== null);
  assert.equal(entry.form.colorTags, "白色, 透明");
  assert.equal(entry.form.priceLevel, "3");
  assert.equal(entry.form.nameCn, "", "an unpatched field stays untouched");
  assert.ok(
    entry.saved !== null && entry.saved.colorTags === "" && entry.saved.priceLevel === "",
    "the seeded baseline is the server's own (still empty) curation view"
  );
  assert.equal(entry.baseRevision, 4);
  assert.equal(isCurationDirty(after, "crystal-draft-1"), true);

  const unknown = workflowReducer(before, {
    type: "EDIT_CURATION_DRAFT",
    crystalDraftId: "crystal-draft-missing",
    patch: { priceLevel: "3" }
  });
  assert.equal(unknown, before, "a draft the session does not carry cannot be edited into existence");
  assert.equal(curationEntryFor(unknown, "crystal-draft-missing"), null);
  assert.equal(isCurationDirty(before, "crystal-draft-1"), false);

  const reset = workflowReducer(after, {
    type: "RESET_CURATION_DRAFT",
    crystalDraftId: "crystal-draft-1"
  });
  assert.equal(curationEntryFor(reset, "crystal-draft-1"), null);
  assert.equal(isCurationDirty(reset, "crystal-draft-1"), false);
});

test("saving curation writes the server verdict into the session view", () => {
  const before = curated(loaded());
  const saving = workflowReducer(before, {
    type: "CURATION_SAVE_STARTED",
    crystalDraftId: "crystal-draft-1"
  });
  assert.deepEqual(saving.inFlightCrystalDraftIds, ["crystal-draft-1"]);
  assert.equal(canSubmitCuration(saving, "crystal-draft-1"), false, "one save at a time");
  assert.equal(
    workflowReducer(saving, { type: "CURATION_SAVE_STARTED", crystalDraftId: "crystal-draft-1" }),
    saving,
    "a second start for the same draft changes nothing"
  );

  const saved = workflowReducer(saving, {
    type: "CURATION_SAVE_APPLIED",
    crystalDraftId: "crystal-draft-1",
    response: curationSaved()
  });

  const draft = crystalDraftViewFor(saved, "group-1");
  assert.ok(draft !== null);
  assert.equal(draft.revision, 5);
  assert.equal(draft.curationComplete, true);
  assert.deepEqual(draft.missingFields, []);
  assert.equal(draft.promotionEligible, true);

  const entry = curationEntryFor(saved, "crystal-draft-1");
  assert.ok(entry !== null);
  assert.equal(entry.saved?.priceLevel, "3");
  assert.equal(entry.baseRevision, 5);
  assert.equal(isCurationDirty(saved, "crystal-draft-1"), false);
  assert.deepEqual(saved.inFlightCrystalDraftIds, []);
});

test("a curation conflict keeps what the operator typed, blocks the submit and asks for a refresh", () => {
  const before = curated(loaded());
  const saving = workflowReducer(before, {
    type: "CURATION_SAVE_STARTED",
    crystalDraftId: "crystal-draft-1"
  });
  const conflicted = workflowReducer(saving, {
    type: "CURATION_SAVE_CONFLICT",
    crystalDraftId: "crystal-draft-1"
  });

  assert.deepEqual(conflicted.inFlightCrystalDraftIds, []);
  assert.equal(conflicted.blockedByConflict, true);
  assert.equal(conflicted.refreshRequested, true);
  assert.ok(noticeIds(conflicted).includes(CONFLICT_NOTICE_ID));
  assert.equal(
    conflicted.notices.find((notice) => notice.id === CONFLICT_NOTICE_ID)?.message,
    CONFLICT_NOTICE_MESSAGE
  );
  assert.equal(
    curationEntryFor(conflicted, "crystal-draft-1")?.form.priceLevel,
    "3",
    "a conflict is a reason to re-read the server, not to discard the operator's answers"
  );
  assert.equal(canSubmitCuration(conflicted, "crystal-draft-1"), false);
  assert.equal(
    canSubmitGroupMutation(conflicted, "group-1"),
    false,
    "a conflict blocks every revision-bearing submit until the operator confirms"
  );
});

test("acknowledging a conflict rebases the group edits and the curation draft together", () => {
  const conflicted = workflowReducer(curated(typed(loaded())), {
    type: "CURATION_SAVE_CONFLICT",
    crystalDraftId: "crystal-draft-1"
  });
  const refreshed = workflowReducer(conflicted, {
    type: "SESSION_REFRESHED",
    session: reviewSession({
      groups: [namedGroup({ revision: 8, crystalDraft: { ...CRYSTAL_DRAFT, revision: 11 } })]
    }),
    syncedAt: RESYNCED_AT
  });
  assert.equal(refreshed.blockedByConflict, true, "a refresh alone does not clear the block");

  const acknowledged = workflowReducer(refreshed, { type: "CONFLICT_ACKNOWLEDGED" });
  assert.equal(acknowledged.blockedByConflict, false);
  assert.deepEqual(acknowledged.staleGroupIds, []);
  assert.deepEqual(acknowledged.staleCrystalDraftIds, []);
  assert.deepEqual(noticeIds(acknowledged), []);
  assert.equal(productDraftEntryFor(acknowledged, "group-1")?.baseRevision, 8);
  assert.equal(curationEntryFor(acknowledged, "crystal-draft-1")?.baseRevision, 11);
  assert.equal(
    curationEntryFor(acknowledged, "crystal-draft-1")?.form.priceLevel,
    "3",
    "rebasing moves the revision, not the answers"
  );
  assert.equal(canSubmitCuration(acknowledged, "crystal-draft-1"), true);
});

test("acknowledging is a no-op when nothing is blocked and nothing is stale", () => {
  const before = typed(loaded());
  assert.equal(workflowReducer(before, { type: "CONFLICT_ACKNOWLEDGED" }), before);
});

test("a curation failure gets its own notice slot so one refusal never hides another", () => {
  const before = curated(loaded({ groups: [namedGroup()] }));
  const failed = workflowReducer(before, {
    type: "CURATION_SAVE_FAILED",
    crystalDraftId: "crystal-draft-1",
    message: "水晶资料未能保存，请稍后重试。"
  });

  const noticeId = `${CURATION_FAILURE_NOTICE_PREFIX}crystal-draft-1`;
  assert.ok(noticeIds(failed).includes(noticeId));
  assert.equal(
    failed.notices.find((notice) => notice.id === noticeId)?.message,
    "水晶资料未能保存，请稍后重试。"
  );
  assert.deepEqual(failed.inFlightCrystalDraftIds, []);
  assert.equal(isCurationDirty(failed, "crystal-draft-1"), true, "a refusal leaves the work in place");

  const recovered = workflowReducer(failed, {
    type: "CURATION_SAVE_APPLIED",
    crystalDraftId: "crystal-draft-1",
    response: curationSaved()
  });
  assert.equal(noticeIds(recovered).includes(noticeId), false, "accepting the save clears its refusal");
});

test("curation submit authority follows the session, the conflict block and its own in-flight guard", () => {
  const ready = typed(curated(loaded()));
  assert.equal(canSubmitGroupMutation(ready, "group-1"), true);
  assert.equal(canSubmitCuration(ready, "crystal-draft-1"), true);

  const published = typed(
    curated(loaded({ state: "PUBLISHED", groups: [namedGroup({ state: "PUBLISHED" })] }))
  );
  assert.equal(canSubmitGroupMutation(published, "group-1"), false);
  assert.equal(canSubmitCuration(published, "crystal-draft-1"), false);

  const inFlight = workflowReducer(ready, {
    type: "GROUP_MUTATION_STARTED",
    groupId: "group-1"
  });
  assert.equal(canSubmitGroupMutation(inFlight, "group-1"), false);
  assert.equal(
    canSubmitCuration(inFlight, "crystal-draft-1"),
    true,
    "a group save in flight does not lock an unrelated crystal draft"
  );

  const noDraft = curated(loaded({ groups: [namedGroup({ crystalDraft: null })] }));
  assert.equal(
    canSubmitCuration(noDraft, "crystal-draft-1"),
    false,
    "a crystal draft the session no longer carries cannot be patched"
  );
  assert.equal(canSubmitCuration(ready, "crystal-draft-missing"), false);
});

test("a refused submission names which of the four blocks stopped it", () => {
  const ready = typed(curated(loaded()));
  assert.equal(groupSubmissionBlocker(ready, "group-1"), null);
  assert.equal(curationSubmissionBlocker(ready, "crystal-draft-1"), null);
  assert.equal(groupIdOfCrystalDraft(ready, "crystal-draft-1"), "group-1");
  assert.equal(groupIdOfCrystalDraft(ready, "crystal-draft-missing"), null);

  const published = typed(
    curated(loaded({ state: "PUBLISHED", groups: [namedGroup({ state: "PUBLISHED" })] }))
  );
  assert.equal(groupSubmissionBlocker(published, "group-1"), "GROUP_LOCKED");
  assert.equal(curationSubmissionBlocker(published, "crystal-draft-1"), "GROUP_LOCKED");

  const conflicted = workflowReducer(ready, { type: "GROUP_MUTATION_CONFLICT", groupId: "group-1" });
  assert.equal(groupSubmissionBlocker(conflicted, "group-1"), "CONFLICT_BLOCKED");
  assert.equal(
    curationSubmissionBlocker(conflicted, "crystal-draft-1"),
    "CONFLICT_BLOCKED",
    "a conflict blocks every revision-bearing submit until the operator confirms"
  );

  const groupInFlight = workflowReducer(ready, { type: "GROUP_MUTATION_STARTED", groupId: "group-1" });
  assert.equal(groupSubmissionBlocker(groupInFlight, "group-1"), "IN_FLIGHT");
  assert.equal(
    curationSubmissionBlocker(groupInFlight, "crystal-draft-1"),
    null,
    "a group save in flight does not lock an unrelated crystal draft"
  );

  const curationInFlight = workflowReducer(ready, {
    type: "CURATION_SAVE_STARTED",
    crystalDraftId: "crystal-draft-1"
  });
  assert.equal(curationSubmissionBlocker(curationInFlight, "crystal-draft-1"), "IN_FLIGHT");
  assert.equal(groupSubmissionBlocker(curationInFlight, "group-1"), null);

  const staleGroup = workflowReducer(typed(loaded()), {
    type: "SESSION_REFRESHED",
    session: reviewSession({ groups: [namedGroup({ revision: 9 })] }),
    syncedAt: RESYNCED_AT
  });
  assert.equal(groupSubmissionBlocker(staleGroup, "group-1"), "STALE");
  assert.equal(curationSubmissionBlocker(staleGroup, "crystal-draft-1"), null);

  const staleCuration = workflowReducer(curated(loaded()), {
    type: "SESSION_REFRESHED",
    session: reviewSession({ groups: [namedGroup({ crystalDraft: { ...CRYSTAL_DRAFT, revision: 6 } })] }),
    syncedAt: RESYNCED_AT
  });
  assert.equal(curationSubmissionBlocker(staleCuration, "crystal-draft-1"), "STALE");
  assert.equal(groupSubmissionBlocker(staleCuration, "group-1"), null);

  const states = [
    ready,
    published,
    conflicted,
    groupInFlight,
    curationInFlight,
    staleGroup,
    staleCuration
  ];
  for (const state of states) {
    assert.equal(
      canSubmitGroupMutation(state, "group-1"),
      groupSubmissionBlocker(state, "group-1") === null,
      "the authority and its explanation never disagree"
    );
  }
});

test("the draft slice stores no storage path, admin key or inferred crystal identity", () => {
  for (const forbidden of [
    "archiveKey",
    "storageKey",
    "x-admin-key",
    "MYSTCRAG_ASSET_ADMIN_KEY",
    "ASSET_ADMIN_API_KEY",
    "MYSTCRAG_BACKEND_ORIGIN",
    "MYSTCRAG_ASSET_ARCHIVE_ROOT",
    "localhost",
    "/Users/",
    "prisma",
    "process.env",
    "localStorage",
    "sessionStorage",
    "自动识别",
    "推荐名称",
    "根据文件名",
    "根据文件夹",
    "治疗",
    "疗愈",
    "功效",
    "保证",
    "必定"
  ]) {
    assert.equal(SOURCE.includes(forbidden), false, `the state must not mention ${forbidden}`);
  }
  assert.equal(
    SOURCE.includes("approved:"),
    false,
    "an approved asset key is written by the Backend, never assembled here"
  );
  assert.ok(
    SOURCE.includes("emptyProductDraftForm") && SOURCE.includes("emptyCurationForm"),
    "the draft slice must start from the shared model's empty forms"
  );
  assert.ok(
    !SOURCE.includes("curationComplete: true") && !SOURCE.includes("promotionEligible: true"),
    "a curation verdict is the server's to give, so the state must not assert one"
  );
});

function crystalDraftWithCuration(): AssetImportCrystalDraftView {
  return {
    ...CRYSTAL_DRAFT,
    nameCn: "白水晶",
    nameEn: "Clear Quartz",
    mineralName: "石英",
    colorTags: ["白色", "透明"],
    visualTags: ["冰裂"],
    styleTags: ["简约"],
    priceLevel: 3,
    complianceNote: "仅描述材质与外观，不涉及任何功效。",
    curationComplete: true,
    missingFields: [],
    promotionEligible: true
  };
}

test("a loaded session seeds the product draft form from the authoritative productDraft", () => {
  const state = loaded({ groups: [namedGroup({ productDraft: PRODUCT_DRAFT })] });

  const entry = productDraftEntryFor(state, "group-1");
  assert.ok(entry !== null, "the operator must see what the server already holds");
  assert.equal(entry.form.text.displayName, "天然白水晶圆珠手串");
  assert.equal(entry.form.text.sku, "MXJ-BEAD-QUARTZ-08");
  assert.equal(
    entry.form.text.unitPrice,
    "12.5",
    "a minor-unit price is shown in the major units the form collects"
  );
  assert.equal(entry.form.text.availableQuantity, "25");
  assert.equal(entry.form.shape, "ROUND");
  assert.equal(entry.form.currency, "CNY");
  assert.equal(entry.form.usagePermission, "OWNED");
  assert.equal(entry.form.decisions.isAuthenticPhotograph, true);
  assert.equal(entry.form.decisions.allowAiTraining, false);
  assert.ok(entry.saved !== null && entry.saved.text.displayName === "天然白水晶圆珠手串");
  assert.equal(entry.baseRevision, 3);
  assert.equal(isProductDraftDirty(state, "group-1"), false, "the server's own values read as clean");
});

test("a loaded session seeds every curation field from the full CrystalDraft view", () => {
  const state = loaded({ groups: [namedGroup({ crystalDraft: crystalDraftWithCuration() })] });

  const entry = curationEntryFor(state, "crystal-draft-1");
  assert.ok(entry !== null);
  assert.equal(entry.form.nameCn, "白水晶");
  assert.equal(entry.form.nameEn, "Clear Quartz");
  assert.equal(entry.form.mineralName, "石英");
  assert.equal(entry.form.colorTags, "白色、透明", "tag arrays read back as one editable list");
  assert.equal(entry.form.visualTags, "冰裂");
  assert.equal(entry.form.styleTags, "简约");
  assert.equal(entry.form.priceLevel, "3");
  assert.equal(entry.form.complianceNote, "仅描述材质与外观，不涉及任何功效。");
  assert.ok(entry.saved !== null && entry.saved.nameCn === "白水晶");
  assert.equal(entry.baseRevision, 4);
  assert.equal(isCurationDirty(state, "crystal-draft-1"), false);
});

test("an unsaved operator draft is never overwritten by a seeded server view", () => {
  const before = typed(loaded({ groups: [namedGroup({ productDraft: PRODUCT_DRAFT })] }));
  const localSku = productDraftEntryFor(before, "group-1")?.form.text.sku;
  assert.equal(localSku, "MXJ-BEAD-QUARTZ-08");
  const operatorSku = workflowReducer(before, {
    type: "EDIT_PRODUCT_DRAFT",
    groupId: "group-1",
    patch: { text: { sku: "MXJ-OPERATOR-01" } }
  });

  const polled = workflowReducer(operatorSku, {
    type: "SESSION_REFRESHED",
    session: reviewSession({ groups: [namedGroup({ productDraft: PRODUCT_DRAFT })] }),
    syncedAt: RESYNCED_AT
  });
  assert.equal(
    productDraftEntryFor(polled, "group-1")?.form.text.sku,
    "MXJ-OPERATOR-01",
    "unsaved typing wins over hydration"
  );
  assert.equal(isProductDraftDirty(polled, "group-1"), true);

  const curatedBefore = curated(
    loaded({ groups: [namedGroup({ crystalDraft: crystalDraftWithCuration() })] })
  );
  const curatedPolled = workflowReducer(curatedBefore, {
    type: "SESSION_REFRESHED",
    session: reviewSession({ groups: [namedGroup({ crystalDraft: crystalDraftWithCuration() })] }),
    syncedAt: RESYNCED_AT
  });
  assert.equal(
    curationEntryFor(curatedPolled, "crystal-draft-1")?.form.priceLevel,
    "3",
    "the operator's own curation answer is preserved"
  );
});

test("a clean draft follows the server view when a refresh brings new values", () => {
  const seeded = loaded({ groups: [namedGroup({ productDraft: PRODUCT_DRAFT })] });
  const updated = workflowReducer(seeded, {
    type: "SESSION_REFRESHED",
    session: reviewSession({
      groups: [
        namedGroup({
          revision: 5,
          productDraft: { ...PRODUCT_DRAFT, displayName: "天然白水晶圆珠手串（改）", unitPriceMinor: 1300 }
        })
      ]
    }),
    syncedAt: RESYNCED_AT
  });

  const entry = productDraftEntryFor(updated, "group-1");
  assert.ok(entry !== null);
  assert.equal(entry.form.text.displayName, "天然白水晶圆珠手串（改）");
  assert.equal(entry.form.text.unitPrice, "13");
  assert.equal(entry.baseRevision, 5);
  assert.equal(isProductDraftDirty(updated, "group-1"), false);
});

test("saving curation keeps the full crystal draft view instead of downgrading it", () => {
  const before = loaded({ groups: [namedGroup({ crystalDraft: crystalDraftWithCuration() })] });
  const saving = workflowReducer(before, {
    type: "CURATION_SAVE_STARTED",
    crystalDraftId: "crystal-draft-1"
  });
  const saved = workflowReducer(saving, {
    type: "CURATION_SAVE_APPLIED",
    crystalDraftId: "crystal-draft-1",
    response: curationSaved({ revision: 6 })
  });

  const draft = crystalDraftViewFor(saved, "group-1");
  assert.ok(draft !== null);
  assert.equal(draft.nameCn, "白水晶", "the curated fields survive the save");
  assert.equal(draft.priceLevel, 3);
  assert.equal(draft.revision, 6);
  assert.equal(draft.curationComplete, true);
  assert.deepEqual(draft.missingFields, []);
  assert.equal(draft.promotionEligible, true);
});

test("a group without a server draft still starts from the shared empty form", () => {
  const state = loaded();
  const entry = productDraftEntryFor(state, "group-1");
  assert.equal(entry, null, "no draft, no invented values");

  const afterTyping = typed(state);
  assert.equal(productDraftEntryFor(afterTyping, "group-1")?.form.text.displayName, "");
});
