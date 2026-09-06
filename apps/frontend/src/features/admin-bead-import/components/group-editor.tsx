import * as React from "react";

import type {
  AssetImportSessionFileView,
  AssetImportSessionGroupView,
  AssetSourceFileKind,
  AssetSourceFileState,
  BeadImageGroupState
} from "@mystcrag/design-contract";

import { formatByteSize } from "../console-format";

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
 * Presentational group step. Every fact on screen comes from the authoritative
 * session: membership, revision, primary file and the group state. A crystal
 * name is only ever what an operator typed, so nothing here reads a name off a
 * file, a folder or an image, and no copy may claim a health effect, a
 * guarantee or a fixed fortune.
 */

export type GroupFileRow = {
  fileId: string;
  relativePath: string;
  kind: AssetSourceFileKind;
  byteSize: number;
  state: AssetSourceFileState;
  isPrimary: boolean;
};

export type GroupCard = {
  groupId: string;
  state: BeadImageGroupState;
  revision: number;
  crystalName: string | null;
  localCrystalName: string | undefined;
  primaryFileId: string | null;
  files: GroupFileRow[];
  failureMessage: string | null;
};

export type GroupEditorSelection = {
  groupIds: string[];
  fileIdsByGroup: Record<string, string[]>;
  moveTargetGroupId: string | null;
  ignoreReason: string;
};

export type GroupEditorProps = {
  groups: readonly GroupCard[];
  selection: GroupEditorSelection;
  locked: boolean;
  blockedByConflict: boolean;
  staleGroupIds: readonly string[];
  inFlightGroupIds: readonly string[];
  conflictMessage: string;
  onSelectionChange: (selection: GroupEditorSelection) => void;
  onNameChange: (groupId: string, crystalName: string) => void;
  onDiscardName: (groupId: string) => void;
  onSubmitName: (groupId: string) => void;
  onSetPrimary: (groupId: string, fileId: string) => void;
  onIgnoreFiles: (groupId: string, fileIds: string[], reason: string) => void;
  onMoveFiles: (groupId: string, fileIds: string[], targetGroupId: string) => void;
  onSplitGroup: (groupId: string, selectedFileIds: string[]) => void;
  onMergeGroups: (sourceGroupIds: string[]) => void;
  onAcknowledgeConflict: () => void;
};

const GROUP_STATE_LABELS: Readonly<Record<BeadImageGroupState, string>> = {
  SUGGESTED: "待整理",
  CONFIRMED: "已确认分组",
  NAMED: "已命名",
  PROCESSED: "已处理",
  QC_FAILED: "质检未通过",
  READY: "待发布",
  PUBLISHED: "已发布"
};

const GROUP_STATE_TONES: Readonly<Record<BeadImageGroupState, "info" | "warning" | "success" | "danger">> = {
  SUGGESTED: "info",
  CONFIRMED: "info",
  NAMED: "info",
  PROCESSED: "info",
  QC_FAILED: "danger",
  READY: "success",
  PUBLISHED: "success"
};

const FILE_KIND_LABELS: Readonly<Record<AssetSourceFileKind, string>> = {
  ARW: "ARW 原片",
  JPEG: "JPG",
  PNG: "PNG",
  WEBP: "WEBP"
};

const FILE_STATE_LABELS: Readonly<Record<AssetSourceFileState, string>> = {
  PENDING: "待上传",
  UPLOADING: "上传中",
  ARCHIVED: "已归档",
  FAILED: "上传失败",
  SKIPPED_DUPLICATE: "已存在，未重复归档"
};

const UNNAMED_GROUP_LABEL = "未命名分组";
const NAME_MAX_LENGTH = 120;
const MERGE_MINIMUM = 2;

/**
 * Projects the authoritative session into cards. A member id the session carries
 * no file for is dropped rather than shown as an empty row, because a row the
 * Backend never archived would invite the operator to name a file that is absent.
 */
export function groupCardsOf(
  groups: readonly AssetImportSessionGroupView[],
  files: readonly AssetImportSessionFileView[],
  localNames: Readonly<Record<string, string>>,
  failureMessages: Readonly<Record<string, string>> = {}
): GroupCard[] {
  const fileById = new Map(files.map((file) => [file.fileId, file]));
  return groups.map((group) => ({
    groupId: group.groupId,
    state: group.state,
    revision: group.revision,
    crystalName: group.crystalName ?? null,
    localCrystalName: localNames[group.groupId],
    primaryFileId: group.primaryFileId ?? null,
    files: group.memberFileIds.flatMap((fileId) => {
      const file = fileById.get(fileId);
      return file === undefined
        ? []
        : [
            {
              fileId,
              relativePath: file.relativePath,
              kind: file.kind,
              byteSize: file.byteSize,
              state: file.state,
              isPrimary: group.primaryFileId === fileId
            }
          ];
    }),
    failureMessage: failureMessages[group.groupId] ?? null
  }));
}

