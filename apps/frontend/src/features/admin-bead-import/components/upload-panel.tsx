import * as React from "react";

import { BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./control-styles";
import { formatByteSize } from "../console-format";
import type { DirectoryInputSupport } from "../upload-model";
import {
  DIRECTORY_UNSUPPORTED_NOTICE,
  transferItemsOf,
  readPickedFiles,
  type DataTransferItemLike
} from "../folder-picker";
import {
  UPLOAD_QUEUE_CONCURRENCY,
  type UploadFileProgress,
  type UploadFileStatus,
  type UploadQueuePhase,
  type UploadQueueState
} from "../upload-queue";
import type { UploadFileSource } from "../upload-queue";

/**
 * Presentational upload step. It states the pinned concurrency and the accepted
 * file kinds, shows one row per file with its own outcome, and refuses a folder
 * outright in a browser that cannot hand one over rather than appearing to
 * accept it. Nothing here reads configuration, calls the network or names a
 * storage location.
 */

export type UploadPanelProps = {
  support: DirectoryInputSupport;
  queue: UploadQueueState;
  walking: boolean;
  pickedCount: number;
  unreadableCount: number;
  disabled: boolean;
  disabledReason: string | null;
  onPickFolder: () => void;
  onFilesPicked: (files: readonly UploadFileSource[]) => void;
  onDropItems: (items: readonly DataTransferItemLike[]) => void;
  onRetryFile: (fileId: string) => void;
  onCancel: () => void;
  /** Registered files the authoritative session holds without archived bytes. */
  serverRetryable?: readonly { fileId: string; relativePath: string; byteSize: number }[];
};

const PHASE_LABELS: Readonly<Record<UploadQueuePhase, string>> = {
  IDLE: "尚未开始上传",
  REGISTERING: "正在登记文件清单…",
  UPLOADING: "正在上传素材…",
  COMPLETE: "本次上传已结束",
  BLOCKED: "本次选择无法登记",
  FAILED: "文件清单登记失败",
  CANCELLED: "已停止上传"
};

const STATUS_LABELS: Readonly<Record<UploadFileStatus, string>> = {
  REJECTED: "未接受",
  QUEUED: "等待上传",
  UPLOADING: "上传中",
  ARCHIVED: "已归档",
  SKIPPED_DUPLICATE: "已存在，未重复归档",
  FAILED: "上传失败"
};

const STATUS_TONES: Readonly<Record<UploadFileStatus, string>> = {
  REJECTED: "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]",
  QUEUED: "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
  UPLOADING: "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-deep)]",
  ARCHIVED: "border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]",
  SKIPPED_DUPLICATE: "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
  FAILED: "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]"
};

const RUNNING_PHASES: ReadonlySet<UploadQueuePhase> = new Set(["REGISTERING", "UPLOADING"]);

/** React's input types predate the non-standard folder attributes, so they are spread in. */
const FOLDER_INPUT_ATTRIBUTES = { webkitdirectory: "", directory: "" };

function FileRow({ file, onRetry }: { file: UploadFileProgress; onRetry: (fileId: string) => void }) {
  const fileId = file.fileId;
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-all text-sm font-medium">{file.label}</span>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_TONES[file.status]}`}
        >
          {STATUS_LABELS[file.status]}
        </span>
      </span>
      <span className="min-w-0 break-all text-xs text-[var(--muted)]">
        {file.byteSize > 0 ? formatByteSize(file.byteSize) : "大小未知"}
        {file.attempts > 1 ? ` · 第 ${file.attempts} 次尝试` : ""}
      </span>
      {file.message !== null && (
        <span className="min-w-0 break-all text-xs text-[var(--danger)]">{file.message}</span>
      )}
      {file.status === "FAILED" && fileId !== null && (
        <button
          type="button"
          aria-label={`重试上传 ${file.label}`}
          onClick={() => onRetry(fileId)}
          className={SECONDARY_BUTTON_CLASS}
        >
          重试
        </button>
      )}
    </li>
  );
}

