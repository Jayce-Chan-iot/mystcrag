import type {
  AssetImportCrystalDraftView,
  AssetImportSessionResponse,
  AssetImportSessionState,
  AssetUsagePermission,
  SaveBeadProductDraftResponse,
  SupportedCurrency,
  UpdateCrystalDraftCurationResponse
} from "@mystcrag/design-contract";

import {
  PRODUCT_DRAFT_DECISION_FIELDS,
  PRODUCT_DRAFT_TEXT_FIELDS,
  emptyCurationForm,
  emptyProductDraftForm,
  isCurationFormEmpty,
  isProductDraftFormEmpty,
  sameCurationForm,
  sameProductDraftForm,
  type BeadShape,
  type CurationForm,
  type DraftCompletenessSnapshot,
  type ProductDraftDecisionField,
  type ProductDraftForm,
  type ProductDraftTextField
} from "./draft-form";
import {
  isWorkflowStepReachable,
  resolveWorkflowStep,
  summarizeUploadProgress,
  type WorkflowStep
} from "./workflow-model";

export const CONFLICT_NOTICE_ID = "group-revision-conflict";
export const CONFLICT_NOTICE_MESSAGE = "数据已更新，请确认后重试。";
export const STALE_GROUP_NOTICE_ID = "group-revision-stale";
export const STALE_GROUP_NOTICE_MESSAGE = "分组数据已在服务端更新，请确认后重试。";
export const LOAD_ERROR_NOTICE_ID = "session-load-error";
export const LOAD_ERROR_NOTICE_MESSAGE = "无法载入导入任务，请稍后重试。";
export const UPLOAD_FAILURE_NOTICE_ID = "upload-failures";
export const GROUP_MUTATION_FAILURE_NOTICE_PREFIX = "group-mutation-failure:";
export const CURATION_FAILURE_NOTICE_PREFIX = "curation-failure:";

export type WorkflowNoticeTone = "info" | "success" | "warning" | "danger";

export type WorkflowNotice = {
  id: string;
  tone: WorkflowNoticeTone;
  message: string;
};

export type WorkflowErrorInfo = {
  code: string;
  message: string;
  retryable: boolean;
};

export type LocalGroupEdit = {
  groupId: string;
  baseRevision: number;
  crystalName?: string;
  memberFileIds?: string[];
  primaryFileId?: string;
  ignoredFileIds?: string[];
};

export type GroupEditInput = {
  groupId: string;
  crystalName?: string;
  memberFileIds?: string[];
  primaryFileId?: string;
  ignoredFileIds?: string[];
};

export type ProductDraftPatch = {
  text?: Partial<Record<ProductDraftTextField, string>>;
  decisions?: Partial<Record<ProductDraftDecisionField, boolean | null>>;
  shape?: BeadShape | null;
  currency?: SupportedCurrency | null;
  usagePermission?: AssetUsagePermission | null;
};

export type CurationPatch = Partial<CurationForm>;

/**
 * `saved` is the last form the Backend accepted, so an edit that is put back
 * reads as clean again. `baseRevision` is the group revision that acceptance was
 * against; a save carries it as `expectedGroupRevision`.
 */
export type ProductDraftEntry = {
  form: ProductDraftForm;
  saved: ProductDraftForm | null;
  baseRevision: number;
};

/** As above, but revisioned by the crystal draft a curation patch is sent against. */
export type CurationEntry = {
  form: CurationForm;
  saved: CurationForm | null;
  baseRevision: number;
};

/** The group revision the server was describing, so a moved revision reads as unchecked. */
export type DraftCompletenessRecord = DraftCompletenessSnapshot & { groupRevision: number };

export type WorkflowLoadStatus = "IDLE" | "LOADING" | "READY" | "ERROR";

export type BeadImportWorkflowState = {
  sessionId: string | null;
  session: AssetImportSessionResponse | null;
  status: WorkflowLoadStatus;
  resolvedStep: WorkflowStep;
  requestedStep: WorkflowStep | null;
  notices: WorkflowNotice[];
  localEdits: Record<string, LocalGroupEdit>;
  draftForms: Record<string, ProductDraftEntry>;
  draftCompleteness: Record<string, DraftCompletenessRecord>;
  curationForms: Record<string, CurationEntry>;
  staleGroupIds: string[];
  staleCrystalDraftIds: string[];
  inFlightGroupIds: string[];
  inFlightCrystalDraftIds: string[];
  blockedByConflict: boolean;
  refreshRequested: boolean;
  polling: boolean;
  lastSyncedAt: string | null;
  error: WorkflowErrorInfo | null;
};

