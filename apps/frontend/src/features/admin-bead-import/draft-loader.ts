import type {
  AssetImportSessionResponse,
  CheckBeadProductDraftCompletenessResponse,
  DraftCompletenessField,
  SaveBeadProductDraftRequest,
  SaveBeadProductDraftResponse,
  UpdateCrystalDraftCurationRequest,
  UpdateCrystalDraftCurationResponse
} from "@mystcrag/design-contract";

import {
  buildCurationRequest,
  buildCrystalSelectionRequest,
  buildProductDraftRequest,
  curationIssues,
  productDraftIssues,
  type DraftIssue
} from "./draft-form";
import { classifyFailure } from "./failure-copy";
import { classifySessionFailure, type AbortHandle, type AbortSignalLike } from "./session-lifecycle";
import {
  CONFLICT_NOTICE_MESSAGE,
  STALE_GROUP_NOTICE_MESSAGE,
  crystalDraftViewFor,
  curationEntryFor,
  curationSubmissionBlocker,
  groupIdOfCrystalDraft,
  groupRevisionFor,
  groupSubmissionBlocker,
  isCurationDirty,
  isProductDraftDirty,
  productDraftEntryFor,
  type BeadImportWorkflowState,
  type WorkflowAction
} from "./workflow-state";

/**
 * Submits the naming step and keeps the workflow state honest about it. A
 * revision is never taken from what the operator typed: a product draft carries
 * the group's revision and a curation patch carries the crystal draft's, both
 * read from the last authoritative session. A 409 stops local submission and
 * re-reads the session rather than retrying, because the Backend is saying that
 * copy has gone stale. Nothing here judges a bound on its own terms — every
 * body is built by the shared model, which the contract judges.
 */

export type DraftRefusalReason =
  | "NO_SESSION"
  | "UNKNOWN_GROUP"
  | "NOTHING_TO_SAVE"
  | "INVALID_INPUT"
  | "NO_CRYSTAL_DRAFT"
  | "UNNAMED_GROUP"
  | "GROUP_LOCKED"
  | "CONFLICT_BLOCKED"
  | "IN_FLIGHT"
  | "STALE";

export const DRAFT_REFUSAL_MESSAGES: Readonly<Record<DraftRefusalReason, string>> = {
  NO_SESSION: "导入任务尚未载入，无法保存命名内容。",
  UNKNOWN_GROUP: "该分组已不存在或已被合并，请刷新后再试。",
  NOTHING_TO_SAVE: "没有需要保存的修改。",
  INVALID_INPUT: "填写的内容未通过校验，请先修正标出的字段。",
  NO_CRYSTAL_DRAFT: "该分组还没有水晶资料草稿，请先保存珠子命名内容。",
  UNNAMED_GROUP: "该分组还没有人工命名的珠子名称，请先在确认分组步骤填写后再保存草稿。",
  GROUP_LOCKED: "导入任务已进入不可编辑阶段，无法再修改命名内容。",
  CONFLICT_BLOCKED: CONFLICT_NOTICE_MESSAGE,
  IN_FLIGHT: "正在提交，请等待完成后再试。",
  STALE: STALE_GROUP_NOTICE_MESSAGE
};

/**
 * One result shape for all three submissions, because the operator is looking at
 * one thing at a time and the caller already knows which. `targetId` is the group
 * id for a draft save or a completeness check, and the crystal draft id for a
 * curation save.
 */
export type DraftSubmitResult =
  | { outcome: "APPLIED"; targetId: string }
  | {
      outcome: "CHECKED";
      targetId: string;
      complete: boolean;
      missingFields: DraftCompletenessField[];
    }
  | { outcome: "CONFLICT"; targetId: string }
  | { outcome: "FAILED"; targetId: string; code: string; message: string; retryable: boolean }
  | { outcome: "CANCELLED"; targetId: string }
  | {
      outcome: "REFUSED";
      targetId: string;
      reason: DraftRefusalReason;
      message: string;
      issues: DraftIssue[];
    };

