import type {
  AssetImportSessionResponse,
  UpdateBeadImageGroupRequest,
  UpdateBeadImageGroupResponse
} from "@mystcrag/design-contract";

import { classifyFailure } from "./failure-copy";
import { classifySessionFailure, type AbortHandle, type AbortSignalLike } from "./session-lifecycle";
import {
  CONFLICT_NOTICE_MESSAGE,
  STALE_GROUP_NOTICE_MESSAGE,
  groupRevisionFor,
  groupSubmissionBlocker,
  type BeadImportWorkflowState,
  type WorkflowAction
} from "./workflow-state";

/**
 * Issues the six group mutations and keeps the workflow state honest about
 * them. `expectedGroupRevision` is never taken from what the operator has
 * typed: it comes from the last authoritative session. A 409 is the Backend
 * saying that copy has gone stale, so local submission stops and the session is
 * re-read rather than retried. Membership answers to the same re-read, because
 * a merge, a split or a move rewrites groups other than the one patched.
 */

export type GroupMutationInput =
  | { action: "SET_NAME"; crystalName: string }
  | { action: "MERGE_GROUPS"; sourceGroupIds: string[] }
  | { action: "SPLIT_GROUP"; partitions: string[][] }
  | { action: "MOVE_FILES"; fileIds: string[]; targetGroupId: string }
  | { action: "SET_PRIMARY"; primaryFileId: string }
  | { action: "IGNORE_FILES"; fileIds: string[]; reason: string };

export type GroupRefusalReason =
  | "NO_SESSION"
  | "UNKNOWN_GROUP"
  | "GROUP_LOCKED"
  | "CONFLICT_BLOCKED"
  | "IN_FLIGHT"
  | "STALE"
  | "EMPTY_NAME";

export const GROUP_REFUSAL_MESSAGES: Readonly<Record<GroupRefusalReason, string>> = {
  NO_SESSION: "导入任务尚未载入，无法修改分组。",
  UNKNOWN_GROUP: "该分组已不存在或已被合并，请刷新后再试。",
  GROUP_LOCKED: "导入任务已进入不可编辑阶段，无法再修改分组。",
  CONFLICT_BLOCKED: CONFLICT_NOTICE_MESSAGE,
  IN_FLIGHT: "该分组正在提交修改，请等待完成后再试。",
  STALE: STALE_GROUP_NOTICE_MESSAGE,
  EMPTY_NAME: "请先填写珠子名称，再提交该分组。"
};

export type GroupSubmitResult =
  | { outcome: "APPLIED"; groupId: string; revision: number }
  | { outcome: "CONFLICT"; groupId: string }
  | { outcome: "FAILED"; groupId: string; code: string; message: string; retryable: boolean }
  | { outcome: "CANCELLED"; groupId: string }
  | { outcome: "REFUSED"; groupId: string; reason: GroupRefusalReason; message: string };

