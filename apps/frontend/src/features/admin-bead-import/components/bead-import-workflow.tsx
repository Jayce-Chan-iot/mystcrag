"use client";

import * as React from "react";

import { normalizeAssetRelativePath } from "@mystcrag/design-contract";

import { createBeadImportClient, newIdempotencyKey, type BeadImportClient } from "../api-client";
import type { CrystalSearchResult } from "@mystcrag/design-contract";
import { createDraftLoader } from "../draft-loader";
import { publishBlockersFor } from "../draft-form";
import { classifyFailure } from "../failure-copy";
import { readDirectoryDrop, type DataTransferItemLike } from "../folder-picker";
import { createGroupLoader } from "../group-loader";
import type { PreviewLoaderClient } from "../preview-loader";
import { createProcessingLoader, type ReviewDecisionInput } from "../processing-loader";
import { createSessionLifecycle } from "../session-lifecycle";
import { detectDirectorySupport, planUploads } from "../upload-model";
import { decideUploadRecovery } from "../upload-recovery";
import { createUploadQueue, type UploadFileSource, type UploadQueueState } from "../upload-queue";
import {
  canRegisterManifest,
  canStartGrouping,
  canStartProcessing,
  canUploadFileContent,
  type WorkflowStep
} from "../workflow-model";
import {
  CONFLICT_NOTICE_MESSAGE,
  currentWorkflowStep,
  initialWorkflowState,
  isSessionLocked,
  workflowReducer,
  type BeadImportWorkflowState,
  type CurationPatch,
  type ProductDraftPatch
} from "../workflow-state";

import { DraftPanel, draftCardsOf } from "./draft-panel";
import { groupCardsOf, GroupEditor, type GroupEditorSelection } from "./group-editor";
import { ProcessingPanel } from "./processing-panel";
import { UploadPanel } from "./upload-panel";
import { WorkflowView } from "./workflow-view";

/**
 * Wiring only. Decisions live in the workflow model/state, side effects in the
 * loaders and queue. Opening a task page rebuilds everything from the Backend
 * through the session lifecycle, so no fact on screen comes from React memory:
 * a refresh lands on the step the server can actually support.
 */

const EMPTY_UPLOAD_STATE: UploadQueueState = {
  phase: "IDLE",
  files: [],
  totals: {
    registered: 0,
    archived: 0,
    skipped: 0,
    failed: 0,
    rejected: 0,
    uploadedBytes: 0,
    declaredBytes: 0
  },
  message: null
};

function failureMessageFor(
  notices: readonly { id: string; message: string }[],
  prefix: string,
  id: string
): string | null {
  return notices.find((notice) => notice.id === `${prefix}${id}`)?.message ?? null;
}

function sourceRelativePath(source: UploadFileSource): string {
  const relative = source.webkitRelativePath;
  const raw = relative === undefined || relative === "" ? source.name : relative;
  try {
    return normalizeAssetRelativePath(raw);
  } catch {
    return raw;
  }
}