export type DraftLoaderClient = {
  saveGroupDraft(
    groupId: string,
    request: SaveBeadProductDraftRequest,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<SaveBeadProductDraftResponse>;
  getDraftCompleteness(
    groupId: string,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<CheckBeadProductDraftCompletenessResponse>;
  updateCrystalDraft(
    crystalDraftId: string,
    request: UpdateCrystalDraftCurationRequest,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<UpdateCrystalDraftCurationResponse>;
  getSession(
    sessionId: string,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<AssetImportSessionResponse>;
};

export type DraftLoaderDeps = {
  client: DraftLoaderClient;
  getState: () => BeadImportWorkflowState;
  dispatch: (action: WorkflowAction) => void;
  now: () => string;
  createAbortController: () => AbortHandle;
  createIdempotencyKey: () => string;
};

export type DraftLoader = {
  saveProductDraft(groupId: string): Promise<DraftSubmitResult>;
  checkCompleteness(groupId: string): Promise<DraftSubmitResult>;
  saveCuration(crystalDraftId: string): Promise<DraftSubmitResult>;
  selectExistingCrystal(
    groupId: string,
    crystalId: string,
    crystalName: string
  ): Promise<DraftSubmitResult>;
  cancel(): void;
};

export function createDraftLoader(deps: DraftLoaderDeps): DraftLoader {
  const live = new Set<AbortHandle>();
  let cancelled = false;

  function emit(action: WorkflowAction): void {
    if (!cancelled) {
      deps.dispatch(action);
    }
  }

  async function refresh(sessionId: string): Promise<void> {
    const controller = begin();
    try {
      const session = await deps.client.getSession(sessionId, { signal: controller.signal });
      emit({ type: "SESSION_REFRESHED", session, syncedAt: deps.now() });
    } catch (error) {
      if (!cancelled && !controller.signal.aborted) {
        emit({ type: "SESSION_FAILED", error: classifySessionFailure(error) });
      }
    } finally {
      settle(controller);
    }
  }

  function begin(): AbortHandle {
    const controller = deps.createAbortController();
    live.add(controller);
    return controller;
  }

  /** Whether the answer that just arrived belongs to a loader that is gone. */
  function settle(controller: AbortHandle): boolean {
    live.delete(controller);
    return cancelled || controller.signal.aborted;
  }

  function refused(
    targetId: string,
    reason: DraftRefusalReason,
    issues: DraftIssue[] = []
  ): DraftSubmitResult {
    return { outcome: "REFUSED", targetId, reason, message: DRAFT_REFUSAL_MESSAGES[reason], issues };
  }

  async function saveProductDraft(groupId: string): Promise<DraftSubmitResult> {
    const state = deps.getState();
    const sessionId = state.sessionId;
    if (state.session === null || sessionId === null) {
      return refused(groupId, "NO_SESSION");
    }
    const revision = groupRevisionFor(state, groupId);
    if (revision === null) {
      return refused(groupId, "UNKNOWN_GROUP");
    }
    const blocker = groupSubmissionBlocker(state, groupId);
    if (blocker !== null) {
      return refused(groupId, blocker);
    }
    const entry = productDraftEntryFor(state, groupId);
    if (entry === null || !isProductDraftDirty(state, groupId)) {
      return refused(groupId, "NOTHING_TO_SAVE");
    }

    const crystalDraft = crystalDraftViewFor(state, groupId);
    const group = state.session?.groups.find((candidate) => candidate.groupId === groupId);
    const linkedCrystalId = group?.productDraft?.crystalId ?? null;
    // The CrystalDraft is created by the Backend from the name the operator
    // human-confirmed through SET_NAME — never a retyped value or an inference.
    // A group holding an existing Crystal reference needs no creation name.
    const humanName =
      crystalDraft === null && linkedCrystalId === null ? (group?.crystalName ?? null) : null;
    if (crystalDraft === null && linkedCrystalId === null && (humanName === null || humanName.trim() === "")) {
      return refused(groupId, "UNNAMED_GROUP");
    }
    const issues = productDraftIssues(entry.form);
    const request = buildProductDraftRequest({
      form: entry.form,
      expectedGroupRevision: revision,
      crystalDraftId: crystalDraft?.crystalDraftId ?? null,
      crystalName: humanName
    });
    if (issues.length > 0 || request === null) {
      return refused(groupId, "INVALID_INPUT", issues);
    }

    const controller = begin();
    emit({ type: "GROUP_MUTATION_STARTED", groupId });

    let response: SaveBeadProductDraftResponse;
    try {
      response = await deps.client.saveGroupDraft(groupId, request, { signal: controller.signal });
    } catch (error) {
      if (settle(controller)) {
        return { outcome: "CANCELLED", targetId: groupId };
      }
      const failure = classifyFailure(error);
      if (failure.code === "CONFLICT") {
        emit({ type: "GROUP_MUTATION_CONFLICT", groupId });
        await refresh(sessionId);
        return { outcome: "CONFLICT", targetId: groupId };
      }
      emit({ type: "GROUP_MUTATION_FAILED", groupId, message: failure.message });
      return { outcome: "FAILED", targetId: groupId, ...failure };
    }

    if (settle(controller)) {
      return { outcome: "CANCELLED", targetId: groupId };
    }

    emit({ type: "PRODUCT_DRAFT_SAVED", groupId, form: entry.form, response });
    if (crystalDraft === null && response.crystalDraftId !== null) {
      // The save just named a crystal draft whose curation verdict only the
      // session carries, so the session is read back rather than one invented.
      await refresh(sessionId);
    }
    return { outcome: "APPLIED", targetId: groupId };
  }

  /**
   * A completeness answer is a read, not a mutation, so a locked or stale group
   * can still be inspected: the operator is being told what is missing, and no
   * revision is being claimed.
   */
  async function checkCompleteness(groupId: string): Promise<DraftSubmitResult> {
    const state = deps.getState();
    if (state.session === null) {
      return refused(groupId, "NO_SESSION");
    }
    const revision = groupRevisionFor(state, groupId);
    if (revision === null) {
      return refused(groupId, "UNKNOWN_GROUP");
    }

    const controller = begin();
    try {
      const response = await deps.client.getDraftCompleteness(groupId, {
        signal: controller.signal
      });
      if (settle(controller)) {
        return { outcome: "CANCELLED", targetId: groupId };
      }
      const snapshot = {
        complete: response.complete,
        missingFields: [...response.missingFields],
        checkedAt: response.checkedAt
      };
      emit({ type: "COMPLETENESS_CHECKED", groupId, snapshot, groupRevision: revision });
      return {
        outcome: "CHECKED",
        targetId: groupId,
        complete: snapshot.complete,
        missingFields: snapshot.missingFields
      };
    } catch (error) {
      if (settle(controller)) {
        return { outcome: "CANCELLED", targetId: groupId };
      }
      return { outcome: "FAILED", targetId: groupId, ...classifyFailure(error) };
    }
  }

  async function saveCuration(crystalDraftId: string): Promise<DraftSubmitResult> {
    const state = deps.getState();
    const sessionId = state.sessionId;
    if (state.session === null || sessionId === null) {
      return refused(crystalDraftId, "NO_SESSION");
    }
    const groupId = groupIdOfCrystalDraft(state, crystalDraftId);
    const crystalDraft = groupId === null ? null : crystalDraftViewFor(state, groupId);
    if (crystalDraft === null) {
      return refused(crystalDraftId, "NO_CRYSTAL_DRAFT");
    }
    const blocker = curationSubmissionBlocker(state, crystalDraftId);
    if (blocker !== null) {
      return refused(crystalDraftId, blocker);
    }
    const entry = curationEntryFor(state, crystalDraftId);
    if (entry === null || !isCurationDirty(state, crystalDraftId)) {
      return refused(crystalDraftId, "NOTHING_TO_SAVE");
    }

    const issues = curationIssues(entry.form);
    if (issues.length > 0) {
      return refused(crystalDraftId, "INVALID_INPUT", issues);
    }
    const request = buildCurationRequest({
      form: entry.form,
      expectedRevision: crystalDraft.revision,
      idempotencyKey: deps.createIdempotencyKey()
    });
    if (request === null) {
      return refused(crystalDraftId, "INVALID_INPUT", issues);
    }

    const controller = begin();
    emit({ type: "CURATION_SAVE_STARTED", crystalDraftId });

    let response: UpdateCrystalDraftCurationResponse;
    try {
      response = await deps.client.updateCrystalDraft(crystalDraftId, request, {
        signal: controller.signal
      });
    } catch (error) {
      if (settle(controller)) {
        return { outcome: "CANCELLED", targetId: crystalDraftId };
      }
      const failure = classifyFailure(error);
      if (failure.code === "CONFLICT") {
        emit({ type: "CURATION_SAVE_CONFLICT", crystalDraftId });
        await refresh(sessionId);
        return { outcome: "CONFLICT", targetId: crystalDraftId };
      }
      emit({ type: "CURATION_SAVE_FAILED", crystalDraftId, message: failure.message });
      return { outcome: "FAILED", targetId: crystalDraftId, ...failure };
    }

    if (settle(controller)) {
      return { outcome: "CANCELLED", targetId: crystalDraftId };
    }

    emit({ type: "CURATION_SAVE_APPLIED", crystalDraftId, response });
    return { outcome: "APPLIED", targetId: crystalDraftId };
  }

  /**
   * The explicit select-existing-Crystal submit: the id the operator picked in
   * the search is persisted through the same draft boundary and revision guard
   * as every other draft field — never a name-derived guess and never a client
   * merge into the current form. The authoritative session is re-read afterwards
   * so productDraft.crystalId (and the Backend-cleared crystalDraftId) is what
   * publication later consumes.
   */
  async function selectExistingCrystal(
    groupId: string,
    crystalId: string,
    crystalName: string
  ): Promise<DraftSubmitResult> {
    const state = deps.getState();
    const sessionId = state.sessionId;
    if (state.session === null || sessionId === null) {
      return refused(groupId, "NO_SESSION");
    }
    const revision = groupRevisionFor(state, groupId);
    if (revision === null) {
      return refused(groupId, "UNKNOWN_GROUP");
    }
    const blocker = groupSubmissionBlocker(state, groupId);
    if (blocker !== null) {
      return refused(groupId, blocker);
    }
    const request = buildCrystalSelectionRequest({
      crystalId,
      crystalName,
      expectedGroupRevision: revision
    });
    if (request === null) {
      return refused(groupId, "INVALID_INPUT");
    }

    const controller = begin();
    emit({ type: "GROUP_MUTATION_STARTED", groupId });

    let response: SaveBeadProductDraftResponse;
    try {
      response = await deps.client.saveGroupDraft(groupId, request, { signal: controller.signal });
    } catch (error) {
      if (settle(controller)) {
        return { outcome: "CANCELLED", targetId: groupId };
      }
      const failure = classifyFailure(error);
      if (failure.code === "CONFLICT") {
        emit({ type: "GROUP_MUTATION_CONFLICT", groupId });
        await refresh(sessionId);
        return { outcome: "CONFLICT", targetId: groupId };
      }
      emit({ type: "GROUP_MUTATION_FAILED", groupId, message: failure.message });
      return { outcome: "FAILED", targetId: groupId, ...failure };
    }

    if (settle(controller)) {
      return { outcome: "CANCELLED", targetId: groupId };
    }

    // The revision moves and the server may have cleared the draft reference:
    // the authoritative session, not a local merge, decides what the operator sees.
    emit({ type: "GROUP_MUTATION_APPLIED", groupId, revision: response.revision });
    await refresh(sessionId);
    return { outcome: "APPLIED", targetId: groupId };
  }

  function cancel(): void {
    cancelled = true;
    for (const controller of live) {
      controller.abort("bead import naming step unmounted");
    }
    live.clear();
  }

  return { saveProductDraft, checkCompleteness, saveCuration, selectExistingCrystal, cancel };
}