export type WorkflowAction =
  | { type: "SESSION_REQUESTED"; sessionId: string }
  | { type: "SESSION_LOADED"; session: AssetImportSessionResponse; syncedAt: string }
  | { type: "SESSION_REFRESHED"; session: AssetImportSessionResponse; syncedAt: string }
  | { type: "SESSION_FAILED"; error: WorkflowErrorInfo }
  | { type: "REQUEST_STEP"; step: WorkflowStep }
  | { type: "EDIT_GROUP"; edit: GroupEditInput }
  | { type: "DISCARD_GROUP_EDIT"; groupId: string }
  | { type: "GROUP_MUTATION_STARTED"; groupId: string }
  | { type: "GROUP_MUTATION_APPLIED"; groupId: string; revision: number }
  | { type: "GROUP_MUTATION_CONFLICT"; groupId: string }
  | { type: "GROUP_MUTATION_FAILED"; groupId: string; message: string }
  | { type: "EDIT_PRODUCT_DRAFT"; groupId: string; patch: ProductDraftPatch }
  | { type: "RESET_PRODUCT_DRAFT"; groupId: string }
  | {
      type: "PRODUCT_DRAFT_SAVED";
      groupId: string;
      form: ProductDraftForm;
      response: SaveBeadProductDraftResponse;
    }
  | {
      type: "COMPLETENESS_CHECKED";
      groupId: string;
      snapshot: DraftCompletenessSnapshot;
      groupRevision: number;
    }
  | { type: "EDIT_CURATION_DRAFT"; crystalDraftId: string; patch: CurationPatch }
  | { type: "RESET_CURATION_DRAFT"; crystalDraftId: string }
  | { type: "CURATION_SAVE_STARTED"; crystalDraftId: string }
  | {
      type: "CURATION_SAVE_APPLIED";
      crystalDraftId: string;
      response: UpdateCrystalDraftCurationResponse;
    }
  | { type: "CURATION_SAVE_CONFLICT"; crystalDraftId: string }
  | { type: "CURATION_SAVE_FAILED"; crystalDraftId: string; message: string }
  | { type: "CONFLICT_ACKNOWLEDGED" }
  | { type: "DISMISS_NOTICE"; noticeId: string };

/** States in which the Backend refuses any group edit with a conflict. */
const SESSION_LOCKED_STATES: ReadonlySet<AssetImportSessionState> = new Set([
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "CANCELLED"
]);

/** States that advance on the server without operator input, so they are worth polling. */
const POLLING_STATES: ReadonlySet<AssetImportSessionState> = new Set([
  "UPLOADING",
  "ARCHIVING",
  "PROCESSING",
  "PUBLISHING"
]);

export function initialWorkflowState(sessionId: string | null = null): BeadImportWorkflowState {
  return {
    sessionId,
    session: null,
    status: "IDLE",
    resolvedStep: "UPLOAD_FOLDER",
    requestedStep: null,
    notices: [],
    localEdits: {},
    draftForms: {},
    draftCompleteness: {},
    curationForms: {},
    staleGroupIds: [],
    staleCrystalDraftIds: [],
    inFlightGroupIds: [],
    inFlightCrystalDraftIds: [],
    blockedByConflict: false,
    refreshRequested: false,
    polling: false,
    lastSyncedAt: null,
    error: null
  };
}

export function shouldPollSession(session: AssetImportSessionResponse): boolean {
  return POLLING_STATES.has(session.state);
}

export function isSessionLocked(state: BeadImportWorkflowState): boolean {
  return state.session !== null && SESSION_LOCKED_STATES.has(state.session.state);
}

export function currentWorkflowStep(state: BeadImportWorkflowState): WorkflowStep {
  const { session, requestedStep } = state;
  if (session !== null && requestedStep !== null && isWorkflowStepReachable(session, requestedStep)) {
    return requestedStep;
  }
  return state.resolvedStep;
}

function findGroup(state: BeadImportWorkflowState, groupId: string) {
  return state.session?.groups.find((group) => group.groupId === groupId);
}

export function groupRevisionFor(state: BeadImportWorkflowState, groupId: string): number | null {
  const group = findGroup(state, groupId);
  return group === undefined ? null : group.revision;
}

