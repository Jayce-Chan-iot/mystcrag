import * as React from "react";

import type {
  AssetImportSessionState,
  BeadImageGroupState,
  ProcessedAssetState
} from "@mystcrag/design-contract";

import type { PreviewLoaderClient } from "../preview-loader";
import type { ObjectUrlRegistry } from "../session-lifecycle";
import type { ReviewDecisionInput } from "../processing-loader";
import { approvalDecisionReady } from "../processing-loader";
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
 * Presentational processing, QC and human-review step. Only the current
 * QC_PENDING version is reviewable, every consent decision must be explicitly
 * chosen (unanswered is not an answer), previews load on demand one group at a
 * time, and publishing demands its own explicit confirmations — all of which
 * the processing loader enforces again before anything leaves the browser.
 * Nothing here invents a processed version, a QC verdict or an approved key,
 * and no copy may claim a health effect or a fortune.
 */

export type PublishConfirmation = {
  crystalNameConfirmed: boolean;
  crystalDraftPromotionConfirmed: boolean;
};

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
  /** The authoritative primary file whose original bytes the comparison shows. */
  previewFileId: string | null;
  /** Whether the session marks a current APPROVED version carrying its key. */
  hasApprovedTexture: boolean;
  /** Whether every draft-side publication blocker the console can see is gone. */
  publishReady: boolean;
  /** Whether publishing would promote a CrystalDraft and thus needs that confirmation. */
  promotionRequired: boolean;
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
  /** The one group whose previews are loaded, or null when all are collapsed. */
  expandedPreviewGroupId?: string | null;
  onTogglePreviews?: (groupId: string) => void;
  onPublish?: (
    groupId: string,
    confirmation: PublishConfirmation
  ) => void;
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
  // version shows its state and issues with a reprocess path but no review form,
  // and an old version is read-only.
  const canApprove = asset.isCurrent && asset.state === "QC_PENDING";
  const [mode, setMode] = React.useState<"APPROVE" | "REJECT">(canApprove ? "APPROVE" : "REJECT");
  const [reviewNote, setReviewNote] = React.useState("");
  const [rightsHolder, setRightsHolder] = React.useState("");
  // Every rights and consent decision starts unanswered: `false` is a real
  // answer an operator can give, so it can never stand in for "not asked".
  const [usagePermission, setUsagePermission] = React.useState<"OWNED" | "GRANTED" | null>(null);
  const [isAuthenticPhotograph, setIsAuthenticPhotograph] = React.useState<boolean | null>(null);
  const [allowAiTraining, setAllowAiTraining] = React.useState<boolean | null>(null);
  const [allowCommercialUse, setAllowCommercialUse] = React.useState<boolean | null>(null);
  const [allowPublicDisplay, setAllowPublicDisplay] = React.useState<boolean | null>(null);
  const [allowAiRecommendation, setAllowAiRecommendation] = React.useState<boolean | null>(null);

  const prefix = `bead-import-review-${groupId}-${asset.processedAssetId}`;
  const approveReady =
    canApprove &&
    approvalDecisionReady({
      reviewNote,
      rightsHolder,
      usagePermission,
      isAuthenticPhotograph,
      allowAiTraining,
      allowCommercialUse,
      allowPublicDisplay,
      allowAiRecommendation
    });

  function submit() {
    if (mode === "REJECT") {
      onReview({ action: "REJECT", reviewNote: reviewNote.trim() });
      return;
    }
    // Re-checked here so a stale UI state can never submit an unanswered form.
    const ready =
      canApprove &&
      approvalDecisionReady({
        reviewNote,
        rightsHolder,
        usagePermission,
        isAuthenticPhotograph,
        allowAiTraining,
        allowCommercialUse,
        allowPublicDisplay,
        allowAiRecommendation
      });
    if (!ready || usagePermission === null) {
      return;
    }
    onReview({
      action: "APPROVE",
      reviewNote: reviewNote.trim(),
      rightsHolder: rightsHolder.trim(),
      usagePermission,
      isAuthenticPhotograph: isAuthenticPhotograph === true,
      allowAiTraining: allowAiTraining === true,
      allowCommercialUse: allowCommercialUse === true,
      allowPublicDisplay: allowPublicDisplay === true,
      allowAiRecommendation: allowAiRecommendation === true
    });
  }

  function triState(
    id: string,
    label: string,
    value: boolean | null,
    setter: (value: boolean | null) => void
  ) {
    return (
      <div className="min-w-0">
        <label htmlFor={id} className={LABEL_CLASS}>
          {label}
        </label>
        <select
          id={id}
          value={value === null ? "" : String(value)}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            setter(raw === "" ? null : raw === "true");
          }}
          className={FIELD_CLASS}
        >
          <option value="">未回答</option>
          <option value="true">是</option>
          <option value="false">否</option>
        </select>
      </div>
    );
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
            className={mode === "REJECT" ? DANGER_BUTTON_CLASS : SECONDARY_BUTTON_CLASS}
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
                value={usagePermission ?? ""}
                onChange={(event) =>
                  setUsagePermission(
                    event.currentTarget.value === "" ? null : (event.currentTarget.value as "OWNED" | "GRANTED")
                  )
                }
                className={FIELD_CLASS}
              >
                <option value="">未回答</option>
                <option value="OWNED">自有版权</option>
                <option value="GRANTED">已获授权</option>
              </select>
            </div>
          </div>

          <fieldset className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <legend className={LABEL_CLASS}>逐项确认（必须由人工明确选择，未回答不能批准）</legend>
            {triState(
              `${prefix}-isAuthenticPhotograph`,
              "这些照片是实拍，未由图像生成或合成",
              isAuthenticPhotograph,
              setIsAuthenticPhotograph
            )}
            {triState(`${prefix}-allowAiTraining`, "允许用于 AI 训练", allowAiTraining, setAllowAiTraining)}
            {triState(`${prefix}-allowCommercialUse`, "允许商业用途", allowCommercialUse, setAllowCommercialUse)}
            {triState(`${prefix}-allowPublicDisplay`, "允许公开展示", allowPublicDisplay, setAllowPublicDisplay)}
            {triState(
              `${prefix}-allowAiRecommendation`,
              "允许用于 AI 推荐",
              allowAiRecommendation,
              setAllowAiRecommendation
            )}
          </fieldset>
        </>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={reviewNote.trim() === "" || (mode === "APPROVE" && !approveReady)}
        className={mode === "REJECT" ? DANGER_BUTTON_CLASS : BUTTON_CLASS}
      >
        {mode === "REJECT" ? "提交拒绝" : "提交批准"}
      </button>
    </div>
  );
}