function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function Pill({ label, tone }: { label: string; tone: "info" | "success" | "warning" | "danger" }) {
  return <span className={`${PILL_CLASS} ${NOTICE_TONE_CLASS[tone]}`}>{label}</span>;
}

function FileRow({
  groupId,
  file,
  selected,
  canOperate,
  onToggleFile,
  onSetPrimary
}: {
  groupId: string;
  file: GroupFileRow;
  selected: boolean;
  canOperate: boolean;
  onToggleFile: (fileId: string) => void;
  onSetPrimary: (fileId: string) => void;
}) {
  const checkboxId = `bead-import-group-${groupId}-file-${file.fileId}`;
  return (
    <li className={SUBCARD_CLASS}>
      <label htmlFor={checkboxId} className="flex min-w-0 items-start gap-2">
        <input
          id={checkboxId}
          type="checkbox"
          checked={selected}
          disabled={!canOperate}
          onChange={() => onToggleFile(file.fileId)}
          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="min-w-0 break-all text-sm">{file.relativePath}</span>
          <span className="min-w-0 break-all text-xs text-[var(--muted)]">
            {FILE_KIND_LABELS[file.kind]} · {formatByteSize(file.byteSize)} ·{" "}
            {FILE_STATE_LABELS[file.state]}
          </span>
        </span>
      </label>
      <button
        type="button"
        onClick={() => onSetPrimary(file.fileId)}
        disabled={!canOperate || file.isPrimary}
        aria-current={file.isPrimary ? true : undefined}
        aria-label={
          file.isPrimary ? undefined : `将 ${file.relativePath} 设为主图`
        }
        className={SECONDARY_BUTTON_CLASS}
      >
        {file.isPrimary ? "当前主图" : "设为主图"}
      </button>
    </li>
  );
}