export function canEditGroups(state: BeadImportWorkflowState, groupId: string): boolean {
  if (isSessionLocked(state)) {
    return false;
  }
  const group = findGroup(state, groupId);
  return group !== undefined && group.state !== "PUBLISHED";
}

export function canSubmitGroupMutation(state: BeadImportWorkflowState, groupId: string): boolean {
  if (!canEditGroups(state, groupId)) {
    return false;
  }
  if (state.blockedByConflict || state.inFlightGroupIds.includes(groupId)) {
    return false;
  }
  return !state.staleGroupIds.includes(groupId);
}

export function crystalDraftViewFor(
  state: BeadImportWorkflowState,
  groupId: string
): AssetImportCrystalDraftView | null {
  return findGroup(state, groupId)?.crystalDraft ?? null;
}

export function productDraftEntryFor(
  state: BeadImportWorkflowState,
  groupId: string
): ProductDraftEntry | null {
  return state.draftForms[groupId] ?? null;
}

export function curationEntryFor(
  state: BeadImportWorkflowState,
  crystalDraftId: string
): CurationEntry | null {
  return state.curationForms[crystalDraftId] ?? null;
}

export function isProductDraftDirty(state: BeadImportWorkflowState, groupId: string): boolean {
  const entry = state.draftForms[groupId];
  return entry !== undefined && isProductDraftEntryDirty(entry);
}

export function isCurationDirty(state: BeadImportWorkflowState, crystalDraftId: string): boolean {
  const entry = state.curationForms[crystalDraftId];
  return entry !== undefined && isCurationEntryDirty(entry);
}

export function completenessRecordFor(
  state: BeadImportWorkflowState,
  groupId: string
): DraftCompletenessRecord | null {
  return state.draftCompleteness[groupId] ?? null;
}

/**
 * A completeness answer describes the values the server held at one group
 * revision. It is kept after the revision moves so the operator can still see
 * what was checked, but it stops counting as an answer about what is there now.
 */
export function isCompletenessCurrent(state: BeadImportWorkflowState, groupId: string): boolean {
  const record = state.draftCompleteness[groupId];
  if (record === undefined) {
    return false;
  }
  return groupRevisionFor(state, groupId) === record.groupRevision;
}

export function canSubmitCuration(state: BeadImportWorkflowState, crystalDraftId: string): boolean {
  if (state.blockedByConflict || state.inFlightCrystalDraftIds.includes(crystalDraftId)) {
    return false;
  }
  if (state.staleCrystalDraftIds.includes(crystalDraftId)) {
    return false;
  }
  const groupId = findGroupIdOfCrystalDraft(state, crystalDraftId);
  return groupId !== null && canEditGroups(state, groupId);
}

function isProductDraftEntryDirty(entry: ProductDraftEntry): boolean {
  return entry.saved === null
    ? !isProductDraftFormEmpty(entry.form)
    : !sameProductDraftForm(entry.saved, entry.form);
}

function isCurationEntryDirty(entry: CurationEntry): boolean {
  return entry.saved === null
    ? !isCurationFormEmpty(entry.form)
    : !sameCurationForm(entry.saved, entry.form);
}

function findCrystalDraftView(
  state: BeadImportWorkflowState,
  crystalDraftId: string
): AssetImportCrystalDraftView | null {
  for (const group of state.session?.groups ?? []) {
    if (group.crystalDraft?.crystalDraftId === crystalDraftId) {
      return group.crystalDraft;
    }
  }
  return null;
}

function findGroupIdOfCrystalDraft(
  state: BeadImportWorkflowState,
  crystalDraftId: string
): string | null {
  for (const group of state.session?.groups ?? []) {
    if (group.crystalDraft?.crystalDraftId === crystalDraftId) {
      return group.groupId;
    }
  }
  return null;
}

function withNotice(notices: WorkflowNotice[], notice: WorkflowNotice): WorkflowNotice[] {
  const existing = notices.some((item) => item.id === notice.id);
  return existing
    ? notices.map((item) => (item.id === notice.id ? notice : item))
    : [...notices, notice];
}

function withoutNotices(notices: WorkflowNotice[], ...ids: string[]): WorkflowNotice[] {
  return notices.filter((item) => !ids.includes(item.id));
}

/**
 * Staleness is judged against the groups the session actually carries, so local
 * work keyed to a group that has disappeared is pruned instead of being left
 * dangling and permanently flagged. Only unsaved work counts: an accepted save
 * is not waiting on anybody.
 */
