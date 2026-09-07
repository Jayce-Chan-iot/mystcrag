import * as React from "react";

import type {
  AssetImportSessionState,
  BeadImageGroupState,
  ProcessedAssetState
} from "@mystcrag/design-contract";

import type { PreviewLoaderClient } from "../preview-loader";
import type { ObjectUrlRegistry } from "../session-lifecycle";
import type { ReviewDecisionInput } from "../processing-loader";
import { AssetPreview } from "./asset-preview";
import {
  BUTTON_CLASS,
  CARD_CLASS,
  DANGER_BUTTON_CLASS,
  FIELD_CLASS,
  HINT_CLASS,
  LABEL_CLASS,
  NOTICE_CLASS,
  NOTICE_TONE_CLASS,
  PILL_CLASS,
  SECONDARY_BUTTON_CLASS,
  SUBCARD_CLASS
} from "./control-styles";

/**
 * Presentational processing, QC and human-review step. QC can only report
 * QC_PENDING for a passing asset, a QC_FAILED asset can only be rejected, and an
 * approval demands the full set of human consent fields — all of which the
 * processing loader enforces again before anything leaves the browser. Nothing
 * here invents a processed version, a QC verdict or an approved key, and no copy
 * may claim a health effect or a fortune.
 */

export type ProcessedAssetCard = {
  processedAssetId: string;
  processingVersion: number;
  state: ProcessedAssetState;
  isCurrent: boolean;
  qcIssues: string[];
};

export type ProcessingGroupCard = {
  groupId: string;
  crystalName: string | null;
  state: BeadImageGroupState;
  revision: number;
  processedAssets: ProcessedAssetCard[];
  /** The member file whose original bytes the comparison shows first. */
  previewFileId: string | null;
  /** Whether the session marks a current APPROVED version carrying its key. */
  hasApprovedTexture: boolean;
  /** Whether every draft-side publication blocker the console can see is gone. */
  publishReady: boolean;
  stale: boolean;
  inFlight: boolean;
  failureMessage: string | null;
};

export type ProcessingPanelProps = {
  sessionState: AssetImportSessionState;
  groups: ProcessingGroupCard[];
  canStartProcessing: boolean;
  processingInFlight: boolean;
  locked: boolean;
  blockedByConflict: boolean;
  conflictMessage: string;
  publishBlockers: readonly string[];
  preview?: { client: PreviewLoaderClient; objectUrls: ObjectUrlRegistry } | null;
  onPublish?: (groupId: string) => void;
  onStartProcessing: () => void;
  onReprocess: (groupId: string, settings: { maskThreshold?: number; edgeFeatherPx?: number }) => void;
  onSelectVersion: (groupId: string, processingVersion: number) => void;
  onReview: (groupId: string, processedAssetId: string, decision: ReviewDecisionInput) => void;
  onAcknowledgeConflict: () => void;
};

const PROCESSED_STATE_LABELS: Readonly<Record<ProcessedAssetState, string>> = {
  DRAFT: "草稿",
  QC_PENDING: "待人工审核",
  QC_FAILED: "质检未通过",
  APPROVED: "已批准",
  RETIRED: "已淘汰"
};

const PROCESSED_STATE_TONES: Readonly<Record<ProcessedAssetState, "info" | "success" | "warning" | "danger">> = {
  DRAFT: "info",
  QC_PENDING: "warning",
  QC_FAILED: "danger",
  APPROVED: "success",
  RETIRED: "info"
};

function Pill({ label, tone }: { label: string; tone: "info" | "success" | "warning" | "danger" }) {
  return <span className={`${PILL_CLASS} ${NOTICE_TONE_CLASS[tone]}`}>{label}</span>;
}