export type GroupLoaderClient = {
  updateGroup(
    groupId: string,
    request: UpdateBeadImageGroupRequest,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<UpdateBeadImageGroupResponse>;
  getSession(
    sessionId: string,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<AssetImportSessionResponse>;
};

export type GroupLoaderDeps = {
  client: GroupLoaderClient;
  getState: () => BeadImportWorkflowState;
  dispatch: (action: WorkflowAction) => void;
  now: () => string;
  createAbortController: () => AbortHandle;
};

export type GroupLoader = {
  submit(groupId: string, input: GroupMutationInput): Promise<GroupSubmitResult>;
  cancel(): void;
};

export function buildGroupMutation(
  input: GroupMutationInput,
  expectedGroupRevision: number
): UpdateBeadImageGroupRequest {
  switch (input.action) {
    case "SET_NAME":
      return { action: "SET_NAME", expectedGroupRevision, crystalName: input.crystalName };
    case "MERGE_GROUPS":
      return { action: "MERGE_GROUPS", expectedGroupRevision, sourceGroupIds: [...input.sourceGroupIds] };
    case "SPLIT_GROUP":
      return {
        action: "SPLIT_GROUP",
        expectedGroupRevision,
        partitions: input.partitions.map((partition) => [...partition])
      };
    case "MOVE_FILES":
      return {
        action: "MOVE_FILES",
        expectedGroupRevision,
        fileIds: [...input.fileIds],
        targetGroupId: input.targetGroupId
      };
    case "SET_PRIMARY":
      return { action: "SET_PRIMARY", expectedGroupRevision, primaryFileId: input.primaryFileId };
    case "IGNORE_FILES":
      return { action: "IGNORE_FILES", expectedGroupRevision, fileIds: [...input.fileIds], reason: input.reason };
  }
}

function refusalReasonFor(
  state: BeadImportWorkflowState,
  groupId: string,
  input: GroupMutationInput
): GroupRefusalReason | null {
  if (state.session === null) {
    return "NO_SESSION";
  }
  if (groupRevisionFor(state, groupId) === null) {
    return "UNKNOWN_GROUP";
  }
  if (input.action === "SET_NAME" && input.crystalName.trim() === "") {
    return "EMPTY_NAME";
  }
  return groupSubmissionBlocker(state, groupId);
}

export function createGroupLoader(deps: GroupLoaderDeps): GroupLoader {
  const live = new Set<AbortHandle>();
  let cancelled = false;

  function emit(action: WorkflowAction): void {
    if (!cancelled) {
      deps.dispatch(action);
    }
  }

  async function refresh(sessionId: string): Promise<void> {
    const controller = deps.createAbortController();
    live.add(controller);
    try {
      const session = await deps.client.getSession(sessionId, { signal: controller.signal });
      emit({ type: "SESSION_REFRESHED", session, syncedAt: deps.now() });
    } catch (error) {
      if (!cancelled && !controller.signal.aborted) {
        emit({ type: "SESSION_FAILED", error: classifySessionFailure(error) });
      }
    } finally {
      live.delete(controller);
    }
  }

  async function submit(groupId: string, input: GroupMutationInput): Promise<GroupSubmitResult> {
    const state = deps.getState();
    const reason = refusalReasonFor(state, groupId, input);
    if (reason !== null) {
      return { outcome: "REFUSED", groupId, reason, message: GROUP_REFUSAL_MESSAGES[reason] };
    }
    const revision = groupRevisionFor(state, groupId);
    const sessionId = state.sessionId;
    if (revision === null || sessionId === null) {
      // refusalReasonFor has just proven both exist; this only keeps the
      // compiler from widening them back to nullable.
      return {
        outcome: "REFUSED",
        groupId,
        reason: "UNKNOWN_GROUP",
        message: GROUP_REFUSAL_MESSAGES.UNKNOWN_GROUP
      };
    }

    const controller = deps.createAbortController();
    live.add(controller);
    emit({ type: "GROUP_MUTATION_STARTED", groupId });

    let response: UpdateBeadImageGroupResponse;
    try {
      response = await deps.client.updateGroup(groupId, buildGroupMutation(input, revision), {
        signal: controller.signal
      });
    } catch (error) {
      live.delete(controller);
      if (cancelled || controller.signal.aborted) {
        return { outcome: "CANCELLED", groupId };
      }
      const failure = classifyFailure(error);
      if (failure.code === "CONFLICT") {
        emit({ type: "GROUP_MUTATION_CONFLICT", groupId });
        await refresh(sessionId);
        return { outcome: "CONFLICT", groupId };
      }
      emit({ type: "GROUP_MUTATION_FAILED", groupId, message: failure.message });
      return { outcome: "FAILED", groupId, ...failure };
    }

    live.delete(controller);
    if (cancelled || controller.signal.aborted) {
      return { outcome: "CANCELLED", groupId };
    }

    emit({ type: "GROUP_MUTATION_APPLIED", groupId, revision: response.revision });
    await refresh(sessionId);
    return { outcome: "APPLIED", groupId, revision: response.revision };
  }

  function cancel(): void {
    cancelled = true;
    for (const controller of live) {
      controller.abort("bead import group editor unmounted");
    }
    live.clear();
  }

  return { submit, cancel };
}
