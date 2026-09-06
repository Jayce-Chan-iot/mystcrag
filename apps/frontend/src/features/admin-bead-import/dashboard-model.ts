import {
  ASSET_IMPORT_SESSION_STATES,
  assetImportCheckpointRank,
  type AssetImportSessionState,
  type AssetImportSessionSummary
} from "@mystcrag/design-contract";

/**
 * Dashboard decisions for the bead import console. Everything here is derived
 * from Backend-reported session state and verified checkpoints: the console
 * never infers crystal identity, quality or progress from file names, folder
 * numbers or images, and no copy may name storage keys, backend origins or the
 * admin key.
 */

export const DASHBOARD_BUCKETS = [
  "IN_FLIGHT",
  "AWAITING_NAMES",
  "AWAITING_PROCESSING",
  "AWAITING_REVIEW",
  "PUBLISHED",
  "NEEDS_ATTENTION"
] as const;
export type DashboardBucket = (typeof DASHBOARD_BUCKETS)[number];

export const DASHBOARD_BUCKET_LABELS: Readonly<Record<DashboardBucket, { title: string; hint: string }>> = {
  IN_FLIGHT: {
    title: "上传或处理中",
    hint: "文件归档、自动分组或图像处理正在进行，任务页会自动刷新进度。"
  },
  AWAITING_NAMES: {
    title: "待命名",
    hint: "分组已生成，等待人工确认分组并逐个输入珠子名称。"
  },
  AWAITING_PROCESSING: {
    title: "待处理",
    hint: "名称与商品草稿已保存，可以启动图像处理与自动质检。"
  },
  AWAITING_REVIEW: {
    title: "待审核",
    hint: "处理结果等待人工逐项确认权利与授权信息，通过后才能发布。"
  },
  PUBLISHED: {
    title: "已发布",
    hint: "已生成商品与库存快照，任务进入终态。"
  },
  NEEDS_ATTENTION: {
    title: "失败任务",
    hint: "存在部分失败、失败或已取消的任务，可查看原因或重试失败文件。"
  }
};

const SESSION_STATE_LABELS: Readonly<Record<AssetImportSessionState, string>> = {
  CREATED: "已创建",
  UPLOADING: "上传中",
  ARCHIVING: "归档中",
  PROCESSING: "处理中",
  NEEDS_REVIEW: "待人工处理",
  READY_TO_PUBLISH: "待发布",
  PUBLISHING: "发布中",
  PUBLISHED: "已发布",
  PARTIALLY_FAILED: "部分失败",
  FAILED: "已失败",
  CANCELLED: "已取消"
};

export function sessionStateLabel(state: AssetImportSessionState): string {
  return SESSION_STATE_LABELS[state];
}

export const SESSION_STATE_FILTERS: ReadonlyArray<{
  value: AssetImportSessionState | "ALL";
  label: string;
}> = [
  { value: "ALL", label: "全部任务" },
  ...ASSET_IMPORT_SESSION_STATES.map((state) => ({ value: state, label: sessionStateLabel(state) }))
];

function bucketForReviewCheckpoint(checkpoint: AssetImportSessionSummary["lastVerifiedCheckpoint"]): DashboardBucket {
  const rank = checkpoint === null ? -1 : assetImportCheckpointRank(checkpoint);
  if (rank >= assetImportCheckpointRank("PROCESSED")) {
    return "AWAITING_REVIEW";
  }
  if (rank >= assetImportCheckpointRank("LABELED")) {
    return "AWAITING_PROCESSING";
  }
  return "AWAITING_NAMES";
}

export function bucketForSessionSummary(summary: AssetImportSessionSummary): DashboardBucket {
  switch (summary.state) {
    case "PARTIALLY_FAILED":
    case "FAILED":
    case "CANCELLED":
      return "NEEDS_ATTENTION";
    case "PUBLISHED":
      return "PUBLISHED";
    case "READY_TO_PUBLISH":
      return "AWAITING_REVIEW";
    case "NEEDS_REVIEW":
      return bucketForReviewCheckpoint(summary.lastVerifiedCheckpoint);
    default:
      return "IN_FLIGHT";
  }
}

export type SessionsByBucket = Record<DashboardBucket, AssetImportSessionSummary[]>;

export function groupSessionsByBucket(sessions: readonly AssetImportSessionSummary[]): SessionsByBucket {
  const grouped: SessionsByBucket = {
    IN_FLIGHT: [],
    AWAITING_NAMES: [],
    AWAITING_PROCESSING: [],
    AWAITING_REVIEW: [],
    PUBLISHED: [],
    NEEDS_ATTENTION: []
  };
  for (const summary of sessions) {
    grouped[bucketForSessionSummary(summary)].push(summary);
  }
  return grouped;
}

