import * as React from "react";

import type { AssetImportSessionState, AssetImportSessionSummary } from "@mystcrag/design-contract";

import { formatTimestamp } from "../console-format";
import {
  DASHBOARD_BUCKETS,
  DASHBOARD_BUCKET_LABELS,
  SESSION_STATE_FILTERS,
  groupSessionsByBucket,
  sessionStateLabel,
  summaryRecovery,
  type DashboardBucket,
  type DashboardState
} from "../dashboard-model";

const LOGIN_PATH = "/admin/bead-import/login";

/**
 * Presentational dashboard. Every fact on screen comes from the Backend session
 * summary: state, verified checkpoint and file counters. Nothing here infers a
 * crystal identity from a file or folder name, and no copy may name a storage
 * key, a backend origin or the admin key.
 */

const PILL_TONES: Readonly<Record<"accent" | "warning" | "success" | "danger", string>> = {
  accent: "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-deep)]",
  warning: "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]",
  success: "border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]",
  danger: "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]"
};

const STATE_TONES: Readonly<Record<AssetImportSessionState, keyof typeof PILL_TONES>> = {
  CREATED: "accent",
  UPLOADING: "accent",
  ARCHIVING: "accent",
  PROCESSING: "accent",
  PUBLISHING: "accent",
  NEEDS_REVIEW: "warning",
  READY_TO_PUBLISH: "warning",
  PUBLISHED: "success",
  PARTIALLY_FAILED: "danger",
  FAILED: "danger",
  CANCELLED: "danger"
};

export type DashboardViewProps = {
  state: DashboardState;
  onCreate(): void;
  onRetry(): void;
  onLoadMore(): void;
  onFilterChange(value: AssetImportSessionState | "ALL"): void;
};

function StatePill({ state }: { state: AssetImportSessionState }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${PILL_TONES[STATE_TONES[state]]}`}
    >
      {sessionStateLabel(state)}
    </span>
  );
}

function SessionRow({ summary }: { summary: AssetImportSessionSummary }) {
  const recovery = summaryRecovery(summary);
  return (
    <a
      href={`/admin/bead-import/${encodeURIComponent(summary.sessionId)}`}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 transition-colors hover:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-all text-sm font-medium">{summary.sessionId}</span>
        <StatePill state={summary.state} />
      </span>
      <span className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>
          文件 {summary.archivedFileCount}/{summary.declaredFileCount}
        </span>
        <span>分组 {summary.groupCount}</span>
        <span>更新 {formatTimestamp(summary.updatedAt)}</span>
      </span>
      {recovery && (
        <span
          className={
            recovery.resumable
              ? "text-xs font-medium text-[var(--warning)]"
              : "text-xs text-[var(--muted)]"
          }
        >
          {recovery.label}
        </span>
      )}
    </a>
  );
}

function BucketSection({ bucket, sessions }: { bucket: DashboardBucket; sessions: AssetImportSessionSummary[] }) {
  const label = DASHBOARD_BUCKET_LABELS[bucket];
  return (
    <section
      aria-labelledby={`bead-import-bucket-${bucket}-title`}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <header className="min-w-0">
        <h3 id={`bead-import-bucket-${bucket}-title`} className="text-base font-semibold tracking-tight">
          {label.title}
        </h3>
        <p id={`bead-import-bucket-${bucket}-count`} className="mt-1 text-2xl font-semibold tabular-nums">
          {sessions.length}
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{label.hint}</p>
      </header>
      {sessions.length > 0 && (
        <ul id={`bead-import-bucket-${bucket}-list`} className="flex min-w-0 flex-col gap-2">
          {sessions.map((summary) => (
            <li key={summary.sessionId} className="min-w-0">
              <SessionRow summary={summary} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DashboardView({ state, onCreate, onRetry, onLoadMore, onFilterChange }: DashboardViewProps) {
  const grouped = groupSessionsByBucket(state.sessions);
  const loading = state.status === "IDLE" || state.status === "LOADING";

  return (
    <section aria-labelledby="bead-import-dashboard-heading" className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id="bead-import-dashboard-heading" className="text-lg font-semibold tracking-tight">
            导入任务
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            每个任务对应一次素材入库，进度与分组一律以服务端状态为准。
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <label htmlFor="bead-import-state-filter" className="block text-sm font-medium">
              按状态筛选
            </label>
            <select
              id="bead-import-state-filter"
              value={state.filter}
              onChange={(event) => {
                const selected = SESSION_STATE_FILTERS.find((filter) => filter.value === event.target.value);
                onFilterChange(selected?.value ?? "ALL");
              }}
              className="mt-1 min-h-11 w-full min-w-0 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:w-auto"
            >
              {SESSION_STATE_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={state.creating}
            aria-busy={state.creating}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-deep)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.creating ? "正在创建导入任务…" : "新建导入"}
          </button>
        </div>
      </div>

      {state.pendingSessionId !== null && (
        <p role="status" className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent-deep)]">
          导入任务已创建，正在打开任务页。
        </p>
      )}

      {state.error !== null && (
        <div
          id="bead-import-dashboard-error"
          role="alert"
          tabIndex={-1}
          className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-3"
        >
          <p className="text-sm text-[var(--danger)]">{state.error.message}</p>
          <div className="mt-3 flex min-w-0 flex-wrap gap-2">
            {state.status === "UNAUTHORIZED" ? (
              <a
                href={LOGIN_PATH}
                className="inline-flex min-h-11 items-center rounded-lg border border-[var(--danger)]/40 px-3 text-sm font-medium text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                重新登录
              </a>
            ) : state.error.retryable ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-11 items-center rounded-lg border border-[var(--danger)]/40 px-3 text-sm font-medium text-[var(--danger)] transition-colors hover:border-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                重试
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div
        aria-busy={loading || state.status === "LOADING_MORE"}
        aria-describedby={state.error === null ? undefined : "bead-import-dashboard-error"}
        className="flex min-w-0 flex-col gap-4"
      >
        {state.syncedAt !== null && (
          <p className="text-xs text-[var(--muted)]">
            最近同步 {formatTimestamp(state.syncedAt)} · 本页 {state.sessions.length} 个任务
          </p>
        )}

        {loading && (
          <div className="flex min-w-0 flex-col gap-3">
            <p role="status" className="text-sm text-[var(--muted)]">
              正在载入导入任务…
            </p>
            <div className="h-24 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] motion-safe:animate-pulse" />
            <div className="h-24 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] motion-safe:animate-pulse" />
          </div>
        )}

        {!loading && state.status === "READY" && state.sessions.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--muted)]">
            还没有导入任务。选择“新建导入”后，把整目录素材拖入任务页即可开始归档。
          </p>
        )}

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DASHBOARD_BUCKETS.map((bucket) => (
            <BucketSection key={bucket} bucket={bucket} sessions={grouped[bucket]} />
          ))}
        </div>

        {state.nextCursor !== null && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={state.status === "LOADING_MORE"}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border)] px-4 text-sm font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.status === "LOADING_MORE" ? "正在载入更多任务…" : "加载更多"}
          </button>
        )}
      </div>
    </section>
  );
}