export function BeadImportWorkflow({ sessionId }: { sessionId: string }) {
  const [state, dispatch] = React.useReducer(workflowReducer, sessionId, initialWorkflowState);

  // The loaders read the latest workflow state from async callbacks. This ref is
  // only ever read inside event handlers and loader methods, never while
  // rendering; the compiler cannot prove that, so the write is exempted here.
  const stateRef = React.useRef(state);
  stateRef.current = state; // eslint-disable-line react-hooks/refs -- latest-value ref, read only in callbacks
  const getState = (): BeadImportWorkflowState => stateRef.current;

  const client = React.useMemo(() => createBeadImportClient(), []);

  const [upload, setUpload] = React.useState<UploadQueueState>(EMPTY_UPLOAD_STATE);
  const [walking, setWalking] = React.useState(false);
  const [pickedCount, setPickedCount] = React.useState(0);
  const [unreadableCount, setUnreadableCount] = React.useState(0);
  const [groupingInFlight, setGroupingInFlight] = React.useState(false);
  const [groupingError, setGroupingError] = React.useState<string | null>(null);
  const [groupSelection, setGroupSelection] = React.useState<GroupEditorSelection>({
    groupIds: [],
    fileIdsByGroup: {},
    moveTargetGroupId: null,
    ignoreReason: ""
  });
  const [processingInFlight, setProcessingInFlight] = React.useState(false);

  const directorySupport = React.useMemo(
    () =>
      detectDirectorySupport({
        inputPrototype: typeof HTMLInputElement === "undefined" ? null : HTMLInputElement.prototype,
        hasGetAsEntry:
          typeof DataTransferItem !== "undefined" && "webkitGetAsEntry" in DataTransferItem.prototype
      }),
    []
  );

  const lifecycle = React.useMemo(
    () =>
      createSessionLifecycle({
        fetchSession: (id, init) => client.getSession(id, { signal: init.signal as AbortSignal }),
        dispatch,
        now: () => new Date().toISOString(),
        createAbortController: () => new AbortController(),
        timers: {
          setTimeout: (handler, ms) => window.setTimeout(handler, ms),
          clearTimeout: (handle) => window.clearTimeout(handle as number)
        },
        objectUrls: {
          createObjectUrl: (source) => URL.createObjectURL(source),
          revokeObjectUrl: (url) => URL.revokeObjectURL(url)
        }
      }),
    [client]
  );

  const uploadQueue = React.useMemo(
    () =>
      createUploadQueue({
        client,
        newIdempotencyKey,
        createAbortController: () => new AbortController(),
        openStream: (file) => file.stream(),
        report: setUpload
      }),
    [client]
  );

  const groupLoader = React.useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- getState reads the latest-value ref only when a mutation is submitted
      createGroupLoader({
        client,
        getState,
        dispatch,
        now: () => new Date().toISOString(),
        createAbortController: () => new AbortController()
      }),
    [client]
  );

  const draftLoader = React.useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- getState reads the latest-value ref only when a save is submitted
      createDraftLoader({
        client,
        getState,
        dispatch,
        now: () => new Date().toISOString(),
        createAbortController: () => new AbortController(),
        createIdempotencyKey: newIdempotencyKey
      }),
    [client]
  );

  const processingLoader = React.useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- getState reads the latest-value ref only when a mutation is submitted
      createProcessingLoader({
        client,
        getState,
        dispatch,
        now: () => new Date().toISOString(),
        createAbortController: () => new AbortController(),
        createIdempotencyKey: newIdempotencyKey
      }),
    [client]
  );

  React.useEffect(() => {
    void lifecycle.start(sessionId);
    return () => {
      lifecycle.stop();
      uploadQueue.cancel();
      groupLoader.cancel();
      draftLoader.cancel();
      processingLoader.cancel();
    };
  }, [lifecycle, uploadQueue, groupLoader, draftLoader, processingLoader, sessionId]);

  const beginUpload = React.useCallback(
    (files: readonly UploadFileSource[]) => {
      const session = getState().session;
      if (session === null) {
        return;
      }
      const byPath = new Map<string, UploadFileSource>();
      for (const file of files) {
        const path = sourceRelativePath(file);
        if (!byPath.has(path)) {
          byPath.set(path, file);
        }
      }
      const recovery = decideUploadRecovery({
        session,
        pickedRelativePaths: [...byPath.keys()],
        newClientFileId: newIdempotencyKey
      });
      if (recovery.mode === "RETRY_REGISTERED") {
        // The session already owns these file ids: re-send their bytes only.
        const sources = new Map<string, UploadFileSource>();
        for (const target of recovery.targets) {
          const source = byPath.get(target.relativePath);
          if (source !== undefined) {
            sources.set(target.clientFileId, source);
          }
        }
        setPickedCount(recovery.targets.length);
        void uploadQueue
          .retryRegistered(session.sessionId, recovery.targets, sources)
          .then(() => lifecycle.refresh());
        return;
      }
      const plan = planUploads(files, { newClientFileId: newIdempotencyKey });
      const sources = new Map<string, UploadFileSource>();
      for (const entry of plan.entries) {
        const source = byPath.get(entry.relativePath);
        if (source !== undefined) {
          sources.set(entry.clientFileId, source);
        }
      }
      setPickedCount(plan.entries.length);
      void uploadQueue.start(session.sessionId, plan, sources).then(() => lifecycle.refresh());
    },
    [uploadQueue, lifecycle]
  );

  const handleDropItems = React.useCallback(
    (items: readonly DataTransferItemLike[]) => {
      setWalking(true);
      void readDirectoryDrop(items).then((pick) => {
        setUnreadableCount(pick.unreadableCount);
        setWalking(false);
        beginUpload(pick.files);
      });
    },
    [beginUpload, setWalking, setUnreadableCount]
  );

  const handleStartGrouping = React.useCallback(() => {
    const currentSessionId = getState().sessionId;
    if (currentSessionId === null) {
      return;
    }
    setGroupingInFlight(true);
    setGroupingError(null);
    void client
      .startGrouping(currentSessionId, newIdempotencyKey())
      .then(() => lifecycle.refresh())
      .catch((error) => setGroupingError(classifyFailure(error).message))
      .finally(() => setGroupingInFlight(false));
  }, [client, lifecycle]);

  const handleNameChange = React.useCallback((groupId: string, crystalName: string) => {
    dispatch({ type: "EDIT_GROUP", edit: { groupId, crystalName } });
  }, []);

  const handleSubmitName = React.useCallback(
    (groupId: string) => {
      const crystalName = getState().localEdits[groupId]?.crystalName;
      if (crystalName === undefined) {
        return;
      }
      void groupLoader.submit(groupId, { action: "SET_NAME", crystalName });
    },
    [groupLoader]
  );

  const handleDiscardName = React.useCallback((groupId: string) => {
    dispatch({ type: "DISCARD_GROUP_EDIT", groupId });
  }, []);

  const handleSetPrimary = React.useCallback(
    (groupId: string, fileId: string) => {
      void groupLoader.submit(groupId, { action: "SET_PRIMARY", primaryFileId: fileId });
    },
    [groupLoader]
  );

  const handleIgnoreFiles = React.useCallback(
    (groupId: string, fileIds: string[], reason: string) => {
      void groupLoader.submit(groupId, { action: "IGNORE_FILES", fileIds, reason });
    },
    [groupLoader]
  );

  const handleMoveFiles = React.useCallback(
    (groupId: string, fileIds: string[], targetGroupId: string) => {
      void groupLoader.submit(groupId, { action: "MOVE_FILES", fileIds, targetGroupId });
    },
    [groupLoader]
  );

  const handleSplitGroup = React.useCallback(
    (groupId: string, selectedFileIds: string[]) => {
      const group = getState().session?.groups.find((item) => item.groupId === groupId);
      if (group === undefined) {
        return;
      }
      const remaining = group.memberFileIds.filter((fileId) => !selectedFileIds.includes(fileId));
      if (selectedFileIds.length === 0 || remaining.length === 0) {
        return;
      }
      void groupLoader.submit(groupId, { action: "SPLIT_GROUP", partitions: [selectedFileIds, remaining] });
    },
    [groupLoader]
  );

  const handleMergeGroups = React.useCallback(
    (sourceGroupIds: string[]) => {
      const target = sourceGroupIds[0];
      if (target === undefined || sourceGroupIds.length < 2) {
        return;
      }
      void groupLoader.submit(target, { action: "MERGE_GROUPS", sourceGroupIds: [...sourceGroupIds] });
    },
    [groupLoader]
  );

  const handleAcknowledgeConflict = React.useCallback(() => {
    dispatch({ type: "CONFLICT_ACKNOWLEDGED" });
  }, []);

  const handleProductPatch = React.useCallback((groupId: string, patch: ProductDraftPatch) => {
    dispatch({ type: "EDIT_PRODUCT_DRAFT", groupId, patch });
  }, []);

  const handleCurationPatch = React.useCallback((crystalDraftId: string, patch: CurationPatch) => {
    dispatch({ type: "EDIT_CURATION_DRAFT", crystalDraftId, patch });
  }, []);

  const handleReview = React.useCallback(
    (groupId: string, processedAssetId: string, decision: ReviewDecisionInput) => {
      void processingLoader.reviewProcessedAsset(groupId, processedAssetId, decision);
    },
    [processingLoader]
  );

  const handleStartProcessing = React.useCallback(() => {
    setProcessingInFlight(true);
    void processingLoader.startProcessing().finally(() => setProcessingInFlight(false));
  }, [processingLoader, setProcessingInFlight]);

  const handlePublish = React.useCallback(
    (groupId: string) => {
      void processingLoader.publishGroup(groupId).then((result) => {
        if (result.outcome === "REFUSED" || result.outcome === "FAILED") {
          dispatch({ type: "GROUP_MUTATION_FAILED", groupId, message: result.message });
        }
      });
    },
    [processingLoader]
  );

  const crystalSearchClient = React.useMemo<{ listCrystals: BeadImportClient["listCrystals"] }>(
    () => ({ listCrystals: (query, requestOptions) => client.listCrystals(query, requestOptions) }),
    [client]
  );

  const handleCrystalSelected = React.useCallback(
    (groupId: string, result: CrystalSearchResult) => {
      // An existing Crystal is resolved by saving its authoritative name through
      // the same revision-guarded naming path as any other name.
      void groupLoader.submit(groupId, { action: "SET_NAME", crystalName: result.nameCn });
    },
    [groupLoader]
  );

  const session = state.session;
  const step: WorkflowStep = currentWorkflowStep(state);
  const locked = isSessionLocked(state);
  const queueRunning = upload.phase === "REGISTERING" || upload.phase === "UPLOADING";

  // Registered files the archive still lacks. They are only retryable when the
  // Backend refuses a fresh manifest; otherwise the normal flow covers them.
  const serverRetryable = React.useMemo(
    () =>
      session === null || canRegisterManifest(session.state) || !canUploadFileContent(session.state)
        ? []
        : session.files
            .filter((file) => file.state === "FAILED" || file.state === "PENDING")
            .map((file) => ({ fileId: file.fileId, relativePath: file.relativePath, byteSize: file.byteSize })),
    [session]
  );

  const groupCards = groupCardsOf(
    session?.groups ?? [],
    session?.files ?? [],
    localNamesFrom(state),
    state.notices.reduce<Record<string, string>>((acc, notice) => {
      if (notice.id.startsWith("group-mutation-failure:")) {
        acc[notice.id.slice("group-mutation-failure:".length)] = notice.message;
      }
      return acc;
    }, {})
  );

  const draftCards = draftCardsOf(state);

  const processingCards = (session?.groups ?? []).map((group) => {
    const entry = state.draftForms[group.groupId];
    const crystalDraft = group.crystalDraft;
    const completeness = state.draftCompleteness[group.groupId];
    const publishReady =
      publishBlockersFor({
        completeness: completeness ?? null,
        usagePermission: entry?.form.usagePermission ?? null,
        crystalDraft:
          crystalDraft === null
            ? null
            : { curationComplete: crystalDraft.curationComplete, promotionEligible: crystalDraft.promotionEligible }
      }).length === 0;
    const hasApprovedTexture = group.processedAssets.some(
      (asset) => asset.isCurrent && asset.state === "APPROVED" && asset.approvedAssetKey !== null
    );
    return {
      groupId: group.groupId,
      crystalName: group.crystalName ?? null,
      state: group.state,
      revision: group.revision,
      processedAssets: group.processedAssets.map((asset) => ({
        processedAssetId: asset.processedAssetId,
        processingVersion: asset.processingVersion,
        state: asset.state,
        isCurrent: asset.isCurrent,
        qcIssues: [...asset.qcIssues]
      })),
      previewFileId: group.memberFileIds[0] ?? null,
      hasApprovedTexture,
      publishReady,
      stale: state.staleGroupIds.includes(group.groupId),
      inFlight: state.inFlightGroupIds.includes(group.groupId),
      failureMessage: failureMessageFor(state.notices, "group-mutation-failure:", group.groupId)
    };
  });

  const previewContext = React.useMemo(
    () => ({
      client: client as unknown as PreviewLoaderClient,
      objectUrls: {
        createObjectUrl: (source: Blob) => URL.createObjectURL(source),
        revokeObjectUrl: (url: string) => URL.revokeObjectURL(url)
      }
    }),
    [client]
  );

  const publishBlockers = React.useMemo(() => {
    const blockers = new Set<string>();
    for (const group of session?.groups ?? []) {
      const entry = state.draftForms[group.groupId];
      const completeness = state.draftCompleteness[group.groupId];
      const crystalDraft = group.crystalDraft;
      for (const blocker of publishBlockersFor({
        completeness: completeness ?? null,
        usagePermission: entry?.form.usagePermission ?? null,
        crystalDraft:
          crystalDraft === null
            ? null
            : { curationComplete: crystalDraft.curationComplete, promotionEligible: crystalDraft.promotionEligible }
      })) {
        blockers.add(blocker);
      }
    }
    return [...blockers];
  }, [session, state.draftForms, state.draftCompleteness]);

  let stepContent: React.ReactNode;
  if (session === null) {
    stepContent = <p className="text-sm text-[var(--muted)]">正在载入导入任务…</p>;
  } else {
    switch (step) {
      case "UPLOAD_FOLDER":
        stepContent = (
          <div className="flex min-w-0 flex-col gap-4">
            <UploadPanel
              support={directorySupport}
              queue={upload}
              walking={walking}
              pickedCount={pickedCount}
              unreadableCount={unreadableCount}
              disabled={locked || queueRunning}
              disabledReason={locked ? "导入任务已结束，无法继续上传。" : null}
              onPickFolder={() => document.getElementById("bead-import-folder-input")?.click()}
              onFilesPicked={(files) => beginUpload(files)}
              onDropItems={handleDropItems}
              onRetryFile={(fileId) =>
                void uploadQueue.retry(session.sessionId, fileId).then(() => lifecycle.refresh())
              }
              onCancel={() => uploadQueue.cancel()}
              serverRetryable={serverRetryable}
            />
            {canStartGrouping(session.state) && (
              <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                <p className="min-w-0 text-sm font-medium">开始自动分组</p>
                <p className="min-w-0 text-xs leading-5 text-[var(--muted)]">
                  文件已归档，点击后由服务端自动归组，归组完成后进入分组确认。
                </p>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleStartGrouping}
                    disabled={groupingInFlight || locked}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-deep)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {groupingInFlight ? "正在启动分组…" : "开始自动分组"}
                  </button>
                  {groupingError !== null && (
                    <span className="min-w-0 break-all text-xs text-[var(--danger)]">{groupingError}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
        break;
      case "REVIEW_GROUPS":
        stepContent = (
          <GroupEditor
            groups={groupCards}
            selection={groupSelection}
            locked={locked}
            blockedByConflict={state.blockedByConflict}
            staleGroupIds={state.staleGroupIds}
            inFlightGroupIds={state.inFlightGroupIds}
            conflictMessage={CONFLICT_NOTICE_MESSAGE}
            onSelectionChange={setGroupSelection}
            onNameChange={handleNameChange}
            onDiscardName={handleDiscardName}
            onSubmitName={handleSubmitName}
            onSetPrimary={handleSetPrimary}
            onIgnoreFiles={handleIgnoreFiles}
            onMoveFiles={handleMoveFiles}
            onSplitGroup={handleSplitGroup}
            onMergeGroups={handleMergeGroups}
            onAcknowledgeConflict={handleAcknowledgeConflict}
          />
        );
        break;
      case "NAME_AND_CURATE":
        stepContent = (
          <DraftPanel
            cards={draftCards}
            locked={locked}
            blockedByConflict={state.blockedByConflict}
            conflictMessage={CONFLICT_NOTICE_MESSAGE}
            onProductPatch={handleProductPatch}
            onResetProduct={(groupId) => dispatch({ type: "RESET_PRODUCT_DRAFT", groupId })}
            onSaveProduct={(groupId) => void draftLoader.saveProductDraft(groupId)}
            onCheckCompleteness={(groupId) => void draftLoader.checkCompleteness(groupId)}
            onCurationPatch={handleCurationPatch}
            onResetCuration={(crystalDraftId) => dispatch({ type: "RESET_CURATION_DRAFT", crystalDraftId })}
            onSaveCuration={(crystalDraftId) => void draftLoader.saveCuration(crystalDraftId)}
            onAcknowledgeConflict={handleAcknowledgeConflict}
            crystalSearchClient={crystalSearchClient}
            onCrystalSelected={handleCrystalSelected}
          />
        );
        break;
      case "PROCESS_REVIEW_PUBLISH":
        stepContent = (
          <ProcessingPanel
            sessionState={session.state}
            groups={processingCards}
            canStartProcessing={canStartProcessing(session.state)}
            processingInFlight={processingInFlight}
            locked={locked}
            blockedByConflict={state.blockedByConflict}
            conflictMessage={CONFLICT_NOTICE_MESSAGE}
            publishBlockers={publishBlockers}
            onStartProcessing={handleStartProcessing}
            onReprocess={(groupId, settings) => void processingLoader.reprocessGroup(groupId, settings)}
            onSelectVersion={(groupId, processingVersion) =>
              void processingLoader.selectProcessedVersion(groupId, processingVersion)
            }
            onReview={handleReview}
            onPublish={handlePublish}
            preview={previewContext}
            onAcknowledgeConflict={handleAcknowledgeConflict}
          />
        );
        break;
    }
  }

  return (
    <WorkflowView
      state={state}
      step={step}
      onSelectStep={(next) => dispatch({ type: "REQUEST_STEP", step: next })}
    >
      {stepContent}
    </WorkflowView>
  );
}

function localNamesFrom(state: BeadImportWorkflowState): Record<string, string> {
  const localNames: Record<string, string> = {};
  for (const [groupId, edit] of Object.entries(state.localEdits)) {
    if (edit.crystalName !== undefined) {
      localNames[groupId] = edit.crystalName;
    }
  }
  return localNames;
}