export type SummaryRecovery = { resumable: boolean; label: string };

/**
 * Only a partially failed session still has a resumable path; a terminal
 * failure can be inspected but never continued from the dashboard.
 */
export function summaryRecovery(summary: AssetImportSessionSummary): SummaryRecovery | null {
  if (summary.state === "PARTIALLY_FAILED") {
    return summary.failedFileCount > 0
      ? { resumable: true, label: `继续导入并重试 ${summary.failedFileCount} 个失败文件` }
      : { resumable: true, label: "继续导入并检查未完成文件" };
  }
  if (summary.state === "FAILED") {
    return { resumable: false, label: "查看失败原因" };
  }
  if (summary.state === "CANCELLED") {
    return { resumable: false, label: "查看取消原因" };
  }
  return null;
}

export const DASHBOARD_DEFAULT_LIMIT = 25;

export type DashboardStatus = "IDLE" | "LOADING" | "LOADING_MORE" | "READY" | "ERROR" | "UNAUTHORIZED";

export type DashboardError = { code: string; message: string; retryable: boolean };

export type DashboardState = {
  status: DashboardStatus;
  filter: AssetImportSessionState | "ALL";
  limit: number;
  sessions: AssetImportSessionSummary[];
  nextCursor: string | null;
  syncedAt: string | null;
  error: DashboardError | null;
  creating: boolean;
  pendingSessionId: string | null;
};

export type DashboardAction =
  | { type: "LOAD_STARTED" }
  | {
      type: "LOAD_SUCCEEDED";
      sessions: readonly AssetImportSessionSummary[];
      nextCursor: string | null;
      syncedAt: string;
    }
  | { type: "LOAD_MORE_STARTED" }
  | {
      type: "APPEND_SUCCEEDED";
      sessions: readonly AssetImportSessionSummary[];
      nextCursor: string | null;
      syncedAt: string;
    }
  | { type: "LOAD_FAILED"; code: string; message: string; retryable: boolean }
  | { type: "FILTER_CHANGED"; state: AssetImportSessionState | "ALL" }
  | { type: "CREATE_REQUESTED" }
  | { type: "CREATE_SUCCEEDED"; sessionId: string }
  | { type: "CREATE_FAILED"; code: string; message: string; retryable: boolean };

export function initialDashboardState(limit: number = DASHBOARD_DEFAULT_LIMIT): DashboardState {
  return {
    status: "IDLE",
    filter: "ALL",
    limit,
    sessions: [],
    nextCursor: null,
    syncedAt: null,
    error: null,
    creating: false,
    pendingSessionId: null
  };
}

function failureStatus(code: string): DashboardStatus {
  return code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "ERROR";
}

function appendSessions(
  existing: readonly AssetImportSessionSummary[],
  incoming: readonly AssetImportSessionSummary[]
): AssetImportSessionSummary[] {
  const seen = new Set(existing.map((summary) => summary.sessionId));
  return [...existing, ...incoming.filter((summary) => !seen.has(summary.sessionId))];
}

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case "LOAD_STARTED":
      return { ...state, status: "LOADING", error: null };
    case "LOAD_SUCCEEDED":
      return {
        ...state,
        status: "READY",
        sessions: [...action.sessions],
        nextCursor: action.nextCursor,
        syncedAt: action.syncedAt,
        error: null
      };
    case "LOAD_MORE_STARTED":
      return { ...state, status: "LOADING_MORE", error: null };
    case "APPEND_SUCCEEDED":
      return {
        ...state,
        status: "READY",
        sessions: appendSessions(state.sessions, action.sessions),
        nextCursor: action.nextCursor,
        syncedAt: action.syncedAt,
        error: null
      };
    case "LOAD_FAILED":
    case "CREATE_FAILED":
      return {
        ...state,
        status: failureStatus(action.code),
        creating: false,
        pendingSessionId: action.type === "CREATE_FAILED" ? null : state.pendingSessionId,
        error: { code: action.code, message: action.message, retryable: action.retryable }
      };
    case "FILTER_CHANGED":
      if (state.filter === action.state) {
        return state;
      }
      return {
        ...state,
        filter: action.state,
        status: "LOADING",
        sessions: [],
        nextCursor: null,
        syncedAt: null,
        error: null
      };
    case "CREATE_REQUESTED":
      return { ...state, creating: true, error: null, pendingSessionId: null };
    case "CREATE_SUCCEEDED":
      return { ...state, creating: false, pendingSessionId: action.sessionId };
    default:
      return state;
  }
}