function PublishForm({
  group,
  onPublish
}: {
  group: ProcessingGroupCard;
  onPublish: (confirmation: PublishConfirmation) => void;
}) {
  const [nameConfirmed, setNameConfirmed] = React.useState(false);
  const [promotionConfirmed, setPromotionConfirmed] = React.useState(false);
  const ready = nameConfirmed && (!group.promotionRequired || promotionConfirmed);

  return (
    <div className={`${SUBCARD_CLASS} gap-2`}>
      <p className="min-w-0 text-sm font-medium">发布该分组</p>
      <p className="min-w-0 text-xs leading-5 text-[var(--muted)]">
        发布使用服务端批准的当前处理版本贴图（权威 approvedAssetKey），授权信息逐字来自已保存的商品草稿。
      </p>
      <label className="flex min-w-0 items-start gap-2 text-sm">
        <input
          id={`bead-import-publish-${group.groupId}-name`}
          type="checkbox"
          checked={nameConfirmed}
          onChange={(event) => setNameConfirmed(event.currentTarget.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
        />
        <span className="min-w-0">我确认使用该珠子名称发布</span>
      </label>
      {group.promotionRequired && (
        <label className="flex min-w-0 items-start gap-2 text-sm">
          <input
            id={`bead-import-publish-${group.groupId}-promotion`}
            type="checkbox"
            checked={promotionConfirmed}
            onChange={(event) => setPromotionConfirmed(event.currentTarget.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
          />
          <span className="min-w-0">我确认将该水晶资料草稿提升为正式水晶</span>
        </label>
      )}
      <button
        type="button"
        onClick={() =>
          onPublish({
            crystalNameConfirmed: nameConfirmed,
            crystalDraftPromotionConfirmed: promotionConfirmed
          })
        }
        disabled={!ready}
        className={`${BUTTON_CLASS} self-start`}
      >
        确认并发布
      </button>
      {!ready && (
        <p className="min-w-0 text-xs text-[var(--muted)]">
          勾选全部确认项后才能发布；未确认时不会发出任何请求。
        </p>
      )}
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
  previewsExpanded,
  onTogglePreviews,
  onReprocess,
  onSelectVersion,
  onReview,
  onPublish
}: {
  group: ProcessingGroupCard;
  canOperate: boolean;
  preview: { client: PreviewLoaderClient; objectUrls: ObjectUrlRegistry } | null;
  previewsExpanded: boolean;
  onTogglePreviews: () => void;
  onReprocess: (settings: { maskThreshold?: number; edgeFeatherPx?: number }) => void;
  onSelectVersion: (processingVersion: number) => void;
  onReview: (processedAssetId: string, decision: ReviewDecisionInput) => void;
  onPublish: (confirmation: PublishConfirmation) => void;
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

              {!asset.isCurrent && canOperate && (
                <button
                  type="button"
                  onClick={() => onSelectVersion(asset.processingVersion)}
                  className={`${SECONDARY_BUTTON_CLASS} self-start`}
                >
                  设为当前版本
                </button>
              )}

              {/* Only the current QC_PENDING version may be reviewed; a failed
                  QC keeps its state, its issues and the reprocess path, and an
                  old version is read-only. */}
              {asset.isCurrent && asset.state === "QC_PENDING" && canOperate && (
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

      {previewsExpanded && preview !== null && (
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
          {group.processedAssets
            .filter((asset) => asset.isCurrent)
            .map((asset) => (
              <React.Fragment key={asset.processedAssetId}>
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
              </React.Fragment>
            ))}
        </div>
      )}

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onTogglePreviews}
          aria-expanded={previewsExpanded}
          className={`${SECONDARY_BUTTON_CLASS} self-start`}
        >
          {previewsExpanded ? "收起预览" : "加载预览"}
        </button>
        {!previewsExpanded && (
          <span className="min-w-0 text-xs text-[var(--muted)]">
            预览按需加载：点击后才读取原图与处理图。
          </span>
        )}
      </div>

      {canOperate && group.state !== "PUBLISHED" && (
        <PublishForm group={group} onPublish={onPublish} />
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
  expandedPreviewGroupId = null,
  onTogglePreviews = () => {},
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
          处理结果只能进入“待人工审核”；质检未通过的版本只能查看问题并重新处理；批准必须逐项确认权利与授权信息。
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
              previewsExpanded={expandedPreviewGroupId === group.groupId}
              onTogglePreviews={() => onTogglePreviews(group.groupId)}
              onReprocess={(settings) => onReprocess(group.groupId, settings)}
              onSelectVersion={(processingVersion) => onSelectVersion(group.groupId, processingVersion)}
              onReview={(processedAssetId, decision) => onReview(group.groupId, processedAssetId, decision)}
              onPublish={(confirmation) => onPublish(group.groupId, confirmation)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
