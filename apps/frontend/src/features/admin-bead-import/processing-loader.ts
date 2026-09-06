import {
  canReviewProcessedAsset,
  type AssetImportProcessedAssetView,
  type AssetImportSessionResponse,
  type ProcessedAssetReviewAction,
  type ReprocessBeadImageGroupRequest,
  type ReprocessBeadImageGroupResponse,
  type ReprocessSettings,
  type ReviewProcessedAssetRequest,
  type ReviewProcessedAssetResponse,
  type SelectProcessedVersionRequest,
  type SelectProcessedVersionResponse,
  type StartAssetImportProcessingResponse
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
import { canStartProcessing } from "./workflow-model";

/**
 * Issues the processing, QC and human review mutations and keeps the workflow
 * honest about them. Every revision-bearing request is read from the last
 * authoritative session, a 409 stops local submission and re-reads the session,
 * and an approval is only ever built for a current QC_PENDING asset while a
 * QC_FAILED asset may only be rejected. Nothing here fabricates a processed
 * version, a QC verdict or an approved key.
 */

export type ReviewDecisionInput =
  | {
      action: "APPROVE";
      reviewNote: string;
      rightsHolder: string;
      usagePermission: "OWNED" | "GRANTED";
      isAuthenticPhotograph: boolean;
      allowAiTraining: boolean;
      allowCommercialUse: boolean;
      allowPublicDisplay: boolean;
      allowAiRecommendation: boolean;
    }
  | { action: "REJECT"; reviewNote: string };

export type ProcessingRefusalReason =
  | "NO_SESSION"
  | "PROCESSING_NOT_ALLOWED"
  | "UNKNOWN_GROUP"
  | "GROUP_LOCKED"
  | "CONFLICT_BLOCKED"
  | "IN_FLIGHT"
  | "STALE"
  | "UNKNOWN_PROCESSED_ASSET"
  | "REVIEW_NOT_ALLOWED"
  | "APPROVE_REQUIRES_RIGHTS"
  | "INVALID_SETTINGS";

export const PROCESSING_REFUSAL_MESSAGES: Readonly<Record<ProcessingRefusalReason, string>> = {
  NO_SESSION: "导入任务尚未载入，无法发起处理。",
  PROCESSING_NOT_ALLOWED: "当前进度还无法启动处理，请先完成前面的步骤。",
  UNKNOWN_GROUP: "该分组已不存在或已被合并，请刷新后再试。",
  GROUP_LOCKED: "导入任务已进入不可编辑阶段，无法再发起处理。",
  CONFLICT_BLOCKED: CONFLICT_NOTICE_MESSAGE,
  IN_FLIGHT: "正在提交处理请求，请等待完成后再试。",
  STALE: STALE_GROUP_NOTICE_MESSAGE,
  UNKNOWN_PROCESSED_ASSET: "该处理版本不存在，请刷新后再试。",
  REVIEW_NOT_ALLOWED: "该处理版本当前不能执行此审核操作。",
  APPROVE_REQUIRES_RIGHTS: "批准前必须完整填写七项人工授权与同意声明。",
  INVALID_SETTINGS: "重新处理的参数超出允许范围：maskThreshold 为 0–1，edgeFeatherPx 为 0–8。"
};

export type ProcessingResult =
  | { outcome: "APPLIED"; subject: string }
  | { outcome: "CONFLICT"; subject: string }
  | {
      outcome: "FAILED";
      subject: string;
      code: string;
      message: string;
      retryable: boolean;
    }
  | { outcome: "CANCELLED"; subject: string }
  | { outcome: "REFUSED"; subject: string; reason: ProcessingRefusalReason; message: string };

export type ProcessingLoaderClient = {
  startProcessing(
    sessionId: string,
    idempotencyKey: string,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<StartAssetImportProcessingResponse>;
  reprocessGroup(
    groupId: string,
    request: ReprocessBeadImageGroupRequest,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<ReprocessBeadImageGroupResponse>;
  selectProcessedVersion(
    groupId: string,
    request: SelectProcessedVersionRequest,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<SelectProcessedVersionResponse>;
  reviewProcessedAsset(
    groupId: string,
    processedAssetId: string,
    request: ReviewProcessedAssetRequest,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<ReviewProcessedAssetResponse>;
  getSession(
    sessionId: string,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<AssetImportSessionResponse>;
};

export type ProcessingLoaderDeps = {
  client: ProcessingLoaderClient;
  getState: () => BeadImportWorkflowState;
  dispatch: (action: WorkflowAction) => void;
  now: () => string;
  createAbortController: () => AbortHandle;
  createIdempotencyKey: () => string;
};

export type ProcessingLoader = {
  startProcessing(): Promise<ProcessingResult>;
  reprocessGroup(groupId: string, settings?: ReprocessSettings): Promise<ProcessingResult>;
  selectProcessedVersion(groupId: string, processingVersion: number): Promise<ProcessingResult>;
  reviewProcessedAsset(
    groupId: string,
    processedAssetId: string,
    decision: ReviewDecisionInput
  ): Promise<ProcessingResult>;
  cancel(): void;
};

function findGroup(state: BeadImportWorkflowState, groupId: string) {
  return state.session?.groups.find((group) => group.groupId === groupId);
}

function findProcessedAsset(
  state: BeadImportWorkflowState,
  groupId: string,
  processedAssetId: string
): AssetImportProcessedAssetView | undefined {
  return findGroup(state, groupId)?.processedAssets.find(
    (asset) => asset.processedAssetId === processedAssetId
  );
}

function invalidSettings(settings: ReprocessSettings): boolean {
  if (
    settings.maskThreshold !== undefined &&
    (Number.isNaN(settings.maskThreshold) || settings.maskThreshold < 0 || settings.maskThreshold > 1)
  ) {
    return true;
  }
  if (
    settings.edgeFeatherPx !== undefined &&
    (!Number.isInteger(settings.edgeFeatherPx) || settings.edgeFeatherPx < 0 || settings.edgeFeatherPx > 8)
  ) {
    return true;
  }
  return false;
}

function approveRequiresRights(decision: ReviewDecisionInput): boolean {
  if (decision.action !== "APPROVE") {
    return false;
  }
  if (decision.reviewNote.trim() === "" || decision.rightsHolder.trim() === "") {
    return true;
  }
  return decision.usagePermission !== "OWNED" && decision.usagePermission !== "GRANTED";
}

function groupBlockerReason(
  blocker: ReturnType<typeof groupSubmissionBlocker>
): ProcessingRefusalReason | null {
  switch (blocker) {
    case "GROUP_LOCKED":
      return "GROUP_LOCKED";
    case "CONFLICT_BLOCKED":
      return "CONFLICT_BLOCKED";
    case "STALE":
      return "STALE";
    default:
      return null;
  }
}

export function createProcessingLoader(deps: ProcessingLoaderDeps): ProcessingLoader {
  const live = new Set<AbortHandle>();
  const inFlight = new Set<string>();
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

  function reserve(subject: string): AbortHandle | null {
    if (inFlight.has(subject)) {
      return null;
    }
    inFlight.add(subject);
    const controller = deps.createAbortController();
    live.add(controller);
    return controller;
  }

  function release(subject: string, controller: AbortHandle): boolean {
    inFlight.delete(subject);
    live.delete(controller);
    return cancelled || controller.signal.aborted;
  }

  function refused(subject: string, reason: ProcessingRefusalReason): ProcessingResult {
    return { outcome: "REFUSED", subject, reason, message: PROCESSING_REFUSAL_MESSAGES[reason] };
  }

  async function runMutation(
    subject: string,
    sessionId: string,
    operation: (controller: AbortHandle) => Promise<void>
  ): Promise<ProcessingResult> {
    const controller = reserve(subject);
    if (controller === null) {
      return refused(subject, "IN_FLIGHT");
    }
    try {
      await operation(controller);
      await refresh(sessionId);
      release(subject, controller);
      return { outcome: "APPLIED", subject };
    } catch (error) {
      const wasCancelled = release(subject, controller);
      if (wasCancelled) {
        return { outcome: "CANCELLED", subject };
      }
      const failure = classifyFailure(error);
      if (failure.code === "CONFLICT") {
        await refresh(sessionId);
        return { outcome: "CONFLICT", subject };
      }
      return { outcome: "FAILED", subject, ...failure };
    }
  }

  async function startProcessing(): Promise<ProcessingResult> {
    const state = deps.getState();
    const sessionId = state.sessionId;
    if (state.session === null || sessionId === null) {
      return refused("session", "NO_SESSION");
    }
    if (!canStartProcessing(state.session.state)) {
      return refused("session", "PROCESSING_NOT_ALLOWED");
    }
    return runMutation("session", sessionId, async (controller) => {
      await deps.client.startProcessing(sessionId, deps.createIdempotencyKey(), {
        signal: controller.signal
      });
    });
  }

  async function reprocessGroup(
    groupId: string,
    settings: ReprocessSettings = {}
  ): Promise<ProcessingResult> {
    const state = deps.getState();
    const sessionId = state.sessionId;
    if (state.session === null || sessionId === null) {
      return refused(groupId, "NO_SESSION");
    }
    if (groupRevisionFor(state, groupId) === null) {
      return refused(groupId, "UNKNOWN_GROUP");
    }
    const blocker = groupBlockerReason(groupSubmissionBlocker(state, groupId));
    if (blocker !== null) {
      return refused(groupId, blocker);
    }
    if (invalidSettings(settings)) {
      return refused(groupId, "INVALID_SETTINGS");
    }
    const revision = groupRevisionFor(state, groupId) as number;
    const request: ReprocessBeadImageGroupRequest = {
      idempotencyKey: deps.createIdempotencyKey(),
      expectedGroupRevision: revision,
      ...(settings.maskThreshold !== undefined || settings.edgeFeatherPx !== undefined ? { settings } : {})
    };
    return runMutation(`reprocess:${groupId}`, sessionId, async (controller) => {
      await deps.client.reprocessGroup(groupId, request, { signal: controller.signal });
    });
  }

  async function selectProcessedVersion(
    groupId: string,
    processingVersion: number
  ): Promise<ProcessingResult> {
    const state = deps.getState();
    const sessionId = state.sessionId;
    if (state.session === null || sessionId === null) {
      return refused(groupId, "NO_SESSION");
    }
    if (groupRevisionFor(state, groupId) === null) {
      return refused(groupId, "UNKNOWN_GROUP");
    }
    const blocker = groupBlockerReason(groupSubmissionBlocker(state, groupId));
    if (blocker !== null) {
      return refused(groupId, blocker);
    }
    const revision = groupRevisionFor(state, groupId) as number;
    const request: SelectProcessedVersionRequest = { expectedGroupRevision: revision, processingVersion };
    return runMutation(`select:${groupId}`, sessionId, async (controller) => {
      await deps.client.selectProcessedVersion(groupId, request, { signal: controller.signal });
    });
  }

  async function reviewProcessedAsset(
    groupId: string,
    processedAssetId: string,
    decision: ReviewDecisionInput
  ): Promise<ProcessingResult> {
    const state = deps.getState();
    const sessionId = state.sessionId;
    if (state.session === null || sessionId === null) {
      return refused(processedAssetId, "NO_SESSION");
    }
    const asset = findProcessedAsset(state, groupId, processedAssetId);
    if (asset === undefined) {
      return refused(processedAssetId, "UNKNOWN_PROCESSED_ASSET");
    }
    if (!canReviewProcessedAsset(asset.state, decision.action as ProcessedAssetReviewAction)) {
      return refused(processedAssetId, "REVIEW_NOT_ALLOWED");
    }
    if (approveRequiresRights(decision)) {
      return refused(processedAssetId, "APPROVE_REQUIRES_RIGHTS");
    }
    if (groupRevisionFor(state, groupId) === null) {
      return refused(processedAssetId, "UNKNOWN_GROUP");
    }
    const blocker = groupBlockerReason(groupSubmissionBlocker(state, groupId));
    if (blocker !== null) {
      return refused(processedAssetId, blocker);
    }
    const revision = groupRevisionFor(state, groupId) as number;

    const base: ReviewProcessedAssetRequest = {
      idempotencyKey: deps.createIdempotencyKey(),
      expectedGroupRevision: revision,
      processedAssetId,
      reviewNote: decision.reviewNote.trim(),
      ...(decision.action === "APPROVE"
        ? {
            action: "APPROVE" as const,
            rightsHolder: decision.rightsHolder.trim(),
            usagePermission: decision.usagePermission,
            isAuthenticPhotograph: decision.isAuthenticPhotograph,
            allowAiTraining: decision.allowAiTraining,
            allowCommercialUse: decision.allowCommercialUse,
            allowPublicDisplay: decision.allowPublicDisplay,
            allowAiRecommendation: decision.allowAiRecommendation
          }
        : { action: "REJECT" as const })
    };

    return runMutation(`review:${processedAssetId}`, sessionId, async (controller) => {
      await deps.client.reviewProcessedAsset(groupId, processedAssetId, base, {
        signal: controller.signal
      });
    });
  }

  function cancel(): void {
    cancelled = true;
    for (const controller of live) {
      controller.abort("bead import processing step unmounted");
    }
    live.clear();
    inFlight.clear();
  }

  return { startProcessing, reprocessGroup, selectProcessedVersion, reviewProcessedAsset, cancel };
}