function detectStaleGroupIds(
  localEdits: Record<string, LocalGroupEdit>,
  draftForms: Record<string, ProductDraftEntry>,
  session: AssetImportSessionResponse
): string[] {
  const stale: string[] = [];
  for (const group of session.groups) {
    const edit = localEdits[group.groupId];
    if (edit !== undefined && edit.baseRevision !== group.revision) {
      stale.push(group.groupId);
      continue;
    }
    const draft = draftForms[group.groupId];
    if (draft !== undefined && draft.baseRevision !== group.revision && isProductDraftEntryDirty(draft)) {
      stale.push(group.groupId);
    }
  }
  return stale.sort();
}

/** A curation patch is sent against the crystal draft's own revision, not the group's. */
function detectStaleCrystalDraftIds(
  curationForms: Record<string, CurationEntry>,
  session: AssetImportSessionResponse
): string[] {
  const stale: string[] = [];
  for (const group of session.groups) {
    const draft = group.crystalDraft;
    if (draft === null) {
      continue;
    }
    const entry = curationForms[draft.crystalDraftId];
    if (entry !== undefined && entry.baseRevision !== draft.revision && isCurationEntryDirty(entry)) {
      stale.push(draft.crystalDraftId);
    }
  }
  return stale.sort();
}

/**
 * One notice covers both lists: the curation panel lives inside a group card, so
 * either divergence tells the operator the same thing.
 */
function withStaleNotice(
  notices: WorkflowNotice[],
  staleGroupIds: string[],
  staleCrystalDraftIds: string[]
): WorkflowNotice[] {
  return staleGroupIds.length === 0 && staleCrystalDraftIds.length === 0
    ? withoutNotices(notices, STALE_GROUP_NOTICE_ID)
    : withNotice(notices, {
        id: STALE_GROUP_NOTICE_ID,
        tone: "warning",
        message: STALE_GROUP_NOTICE_MESSAGE
      });
}

function keepKeys<T>(record: Record<string, T>, keep: (key: string) => boolean): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (keep(key)) {
      next[key] = value;
    }
  }
  return next;
}

/**
 * Local work is keyed to ids the Backend owns, so a session that no longer
 * carries one has nothing for that work to be submitted against. Dropping it
 * follows the server rather than overwriting the operator: everything still
 * present keeps its unsaved form untouched.
 */
function pruneToSession(
  state: BeadImportWorkflowState,
  session: AssetImportSessionResponse
): Pick<
  BeadImportWorkflowState,
  "localEdits" | "draftForms" | "draftCompleteness" | "curationForms"
> {
  const groupIds = new Set(session.groups.map((group) => group.groupId));
  const crystalDraftIds = new Set(
    session.groups.flatMap((group) =>
      group.crystalDraft === null ? [] : [group.crystalDraft.crystalDraftId]
    )
  );
  return {
    localEdits: keepKeys(state.localEdits, (groupId) => groupIds.has(groupId)),
    draftForms: keepKeys(state.draftForms, (groupId) => groupIds.has(groupId)),
    draftCompleteness: keepKeys(state.draftCompleteness, (groupId) => groupIds.has(groupId)),
    curationForms: keepKeys(state.curationForms, (id) => crystalDraftIds.has(id))
  };
}

function syncSession(
  state: BeadImportWorkflowState,
  session: AssetImportSessionResponse,
  syncedAt: string,
  preserveNavigation: boolean
): BeadImportWorkflowState {
  const progress = summarizeUploadProgress(session);
  let notices = withoutNotices(state.notices, LOAD_ERROR_NOTICE_ID, UPLOAD_FAILURE_NOTICE_ID);
  if (progress.hasFailures) {
    const failedCount = Math.max(progress.failed, session.failedFileCount);
    notices = withNotice(notices, {
      id: UPLOAD_FAILURE_NOTICE_ID,
      tone: "warning",
      message: `有 ${failedCount} 个文件上传失败，可单独重试后继续导入。`
    });
  }
  const pruned = pruneToSession(state, session);
  const staleGroupIds = detectStaleGroupIds(pruned.localEdits, pruned.draftForms, session);
  const staleCrystalDraftIds = detectStaleCrystalDraftIds(pruned.curationForms, session);
  return {
    ...state,
    ...pruned,
    sessionId: session.sessionId,
    session,
    status: "READY",
    resolvedStep: resolveWorkflowStep(session),
    requestedStep: preserveNavigation ? state.requestedStep : null,
    notices: withStaleNotice(notices, staleGroupIds, staleCrystalDraftIds),
    staleGroupIds,
    staleCrystalDraftIds,
    refreshRequested: false,
    polling: shouldPollSession(session),
    lastSyncedAt: syncedAt,
    error: null
  };
}