export function UploadPanel({
  support,
  queue,
  walking,
  pickedCount,
  unreadableCount,
  disabled,
  disabledReason,
  onPickFolder,
  onFilesPicked,
  onDropItems,
  onRetryFile,
  onCancel,
  serverRetryable = []
}: UploadPanelProps) {
  const running = RUNNING_PHASES.has(queue.phase);
  const folderSupported = support.folderInput || support.folderDrop;
  const settled = queue.totals.archived + queue.totals.skipped;
  const describedBy = disabledReason !== null ? "bead-import-upload-blocked" : undefined;

  return (
    <section
      aria-labelledby="bead-import-upload-heading"
      aria-busy={walking || running}
      className="flex min-w-0 flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <header className="min-w-0">
        <h3 id="bead-import-upload-heading" className="text-base font-semibold tracking-tight">
          上传素材
        </h3>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
          把整个素材文件夹拖入下方区域，或选择文件夹。一次最多同时上传 {UPLOAD_QUEUE_CONCURRENCY}{" "}
          个文件，只接受 ARW、JPG、PNG、WEBP，路径以文件夹内相对位置为准。
        </p>
      </header>

      {!folderSupported && (
        <p
          id="bead-import-directory-unsupported"
          role="alert"
          className="rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-3 text-sm text-[var(--warning)]"
        >
          {DIRECTORY_UNSUPPORTED_NOTICE}
        </p>
      )}

      {disabledReason !== null && (
        <p
          id="bead-import-upload-blocked"
          role="status"
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]"
        >
          {disabledReason}
        </p>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (disabled || !support.folderDrop) {
            return;
          }
          onDropItems(transferItemsOf(event.dataTransfer));
        }}
        aria-labelledby="bead-import-drop-heading"
        aria-describedby={describedBy}
        aria-disabled={disabled || !support.folderDrop}
        className="flex min-w-0 flex-col gap-3 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-soft)] p-4"
      >
        <span id="bead-import-drop-heading" className="min-w-0 text-sm font-medium">
          拖入素材文件夹
        </span>
        <p className="min-w-0 text-xs leading-5 text-[var(--muted)]">
          {walking
            ? "正在读取所选文件夹…"
            : support.folderDrop
              ? "松手后开始读取文件夹内容，读取完成才会登记清单。"
              : "当前浏览器无法读取拖入的文件夹，请改用选择文件夹按钮。"}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPickFolder}
            disabled={disabled || !support.folderInput}
            className={BUTTON_CLASS}
          >
            选择文件夹
          </button>
          {running && (
            <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>
              停止上传
            </button>
          )}
        </div>
        <input
          id="bead-import-folder-input"
          type="file"
          multiple
          disabled={disabled || !support.folderInput}
          aria-label="选择要导入的素材文件夹"
          onChange={(event) => {
            onFilesPicked(readPickedFiles(event.currentTarget.files ?? { length: 0 }));
          }}
          className="sr-only"
          {...FOLDER_INPUT_ATTRIBUTES}
        />
      </div>

      {pickedCount > 0 && (
        <p className="min-w-0 text-sm text-[var(--muted)]">
          本次选择可登记 {pickedCount} 个文件，合计 {formatByteSize(queue.totals.declaredBytes)}。
        </p>
      )}

      {unreadableCount > 0 && (
        <p role="status" className="min-w-0 text-sm text-[var(--warning)]">
          有 {unreadableCount} 个文件无法读取，未被登记。
        </p>
      )}

      {serverRetryable.length > 0 && (
        <div
          role="status"
          className="flex min-w-0 flex-col gap-1 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-3"
        >
          <p className="min-w-0 text-sm font-medium">
            服务端有 {serverRetryable.length} 个已登记文件未归档
          </p>
          <p className="min-w-0 text-xs leading-5 text-[var(--muted)]">
            重新选择同一素材文件夹后，将直接对这些文件重试上传，不会重复登记清单。
          </p>
        </div>
      )}

      <div aria-live="polite" className="flex min-w-0 flex-col gap-3">
        <p className="min-w-0 text-sm font-medium">{PHASE_LABELS[queue.phase]}</p>

        {queue.totals.registered > 0 && (
          <div className="flex min-w-0 flex-col gap-1">
            <progress
              value={settled}
              max={queue.totals.registered}
              aria-label="已归档文件比例"
              className="h-2 min-w-0 max-w-full"
            />
            <p className="min-w-0 text-xs text-[var(--muted)]">
              已归档 {queue.totals.archived} · 已存在 {queue.totals.skipped} · 失败{" "}
              {queue.totals.failed} · 未接受 {queue.totals.rejected} · 共{" "}
              {queue.totals.registered} 个文件
            </p>
          </div>
        )}

        {queue.message !== null && (
          <p role="alert" className="min-w-0 break-all text-sm text-[var(--danger)]">
            {queue.message}
          </p>
        )}
      </div>

      {queue.files.length > 0 && (
        <ul
          aria-label="本次上传的文件"
          className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {queue.files.map((file, index) => (
            <FileRow
              key={file.fileId ?? file.clientFileId ?? `${file.label}-${index}`}
              file={file}
              onRetry={onRetryFile}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