function GroupCardView({
  group,
  others,
  selection,
  canOperate,
  isStale,
  isInFlight,
  onChange,
  onNameChange,
  onDiscardName,
  onSubmitName,
  onSetPrimary,
  onIgnoreFiles,
  onMoveFiles,
  onSplitGroup
}: {
  group: GroupCard;
  others: readonly GroupCard[];
  selection: GroupEditorSelection;
  canOperate: boolean;
  isStale: boolean;
  isInFlight: boolean;
  onChange: (selection: GroupEditorSelection) => void;
  onNameChange: (crystalName: string) => void;
  onDiscardName: () => void;
  onSubmitName: () => void;
  onSetPrimary: (fileId: string) => void;
  onIgnoreFiles: (fileIds: string[], reason: string) => void;
  onMoveFiles: (fileIds: string[], targetGroupId: string) => void;
  onSplitGroup: (selectedFileIds: string[]) => void;
}) {
  const { groupId } = group;
  const headingId = `bead-import-group-${groupId}-heading`;
  const nameId = `bead-import-group-${groupId}-name`;
  const nameHintId = `${nameId}-hint`;
  const moveTargetId = `bead-import-group-${groupId}-move-target`;
  const ignoreReasonId = `bead-import-group-${groupId}-ignore-reason`;
  const selectionHintId = `bead-import-group-${groupId}-selection-hint`;

  const selectedFileIds = selection.fileIdsByGroup[groupId] ?? [];
  const selectedCount = selectedFileIds.length;
  const nameValue = group.localCrystalName ?? group.crystalName ?? "";
  const ignoreReason = selection.ignoreReason.trim();
  const selectedMoveTarget = selection.moveTargetGroupId;

  const canSplit = canOperate && selectedCount > 0 && selectedCount < group.files.length;
  const canMove =
    canOperate && selectedCount > 0 && selectedMoveTarget !== null && selectedMoveTarget !== groupId;
  const canIgnore = canOperate && selectedCount > 0 && ignoreReason !== "";

  return (
    <article
      aria-labelledby={headingId}
      aria-busy={isInFlight ? true : undefined}
      className={CARD_CLASS}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 id={headingId} className="min-w-0 break-all text-sm font-semibold">
          {group.crystalName ?? UNNAMED_GROUP_LABEL}
        </h3>
        <Pill label={GROUP_STATE_LABELS[group.state]} tone={GROUP_STATE_TONES[group.state]} />
        {isStale && <Pill label="服务端已更新，待确认" tone="warning" />}
        {isInFlight && <Pill label="提交中" tone="info" />}
        <label className="ml-auto flex shrink-0 items-center gap-2 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={selection.groupIds.includes(groupId)}
            disabled={!canOperate}
            onChange={() => onChange({ ...selection, groupIds: toggled(selection.groupIds, groupId) })}
            className="size-4 shrink-0 accent-[var(--accent)]"
          />
          选择用于合并
        </label>
      </header>

      {group.failureMessage !== null && (
        <p
          id={`bead-import-group-${groupId}-failure`}
          role="alert"
          className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.danger} min-w-0 break-all`}
        >
          {group.failureMessage}
        </p>
      )}

      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor={nameId} className={LABEL_CLASS}>
          珠子名称（必填，人工填写）
        </label>
        <input
          id={nameId}
          type="text"
          value={nameValue}
          maxLength={NAME_MAX_LENGTH}
          required
          aria-required="true"
          aria-invalid={nameValue.trim() === "" ? true : undefined}
          aria-describedby={nameHintId}
          disabled={!canOperate}
          onChange={(event) => onNameChange(event.currentTarget.value)}
          className={FIELD_CLASS}
        />
        <p id={nameHintId} className="min-w-0 text-xs leading-5 text-[var(--muted)]">
          名称是唯一的水晶身份来源；系统不会从图片、文件夹或文件名推断它。留空的分组无法进入发布。
          {group.localCrystalName !== undefined ? "当前有未保存的修改。" : ""}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSubmitName}
            disabled={!canOperate || nameValue.trim() === ""}
            className={BUTTON_CLASS}
          >
            保存名称
          </button>
          <button
            type="button"
            onClick={onDiscardName}
            disabled={!canOperate || group.localCrystalName === undefined}
            className={SECONDARY_BUTTON_CLASS}
          >
            放弃修改
          </button>
          {group.localCrystalName !== undefined && (
            <span className="text-xs text-[var(--warning)]">未保存</span>
          )}
        </div>
      </div>

      <fieldset disabled={!canOperate} className="flex min-w-0 flex-col gap-2">
        <legend className={LABEL_CLASS}>素材文件（{group.files.length}）</legend>
        {group.files.length === 0 ? (
          <p className="min-w-0 text-xs text-[var(--muted)]">该分组当前没有已归档的文件。</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2">
            {group.files.map((file) => (
              <FileRow
                key={file.fileId}
                groupId={groupId}
                file={file}
                selected={selectedFileIds.includes(file.fileId)}
                canOperate={canOperate}
                onToggleFile={(fileId) =>
                  onChange({
                    ...selection,
                    fileIdsByGroup: {
                      ...selection.fileIdsByGroup,
                      [groupId]: toggled(selectedFileIds, fileId)
                    }
                  })
                }
                onSetPrimary={onSetPrimary}
              />
            ))}
          </ul>
        )}
      </fieldset>

      <div className="flex min-w-0 flex-col gap-3 border-t border-[var(--border)] pt-3">
        <p id={selectionHintId} className="min-w-0 text-xs text-[var(--muted)]">
          已选择 {selectedCount} / {group.files.length} 个文件。拆分会把所选文件分出新分组，
          原分组至少保留一个文件。
        </p>
        <div className="flex min-w-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSplitGroup([...selectedFileIds])}
            disabled={!canSplit}
            aria-describedby={selectionHintId}
            className={SECONDARY_BUTTON_CLASS}
          >
            拆分为新分组
          </button>
          <button
            type="button"
            onClick={() => onIgnoreFiles([...selectedFileIds], ignoreReason)}
            disabled={!canIgnore}
            aria-describedby={`${selectionHintId} ${ignoreReasonId}`}
            className={DANGER_BUTTON_CLASS}
          >
            忽略所选文件
          </button>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={ignoreReasonId} className={LABEL_CLASS}>
            忽略原因（必填）
          </label>
          <input
            id={ignoreReasonId}
            type="text"
            value={selection.ignoreReason}
            disabled={!canOperate}
            onChange={(event) => onChange({ ...selection, ignoreReason: event.currentTarget.value })}
            className={FIELD_CLASS}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor={moveTargetId} className={LABEL_CLASS}>
              移动到分组
            </label>
            <select
              id={moveTargetId}
              value={selection.moveTargetGroupId ?? ""}
              disabled={!canOperate || others.length === 0}
              onChange={(event) =>
                onChange({
                  ...selection,
                  moveTargetGroupId:
                    event.currentTarget.value === "" ? null : event.currentTarget.value
                })
              }
              className={FIELD_CLASS}
            >
              <option value="">请选择目标分组</option>
              {others.map((other) => (
                <option key={other.groupId} value={other.groupId}>
                  {other.crystalName ?? UNNAMED_GROUP_LABEL}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              if (canMove && selectedMoveTarget !== null) {
                onMoveFiles([...selectedFileIds], selectedMoveTarget);
              }
            }}
            disabled={!canMove}
            className={BUTTON_CLASS}
          >
            移动所选文件
          </button>
        </div>
      </div>
    </article>
  );
}

export function GroupEditor({
  groups,
  selection,
  locked,
  blockedByConflict,
  staleGroupIds,
  inFlightGroupIds,
  conflictMessage,
  onSelectionChange,
  onNameChange,
  onDiscardName,
  onSubmitName,
  onSetPrimary,
  onIgnoreFiles,
  onMoveFiles,
  onSplitGroup,
  onMergeGroups,
  onAcknowledgeConflict
}: GroupEditorProps) {
  const unnamedCount = groups.filter((group) => (group.crystalName ?? "").trim() === "").length;
  const canMerge = !locked && !blockedByConflict && selection.groupIds.length >= MERGE_MINIMUM;

  return (
    <section aria-labelledby="bead-import-groups-heading" className="flex min-w-0 flex-col gap-4">
      <header className="min-w-0">
        <h2 id="bead-import-groups-heading" className="text-lg font-semibold tracking-tight">
          整理分组
        </h2>
        <p className={HINT_CLASS}>
          每个分组都要由人工填写珠子名称，再决定主图、拆分、移动或忽略。分组数据以服务端为准，
          每次提交都会带上服务端给出的版本号。
        </p>
      </header>

      {blockedByConflict && (
        <div
          id="bead-import-group-conflict"
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

      {locked && (
        <p role="status" className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.info}`}>
          导入任务已进入不可编辑阶段，分组仅供查看。
        </p>
      )}

      {groups.length === 0 ? (
        <p className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.info}`}>
          还没有分组：请先完成上传，等待服务端归组后再整理。
        </p>
      ) : (
        <>
          <p role="status" className="min-w-0 text-sm text-[var(--muted)]">
            {unnamedCount > 0
              ? `有 ${unnamedCount} 个分组尚未命名，全部命名后才能进入下一步。`
              : "所有分组均已命名。"}
            {locked ? "" : `共 ${groups.length} 个分组。`}
          </p>

          <div className="flex min-w-0 flex-col gap-4">
            {groups.map((group) => (
              <GroupCardView
                key={group.groupId}
                group={group}
                others={groups.filter((other) => other.groupId !== group.groupId)}
                selection={selection}
                canOperate={
                  !locked &&
                  !blockedByConflict &&
                  group.state !== "PUBLISHED" &&
                  !staleGroupIds.includes(group.groupId) &&
                  !inFlightGroupIds.includes(group.groupId)
                }
                isStale={staleGroupIds.includes(group.groupId)}
                isInFlight={inFlightGroupIds.includes(group.groupId)}
                onChange={(next) => onSelectionChange(next)}
                onNameChange={(crystalName) => onNameChange(group.groupId, crystalName)}
                onDiscardName={() => onDiscardName(group.groupId)}
                onSubmitName={() => onSubmitName(group.groupId)}
                onSetPrimary={(fileId) => onSetPrimary(group.groupId, fileId)}
                onIgnoreFiles={(fileIds, reason) => onIgnoreFiles(group.groupId, fileIds, reason)}
                onMoveFiles={(fileIds, targetGroupId) =>
                  onMoveFiles(group.groupId, fileIds, targetGroupId)
                }
                onSplitGroup={(selectedFileIds) => onSplitGroup(group.groupId, selectedFileIds)}
              />
            ))}
          </div>

          <div className={`${SUBCARD_CLASS} gap-3`}>
            <p className="min-w-0 text-sm font-medium">合并分组</p>
            <p className="min-w-0 text-xs leading-5 text-[var(--muted)]">
              已选择 {selection.groupIds.length} 个分组，至少选择 {MERGE_MINIMUM}{" "}
              个才能合并。合并后会重新读取任务，文件不会被丢弃。
            </p>
            <button
              type="button"
              onClick={() => onMergeGroups([...selection.groupIds])}
              disabled={!canMerge}
              className={`${SECONDARY_BUTTON_CLASS} self-start`}
            >
              合并所选分组
            </button>
          </div>
        </>
      )}
    </section>
  );
}