function mergeGroupEdit(
  existing: LocalGroupEdit | undefined,
  groupId: string,
  baseRevision: number,
  edit: GroupEditInput
): LocalGroupEdit {
  const merged: LocalGroupEdit = { groupId, baseRevision, ...existing };
  merged.groupId = groupId;
  merged.baseRevision = baseRevision;
  if (edit.crystalName !== undefined) {
    const trimmed = edit.crystalName.trim();
    if (trimmed.length > 0) {
      merged.crystalName = trimmed;
    } else {
      delete merged.crystalName;
    }
  }
  if (edit.memberFileIds !== undefined) {
    merged.memberFileIds = [...edit.memberFileIds];
  }
  if (edit.primaryFileId !== undefined) {
    merged.primaryFileId = edit.primaryFileId;
  }
  if (edit.ignoredFileIds !== undefined) {
    merged.ignoredFileIds = [...edit.ignoredFileIds];
  }
  return merged;
}

function rebaseLocalEdits(
  localEdits: Record<string, LocalGroupEdit>,
  session: AssetImportSessionResponse | null
): Record<string, LocalGroupEdit> {
  if (session === null) {
    return localEdits;
  }
  const rebased: Record<string, LocalGroupEdit> = {};
  for (const [groupId, edit] of Object.entries(localEdits)) {
    const group = session.groups.find((item) => item.groupId === groupId);
    rebased[groupId] = group === undefined ? edit : { ...edit, baseRevision: group.revision };
  }
  return rebased;
}

/** Rebasing moves the revision an operator confirms against, never what they typed. */
function rebaseProductDrafts(
  draftForms: Record<string, ProductDraftEntry>,
  session: AssetImportSessionResponse | null
): Record<string, ProductDraftEntry> {
  if (session === null) {
    return draftForms;
  }
  const rebased: Record<string, ProductDraftEntry> = {};
  for (const [groupId, entry] of Object.entries(draftForms)) {
    const group = session.groups.find((item) => item.groupId === groupId);
    rebased[groupId] = group === undefined ? entry : { ...entry, baseRevision: group.revision };
  }
  return rebased;
}

function rebaseCurationForms(
  curationForms: Record<string, CurationEntry>,
  session: AssetImportSessionResponse | null
): Record<string, CurationEntry> {
  if (session === null) {
    return curationForms;
  }
  const rebased: Record<string, CurationEntry> = {};
  const drafts = session.groups.flatMap((group) =>
    group.crystalDraft === null ? [] : [group.crystalDraft]
  );
  for (const [crystalDraftId, entry] of Object.entries(curationForms)) {
    const draft = drafts.find((item) => item.crystalDraftId === crystalDraftId);
    rebased[crystalDraftId] = draft === undefined ? entry : { ...entry, baseRevision: draft.revision };
  }
  return rebased;
}

/** Only the fields a patch actually names are written, so an absent field is left alone. */
function applyProductDraftPatch(form: ProductDraftForm, patch: ProductDraftPatch): ProductDraftForm {
  const next: ProductDraftForm = {
    text: { ...form.text },
    decisions: { ...form.decisions },
    shape: form.shape,
    currency: form.currency,
    usagePermission: form.usagePermission
  };
  for (const field of PRODUCT_DRAFT_TEXT_FIELDS) {
    const value = patch.text?.[field];
    if (value !== undefined) {
      next.text[field] = value;
    }
  }
  for (const field of PRODUCT_DRAFT_DECISION_FIELDS) {
    const value = patch.decisions?.[field];
    if (value !== undefined) {
      next.decisions[field] = value;
    }
  }
  if (patch.shape !== undefined) {
    next.shape = patch.shape;
  }
  if (patch.currency !== undefined) {
    next.currency = patch.currency;
  }
  if (patch.usagePermission !== undefined) {
    next.usagePermission = patch.usagePermission;
  }
  return next;
}

function applyCurationPatch(form: CurationForm, patch: CurationPatch): CurationForm {
  const next: CurationForm = { ...form };
  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined) {
      next[field as keyof CurationForm] = value;
    }
  }
  return next;
}