function ReviewForm({
  groupId,
  asset,
  onReview
}: {
  groupId: string;
  asset: ProcessedAssetCard;
  onReview: (decision: ReviewDecisionInput) => void;
}) {
  // APPROVE/REJECT belong to the current QC_PENDING version alone; a QC_FAILED
  // version keeps only the rejection the contract allows; an old version never
  // reaches this form at all.
  const canApprove = asset.isCurrent && asset.state === "QC_PENDING";
  const canReject = asset.isCurrent && (asset.state === "QC_PENDING" || asset.state === "QC_FAILED");
  const [mode, setMode] = React.useState<"APPROVE" | "REJECT">(canApprove ? "APPROVE" : "REJECT");
  const [reviewNote, setReviewNote] = React.useState("");
  const [rightsHolder, setRightsHolder] = React.useState("");
  const [usagePermission, setUsagePermission] = React.useState<"OWNED" | "GRANTED">("OWNED");
  const [isAuthenticPhotograph, setIsAuthenticPhotograph] = React.useState(false);
  const [allowAiTraining, setAllowAiTraining] = React.useState(false);
  const [allowCommercialUse, setAllowCommercialUse] = React.useState(false);
  const [allowPublicDisplay, setAllowPublicDisplay] = React.useState(false);
  const [allowAiRecommendation, setAllowAiRecommendation] = React.useState(false);

  const prefix = `bead-import-review-${groupId}-${asset.processedAssetId}`;
  const approveReady = canApprove && reviewNote.trim() !== "" && rightsHolder.trim() !== "";

  function submit() {
    if (mode === "REJECT") {
      onReview({ action: "REJECT", reviewNote: reviewNote.trim() });
      return;
    }
    if (!canApprove) {
      return;
    }
    onReview({
      action: "APPROVE",
      reviewNote: reviewNote.trim(),
      rightsHolder: rightsHolder.trim(),
      usagePermission,
      isAuthenticPhotograph,
      allowAiTraining,
      allowCommercialUse,
      allowPublicDisplay,
      allowAiRecommendation
    });
  }

  return (
    <div className={`${SUBCARD_CLASS} gap-3`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 text-sm font-medium">人工审核</p>
        <div className="flex min-w-0 gap-1">
          <button
            type="button"
            onClick={() => setMode("APPROVE")}
            disabled={!canApprove}
            className={`${mode === "APPROVE" ? BUTTON_CLASS : SECONDARY_BUTTON_CLASS} ${!canApprove ? "opacity-60" : ""}`}
          >
            批准
          </button>
          <button
            type="button"
            onClick={() => setMode("REJECT")}
            disabled={!canReject}
            className={`${mode === "REJECT" ? DANGER_BUTTON_CLASS : SECONDARY_BUTTON_CLASS} ${!canReject ? "opacity-60" : ""}`}
          >
            拒绝
          </button>
        </div>
      </div>

      <div className="min-w-0">
        <label htmlFor={`${prefix}-note`} className={LABEL_CLASS}>
          审核备注（必填）
        </label>
        <textarea
          id={`${prefix}-note`}
          value={reviewNote}
          onChange={(event) => setReviewNote(event.currentTarget.value)}
          className={FIELD_CLASS}
          rows={2}
        />
      </div>

      {mode === "APPROVE" && (
        <>
          {!canApprove && (
            <p role="status" className="min-w-0 text-xs text-[var(--warning)]">
              质检未通过的处理版本只能拒绝，不能批准。
            </p>
          )}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={`${prefix}-holder`} className={LABEL_CLASS}>
                权利持有人（必填）
              </label>
              <input
                id={`${prefix}-holder`}
                type="text"
                value={rightsHolder}
                onChange={(event) => setRightsHolder(event.currentTarget.value)}
                className={FIELD_CLASS}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor={`${prefix}-usage`} className={LABEL_CLASS}>
                使用授权（发布前必须为自有或已授权）
              </label>
              <select
                id={`${prefix}-usage`}
                value={usagePermission}
                onChange={(event) => setUsagePermission(event.currentTarget.value as "OWNED" | "GRANTED")}
                className={FIELD_CLASS}
              >
                <option value="OWNED">自有版权</option>
                <option value="GRANTED">已获授权</option>
              </select>
            </div>
          </div>

          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className={LABEL_CLASS}>逐项确认（由人工明确选择）</legend>
            {(
              [
                ["isAuthenticPhotograph", "这些照片是实拍，未由图像生成或合成", isAuthenticPhotograph, setIsAuthenticPhotograph],
                ["allowAiTraining", "允许用于 AI 训练", allowAiTraining, setAllowAiTraining],
                ["allowCommercialUse", "允许商业用途", allowCommercialUse, setAllowCommercialUse],
                ["allowPublicDisplay", "允许公开展示", allowPublicDisplay, setAllowPublicDisplay],
                ["allowAiRecommendation", "允许用于 AI 推荐", allowAiRecommendation, setAllowAiRecommendation]
              ] as const
            ).map(([key, label, value, setter]) => (
              <label key={key} htmlFor={`${prefix}-${key}`} className="flex min-w-0 items-start gap-2 text-sm">
                <input
                  id={`${prefix}-${key}`}
                  type="checkbox"
                  checked={value}
                  onChange={(event) => setter(event.currentTarget.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0">{label}</span>
              </label>
            ))}
          </fieldset>
        </>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={
          reviewNote.trim() === "" ||
          (mode === "APPROVE" && !approveReady) ||
          (mode === "REJECT" && !canReject)
        }
        className={mode === "REJECT" ? DANGER_BUTTON_CLASS : BUTTON_CLASS}
      >
        {mode === "REJECT" ? "提交拒绝" : "提交批准"}
      </button>
    </div>
  );
}

function ReprocessForm({
  group,
  onReprocess
}: {
  group: ProcessingGroupCard;
  onReprocess: (settings: { maskThreshold?: number; edgeFeatherPx?: number }) => void;
}) {
  const [maskThreshold, setMaskThreshold] = React.useState("");
  const [edgeFeatherPx, setEdgeFeatherPx] = React.useState("");

  function submit() {
    const settings: { maskThreshold?: number; edgeFeatherPx?: number } = {};
    if (maskThreshold.trim() !== "") {
      const value = Number(maskThreshold);
      if (!Number.isNaN(value)) {
        settings.maskThreshold = value;
      }
    }
    if (edgeFeatherPx.trim() !== "") {
      const value = Number(edgeFeatherPx);
      if (!Number.isNaN(value)) {
        settings.edgeFeatherPx = value;
      }
    }
    onReprocess(settings);
  }

  return (
    <div className={`${SUBCARD_CLASS} gap-2`}>
      <p className="min-w-0 text-sm font-medium">重新处理</p>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={`bead-import-reprocess-${group.groupId}-mask`} className={LABEL_CLASS}>
            maskThreshold（0–1，可留空）
          </label>
          <input
            id={`bead-import-reprocess-${group.groupId}-mask`}
            type="text"
            inputMode="decimal"
            value={maskThreshold}
            onChange={(event) => setMaskThreshold(event.currentTarget.value)}
            className={FIELD_CLASS}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor={`bead-import-reprocess-${group.groupId}-feather`} className={LABEL_CLASS}>
            edgeFeatherPx（0–8，可留空）
          </label>
          <input
            id={`bead-import-reprocess-${group.groupId}-feather`}
            type="text"
            inputMode="numeric"
            value={edgeFeatherPx}
            onChange={(event) => setEdgeFeatherPx(event.currentTarget.value)}
            className={FIELD_CLASS}
          />
        </div>
      </div>
      <button type="button" onClick={submit} className={`${SECONDARY_BUTTON_CLASS} self-start`}>
        提交重新处理
      </button>
    </div>
  );
}

function ProcessingCard({
  group,
  canOperate,
  preview,
  onReprocess,
  onSelectVersion,
  onReview,
  onPublish
}: {
  group: ProcessingGroupCard;
  canOperate: boolean;
  preview: { client: PreviewLoaderClient; objectUrls: ObjectUrlRegistry } | null;
  onReprocess: (settings: { maskThreshold?: number; edgeFeatherPx?: number }) => void;
  onSelectVersion: (processingVersion: number) => void;
  onReview: (processedAssetId: string, decision: ReviewDecisionInput) => void;
  onPublish: () => void;
}) {
  const headingId = `bead-import-processing-${group.groupId}-heading`;

  return (
    <article aria-labelledby={headingId} aria-busy={group.inFlight ? true : undefined} className={CARD_CLASS}>
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 id={headingId} className="min-w-0 break-all text-sm font-semibold">
          {group.crystalName ?? "未命名分组"}
        </h3>
        {group.stale && <Pill label="服务端已更新，待确认" tone="warning" />}
        {group.inFlight && <Pill label="提交中" tone="info" />}
      </header>

      {group.failureMessage !== null && (
        <p role="alert" className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.danger} min-w-0 break-all`}>
          {group.failureMessage}
        </p>
      )}

      {group.processedAssets.length === 0 ? (
        <p className="min-w-0 text-sm text-[var(--muted)]">该分组还没有处理版本：请先启动处理。</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {group.processedAssets.map((asset) => (
            <li key={asset.processedAssetId} className={`${SUBCARD_CLASS} gap-2`}>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 text-sm font-medium">处理版本 {asset.processingVersion}</span>
                <Pill label={PROCESSED_STATE_LABELS[asset.state]} tone={PROCESSED_STATE_TONES[asset.state]} />
                {asset.isCurrent && <Pill label="当前版本" tone="info" />}
              </div>

              {asset.qcIssues.length > 0 && (
                <p className="min-w-0 break-all text-xs text-[var(--danger)]">
                  质检问题：{asset.qcIssues.join("、")}
                </p>
              )}

              {asset.isCurrent && preview !== null && (
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
                  {group.previewFileId !== null && (
                    <AssetPreview
                      label="原图"
                      kind="source"
                      id={group.previewFileId}
                      client={preview.client}
                      objectUrls={preview.objectUrls}
                    />
                  )}
                  <AssetPreview
                    label="处理主图"
                    kind="processed"
                    id={asset.processedAssetId}
                    rendition="main"
                    client={preview.client}
                    objectUrls={preview.objectUrls}
                  />
                  <AssetPreview
                    label="缩略图"
                    kind="processed"
                    id={asset.processedAssetId}
                    rendition="thumbnail"
                    client={preview.client}
                    objectUrls={preview.objectUrls}
                  />
                </div>
              )}

              {!asset.isCurrent && canOperate && (
                <button
                  type="button"
                  onClick={() => onSelectVersion(asset.processingVersion)}
                  className={`${SECONDARY_BUTTON_CLASS} self-start`}
                >
                  设为当前版本
                </button>
              )}

              {asset.isCurrent && asset.state === "QC_PENDING" && canOperate && (
                <ReviewForm
                  groupId={group.groupId}
                  asset={asset}
                  onReview={(decision) => onReview(asset.processedAssetId, decision)}
                />
              )}

              {asset.isCurrent && asset.state === "QC_FAILED" && canOperate && (
                <ReviewForm
                  groupId={group.groupId}
                  asset={asset}
                  onReview={(decision) => onReview(asset.processedAssetId, decision)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canOperate && (
        <ReprocessForm group={group} onReprocess={onReprocess} />
      )}

      {canOperate && group.state !== "PUBLISHED" && (
        <div className={`${SUBCARD_CLASS} gap-2`}>
          <p className="min-w-0 text-sm font-medium">发布该分组</p>
          <p className="min-w-0 text-xs leading-5 text-[var(--muted)]">
            发布使用服务端批准的当前处理版本贴图（权威 approvedAssetKey），并确认珠子名称、水晶引用与授权信息。确认点击即为操作者确认。
          </p>
          <button
            type="button"
            onClick={onPublish}
            disabled={!group.publishReady || !group.hasApprovedTexture}
            className={`${BUTTON_CLASS} self-start`}
          >
            {group.hasApprovedTexture ? "发布该分组" : "贴图尚未批准，暂不能发布"}
          </button>
        </div>
      )}
    </article>
  );
}

export function ProcessingPanel({
  sessionState,
  groups,
  canStartProcessing,
  processingInFlight,
  locked,
  blockedByConflict,
  conflictMessage,
  publishBlockers,
  preview = null,
  onPublish = () => {},
  onStartProcessing,
  onReprocess,
  onSelectVersion,
  onReview,
  onAcknowledgeConflict
}: ProcessingPanelProps) {
  const canOperate = !locked && !blockedByConflict;

  return (
    <section aria-labelledby="bead-import-processing-heading" className="flex min-w-0 flex-col gap-4">
      <header className="min-w-0">
        <h2 id="bead-import-processing-heading" className="text-lg font-semibold tracking-tight">
          处理、审核与发布
        </h2>
        <p className={HINT_CLASS}>
          处理结果只能进入“待人工审核”，质检未通过只能拒绝，批准必须逐项确认权利与授权信息。
        </p>
      </header>

      {blockedByConflict && (
        <div
          role="alert"
          className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.danger} flex min-w-0 flex-col gap-3`}
        >
          <p className="min-w-0 break-all">{conflictMessage}</p>
          <button
            type="button"
            onClick={() => onAcknowledgeConflict()}
            className={`${SECONDARY_BUTTON_CLASS} self-start`}
          >
            我已确认最新数据
          </button>
        </div>
      )}

      {canStartProcessing && (
        <div className={`${SUBCARD_CLASS} gap-2`}>
          <p className="min-w-0 text-sm font-medium">启动处理</p>
          <p className="min-w-0 text-xs leading-5 text-[var(--muted)]">
            所有分组已命名并保存草稿后，可以启动图像处理与自动质检。
          </p>
          <button
            type="button"
            onClick={onStartProcessing}
            disabled={processingInFlight || !canOperate}
            className={`${BUTTON_CLASS} self-start`}
          >
            {processingInFlight ? "正在启动处理…" : "启动处理"}
          </button>
        </div>
      )}

      {publishBlockers.length > 0 && (
        <div role="status" className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.warning} flex min-w-0 flex-col gap-2`}>
          <p className="min-w-0 text-sm font-medium">发布前仍待满足：</p>
          <ul className="flex min-w-0 list-inside list-disc flex-col gap-1">
            {publishBlockers.map((blocker, index) => (
              <li key={index} className="min-w-0 break-all text-sm">
                {blocker}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sessionState === "READY_TO_PUBLISH" && publishBlockers.length === 0 && (
        <p role="status" className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.info}`}>
          发布条件已满足：在分组卡片中确认后即可发布，贴图素材键由服务端批准的处理版本提供。
        </p>
      )}

      {locked && (
        <p role="status" className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.info}`}>
          导入任务已进入不可编辑阶段，处理与审核仅供查看。
        </p>
      )}

      {groups.length === 0 ? (
        <p className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.info}`}>
          还没有分组：请先完成上传、分组与命名，再启动处理。
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {groups.map((group) => (
            <ProcessingCard
              key={group.groupId}
              group={group}
              canOperate={canOperate && group.state !== "PUBLISHED" && !group.stale}
              preview={preview}
              onReprocess={(settings) => onReprocess(group.groupId, settings)}
              onSelectVersion={(processingVersion) => onSelectVersion(group.groupId, processingVersion)}
              onReview={(processedAssetId, decision) => onReview(group.groupId, processedAssetId, decision)}
              onPublish={() => onPublish(group.groupId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
