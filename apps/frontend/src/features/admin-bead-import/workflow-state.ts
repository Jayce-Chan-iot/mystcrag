import type { AssetImportSessionResponse, AssetImportSessionState } from "@mystcrag/design-contract";

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

export type WorkflowLoadStatus = "IDLE" | "LOADING" | "READY" | "ERROR";

export type BeadImportWorkflowState = {
  sessionId: string | null;
  session: AssetImportSessionResponse | null;
  status: WorkflowLoadStatus;
  resolvedStep: WorkflowStep;
  requestedStep: WorkflowStep | null;
  notices: WorkflowNotice[];
  localEdits: Record<string, LocalGroupEdit>;
  staleGroupIds: string[];
  inFlightGroupIds: string[];
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
    staleGroupIds: [],
    inFlightGroupIds: [],
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

function withNotice(notices: WorkflowNotice[], notice: WorkflowNotice): WorkflowNotice[] {
  const existing = notices.some((item) => item.id === notice.id);
  return existing
    ? notices.map((item) => (item.id === notice.id ? notice : item))
    : [...notices, notice];
}

function withoutNotices(notices: WorkflowNotice[], ...ids: string[]): WorkflowNotice[] {
  return notices.filter((item) => !ids.includes(item.id));
}

function detectStaleGroupIds(
  localEdits: Record<string, LocalGroupEdit>,
  session: AssetImportSessionResponse
): string[] {
  const stale: string[] = [];
  for (const [groupId, edit] of Object.entries(localEdits)) {
    const group = session.groups.find((item) => item.groupId === groupId);
    if (group === undefined || group.revision !== edit.baseRevision) {
      stale.push(groupId);
    }
  }
  return stale.sort();
}

function withStaleNotice(notices: WorkflowNotice[], staleGroupIds: string[]): WorkflowNotice[] {
  return staleGroupIds.length === 0
    ? withoutNotices(notices, STALE_GROUP_NOTICE_ID)
    : withNotice(notices, {
        id: STALE_GROUP_NOTICE_ID,
        tone: "warning",
        message: STALE_GROUP_NOTICE_MESSAGE
      });
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
  const staleGroupIds = detectStaleGroupIds(state.localEdits, session);
  return {
    ...state,
    sessionId: session.sessionId,
    session,
    status: "READY",
    resolvedStep: resolveWorkflowStep(session),
    requestedStep: preserveNavigation ? state.requestedStep : null,
    notices: withStaleNotice(notices, staleGroupIds),
    staleGroupIds,
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

function withoutGroupId(ids: string[], groupId: string): string[] {
  return ids.filter((id) => id !== groupId);
}

/** One failure slot per group, so a refusal on one never hides a failure on another. */
function groupFailureNoticeId(groupId: string): string {
  return `${GROUP_MUTATION_FAILURE_NOTICE_PREFIX}${groupId}`;
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
        notices: withStaleNotice(state.notices, staleGroupIds)
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
        notices: withStaleNotice(state.notices, staleGroupIds)
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
          staleGroupIds
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
    case "CONFLICT_ACKNOWLEDGED": {
      if (!state.blockedByConflict && state.staleGroupIds.length === 0) {
        return state;
      }
      return {
        ...state,
        localEdits: rebaseLocalEdits(state.localEdits, state.session),
        staleGroupIds: [],
        blockedByConflict: false,
        notices: withoutNotices(state.notices, CONFLICT_NOTICE_ID, STALE_GROUP_NOTICE_ID)
      };
    }
    case "DISMISS_NOTICE":
      return { ...state, notices: withoutNotices(state.notices, action.noticeId) };
  }
}