/**
 * A draft save names a crystal draft but carries no curation verdict, and the
 * view's completeness fields are bound to each other by the contract. An
 * existing view can therefore follow the new revision, while a draft the save
 * just created has to be read back from the session rather than invented here.
 */
function mergedCrystalDraft(
  existing: AssetImportCrystalDraftView | null,
  response: SaveBeadProductDraftResponse
): AssetImportCrystalDraftView | null {
  if (response.crystalDraftId === null || response.crystalDraftRevision === null) {
    return existing;
  }
  if (existing?.crystalDraftId !== response.crystalDraftId) {
    return null;
  }
  return { ...existing, revision: response.crystalDraftRevision };
}

function withoutGroupId(ids: string[], groupId: string): string[] {
  return ids.filter((id) => id !== groupId);
}

/** One failure slot per group, so a refusal on one never hides a failure on another. */
function groupFailureNoticeId(groupId: string): string {
  return `${GROUP_MUTATION_FAILURE_NOTICE_PREFIX}${groupId}`;
}

/** Likewise one slot per crystal draft, which is keyed separately from its group. */
function curationFailureNoticeId(crystalDraftId: string): string {
  return `${CURATION_FAILURE_NOTICE_PREFIX}${crystalDraftId}`;
}

export function workflowReducer(
  state: BeadImportWorkflowState,
  action: WorkflowAction
): BeadImportWorkflowState {
  switch (action.type) {
    case "SESSION_REQUESTED":
      return {
        ...state,
        sessionId: action.sessionId,
        status: "LOADING",
        notices: withoutNotices(state.notices, LOAD_ERROR_NOTICE_ID),
        refreshRequested: false,
        polling: false,
        error: null
      };
    case "SESSION_LOADED":
      return syncSession(state, action.session, action.syncedAt, false);
    case "SESSION_REFRESHED":
      return syncSession(state, action.session, action.syncedAt, true);
    case "SESSION_FAILED":
      return {
        ...state,
        status: "ERROR",
        polling: false,
        refreshRequested: false,
        error: {
          code: action.error.code,
          message: LOAD_ERROR_NOTICE_MESSAGE,
          retryable: action.error.retryable
        },
        notices: withNotice(state.notices, {
          id: LOAD_ERROR_NOTICE_ID,
          tone: "danger",
          message: LOAD_ERROR_NOTICE_MESSAGE
        })
      };
    case "REQUEST_STEP": {
      const { session } = state;
      if (session === null || !isWorkflowStepReachable(session, action.step)) {
        return state;
      }
      return { ...state, requestedStep: action.step };
    }
    case "EDIT_GROUP": {
      const group = findGroup(state, action.edit.groupId);
      if (group === undefined) {
        return state;
      }
      const staleGroupIds = withoutGroupId(state.staleGroupIds, group.groupId);
      return {
        ...state,
        localEdits: {
          ...state.localEdits,
          [group.groupId]: mergeGroupEdit(
            state.localEdits[group.groupId],
            group.groupId,
            group.revision,
            action.edit
          )
        },
        staleGroupIds,
        notices: withStaleNotice(state.notices, staleGroupIds, state.staleCrystalDraftIds)
      };
    }
    case "DISCARD_GROUP_EDIT": {
      if (state.localEdits[action.groupId] === undefined) {
        return state;
      }
      const localEdits = { ...state.localEdits };
      delete localEdits[action.groupId];
      const staleGroupIds = withoutGroupId(state.staleGroupIds, action.groupId);
      return {
        ...state,
        localEdits,
        staleGroupIds,
        notices: withStaleNotice(state.notices, staleGroupIds, state.staleCrystalDraftIds)
      };
    }
    case "GROUP_MUTATION_STARTED":
      return state.inFlightGroupIds.includes(action.groupId)
        ? state
        : { ...state, inFlightGroupIds: [...state.inFlightGroupIds, action.groupId] };
    case "GROUP_MUTATION_APPLIED": {
      const session =
        state.session === null
          ? null
          : {
              ...state.session,
              groups: state.session.groups.map((group) =>
                group.groupId === action.groupId ? { ...group, revision: action.revision } : group
              )
            };
      const localEdits = { ...state.localEdits };
      delete localEdits[action.groupId];
      const staleGroupIds = withoutGroupId(state.staleGroupIds, action.groupId);
      return {
        ...state,
        session,
        localEdits,
        inFlightGroupIds: withoutGroupId(state.inFlightGroupIds, action.groupId),
        staleGroupIds,
        notices: withStaleNotice(
          withoutNotices(state.notices, groupFailureNoticeId(action.groupId)),
          staleGroupIds,
          state.staleCrystalDraftIds
        )
      };
    }
    case "GROUP_MUTATION_CONFLICT":
      return {
        ...state,
        inFlightGroupIds: withoutGroupId(state.inFlightGroupIds, action.groupId),
        blockedByConflict: true,
        refreshRequested: true,
        notices: withNotice(withoutNotices(state.notices, groupFailureNoticeId(action.groupId)), {
          id: CONFLICT_NOTICE_ID,
          tone: "danger",
          message: CONFLICT_NOTICE_MESSAGE
        })
      };
    case "GROUP_MUTATION_FAILED":
      return {
        ...state,
        inFlightGroupIds: withoutGroupId(state.inFlightGroupIds, action.groupId),
        notices: withNotice(state.notices, {
          id: groupFailureNoticeId(action.groupId),
          tone: "danger",
          message: action.message
        })
      };
    case "EDIT_PRODUCT_DRAFT": {
      const group = findGroup(state, action.groupId);
      if (group === undefined) {
        return state;
      }
      const existing = state.draftForms[group.groupId];
      const form = applyProductDraftPatch(existing?.form ?? emptyProductDraftForm(), action.patch);
      const staleGroupIds = withoutGroupId(state.staleGroupIds, group.groupId);
      return {
        ...state,
        draftForms: {
          ...state.draftForms,
          [group.groupId]: { form, saved: existing?.saved ?? null, baseRevision: group.revision }
        },
        staleGroupIds,
        notices: withStaleNotice(state.notices, staleGroupIds, state.staleCrystalDraftIds)
      };
    }
    case "RESET_PRODUCT_DRAFT": {
      if (state.draftForms[action.groupId] === undefined) {
        return state;
      }
      const draftForms = { ...state.draftForms };
      delete draftForms[action.groupId];
      const staleGroupIds = withoutGroupId(state.staleGroupIds, action.groupId);
      return {
        ...state,
        draftForms,
        staleGroupIds,
        notices: withStaleNotice(state.notices, staleGroupIds, state.staleCrystalDraftIds)
      };
    }
    case "PRODUCT_DRAFT_SAVED": {
      const group = findGroup(state, action.groupId);
      if (group === undefined || state.session === null) {
        return state;
      }
      const { response } = action;
      const crystalDraft = mergedCrystalDraft(group.crystalDraft, response);
      const session: AssetImportSessionResponse = {
        ...state.session,
        groups: state.session.groups.map((item) =>
          item.groupId === action.groupId
            ? { ...item, state: response.state, revision: response.revision, crystalDraft }
            : item
        )
      };
      const draftForms = {
        ...state.draftForms,
        [action.groupId]: {
          form: action.form,
          saved: action.form,
          baseRevision: response.revision
        }
      };
      const draftCompleteness = { ...state.draftCompleteness };
      delete draftCompleteness[action.groupId];
      const staleGroupIds = detectStaleGroupIds(state.localEdits, draftForms, session);
      const staleCrystalDraftIds = detectStaleCrystalDraftIds(state.curationForms, session);
      return {
        ...state,
        session,
        draftForms,
        draftCompleteness,
        inFlightGroupIds: withoutGroupId(state.inFlightGroupIds, action.groupId),
        staleGroupIds,
        staleCrystalDraftIds,
        refreshRequested: response.crystalDraftId !== null && crystalDraft === null,
        notices: withStaleNotice(
          withoutNotices(state.notices, groupFailureNoticeId(action.groupId)),
          staleGroupIds,
          staleCrystalDraftIds
        )
      };
    }
    case "COMPLETENESS_CHECKED": {
      const group = findGroup(state, action.groupId);
      if (group === undefined) {
        return state;
      }
      return {
        ...state,
        draftCompleteness: {
          ...state.draftCompleteness,
          [group.groupId]: { ...action.snapshot, groupRevision: action.groupRevision }
        }
      };
    }
    case "EDIT_CURATION_DRAFT": {
      const draft = findCrystalDraftView(state, action.crystalDraftId);
      if (draft === null) {
        return state;
      }
      const existing = state.curationForms[draft.crystalDraftId];
      const form = applyCurationPatch(existing?.form ?? emptyCurationForm(), action.patch);
      const staleCrystalDraftIds = withoutGroupId(
        state.staleCrystalDraftIds,
        draft.crystalDraftId
      );
      return {
        ...state,
        curationForms: {
          ...state.curationForms,
          [draft.crystalDraftId]: {
            form,
            saved: existing?.saved ?? null,
            baseRevision: draft.revision
          }
        },
        staleCrystalDraftIds,
        notices: withStaleNotice(state.notices, state.staleGroupIds, staleCrystalDraftIds)
      };
    }
    case "RESET_CURATION_DRAFT": {
      if (state.curationForms[action.crystalDraftId] === undefined) {
        return state;
      }
      const curationForms = { ...state.curationForms };
      delete curationForms[action.crystalDraftId];
      const staleCrystalDraftIds = withoutGroupId(
        state.staleCrystalDraftIds,
        action.crystalDraftId
      );
      return {
        ...state,
        curationForms,
        staleCrystalDraftIds,
        notices: withStaleNotice(state.notices, state.staleGroupIds, staleCrystalDraftIds)
      };
    }
    case "CURATION_SAVE_STARTED":
      return state.inFlightCrystalDraftIds.includes(action.crystalDraftId)
        ? state
        : {
            ...state,
            inFlightCrystalDraftIds: [...state.inFlightCrystalDraftIds, action.crystalDraftId]
          };
    case "CURATION_SAVE_APPLIED": {
      if (state.session === null) {
        return state;
      }
      const { response } = action;
      const session: AssetImportSessionResponse = {
        ...state.session,
        groups: state.session.groups.map((group) =>
          group.crystalDraft?.crystalDraftId === response.crystalDraftId
            ? {
                ...group,
                crystalDraft: {
                  crystalDraftId: response.crystalDraftId,
                  revision: response.revision,
                  curationComplete: response.curationComplete,
                  missingFields: response.missingFields,
                  promotionEligible: response.promotionEligible
                }
              }
            : group
        )
      };
      const form = state.curationForms[response.crystalDraftId]?.form ?? emptyCurationForm();
      const curationForms = {
        ...state.curationForms,
        [response.crystalDraftId]: { form, saved: form, baseRevision: response.revision }
      };
      const staleCrystalDraftIds = detectStaleCrystalDraftIds(curationForms, session);
      return {
        ...state,
        session,
        curationForms,
        inFlightCrystalDraftIds: withoutGroupId(
          state.inFlightCrystalDraftIds,
          response.crystalDraftId
        ),
        staleCrystalDraftIds,
        notices: withStaleNotice(
          withoutNotices(state.notices, curationFailureNoticeId(response.crystalDraftId)),
          state.staleGroupIds,
          staleCrystalDraftIds
        )
      };
    }
    case "CURATION_SAVE_CONFLICT":
      return {
        ...state,
        inFlightCrystalDraftIds: withoutGroupId(
          state.inFlightCrystalDraftIds,
          action.crystalDraftId
        ),
        blockedByConflict: true,
        refreshRequested: true,
        notices: withNotice(
          withoutNotices(state.notices, curationFailureNoticeId(action.crystalDraftId)),
          {
            id: CONFLICT_NOTICE_ID,
            tone: "danger",
            message: CONFLICT_NOTICE_MESSAGE
          }
        )
      };
    case "CURATION_SAVE_FAILED":
      return {
        ...state,
        inFlightCrystalDraftIds: withoutGroupId(
          state.inFlightCrystalDraftIds,
          action.crystalDraftId
        ),
        notices: withNotice(state.notices, {
          id: curationFailureNoticeId(action.crystalDraftId),
          tone: "danger",
          message: action.message
        })
      };
    case "CONFLICT_ACKNOWLEDGED": {
      if (
        !state.blockedByConflict &&
        state.staleGroupIds.length === 0 &&
        state.staleCrystalDraftIds.length === 0
      ) {
        return state;
      }
      return {
        ...state,
        localEdits: rebaseLocalEdits(state.localEdits, state.session),
        draftForms: rebaseProductDrafts(state.draftForms, state.session),
        curationForms: rebaseCurationForms(state.curationForms, state.session),
        staleGroupIds: [],
        staleCrystalDraftIds: [],
        blockedByConflict: false,
        notices: withoutNotices(state.notices, CONFLICT_NOTICE_ID, STALE_GROUP_NOTICE_ID)
      };
    }
    case "DISMISS_NOTICE":
      return { ...state, notices: withoutNotices(state.notices, action.noticeId) };
  }
}
