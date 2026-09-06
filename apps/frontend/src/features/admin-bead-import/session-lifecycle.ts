import {
  ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE,
  type AssetImportSessionResponse
} from "@mystcrag/design-contract";

import { shouldPollSession, type WorkflowAction, type WorkflowErrorInfo } from "./workflow-state";

export const DEFAULT_POLL_INTERVAL_MS = 4000;

export type TimerHandle = unknown;
export type AbortSignalLike = { readonly aborted: boolean };

export type LifecycleTimers = {
  setTimeout: (handler: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

export type ObjectUrlRegistry = {
  createObjectUrl: (source: Blob) => string;
  revokeObjectUrl: (url: string) => void;
};

export type AbortHandle = {
  signal: AbortSignalLike;
  abort: (reason?: unknown) => void;
};

export type SessionLifecycleDeps = {
  timers: LifecycleTimers;
  objectUrls: ObjectUrlRegistry;
  createAbortController: () => AbortHandle;
  fetchSession: (
    sessionId: string,
    init: { signal: AbortSignalLike }
  ) => Promise<AssetImportSessionResponse>;
  dispatch: (action: WorkflowAction) => void;
  now: () => string;
  pollIntervalMs?: number;
  shouldPoll?: (session: AssetImportSessionResponse) => boolean;
};

export type SessionLifecycleController = {
  start(sessionId: string): Promise<void>;
  refresh(): Promise<void>;
  stop(): void;
  trackObjectUrl(source: Blob): string;
  releaseObjectUrl(url: string): void;
  isRunning(): boolean;
};

const TRANSPORT_CODES: ReadonlySet<string> = new Set(
  Object.keys(ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE)
);

const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "UNAUTHORIZED",
  "NOT_FOUND",
  "VALIDATION_ERROR"
]);

/**
 * Operator-facing failure copy. Backend or network detail is never repeated
 * here, so a rejected fetch cannot surface an internal origin or storage path.
 */
const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  UNAUTHORIZED: "管理员会话已失效，请重新登录。",
  NOT_FOUND: "导入任务不存在或已被清理。",
  VALIDATION_ERROR: "请求未被接受，请检查输入后重试。",
  CONFLICT: "服务端数据已更新，请确认后重试。"
};
const GENERIC_FAILURE_MESSAGE = "无法连接珠子素材导入服务。";

export function classifySessionFailure(error: unknown): WorkflowErrorInfo {
  const candidate = (error as { code?: unknown } | null | undefined)?.code;
  const code = typeof candidate === "string" && TRANSPORT_CODES.has(candidate) ? candidate : "INTERNAL_ERROR";
  return {
    code,
    message: FAILURE_MESSAGES[code] ?? GENERIC_FAILURE_MESSAGE,
    retryable: !NON_RETRYABLE_CODES.has(code)
  };
}

/**
 * Owns every side effect of the session workflow: one in-flight read at a
 * time, short polling only while the Backend advances the session, preview
 * object URLs, and abort on unmount. All of it is injected so the lifecycle is
 * testable without a browser.
 */
export function createSessionLifecycle(deps: SessionLifecycleDeps): SessionLifecycleController {
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const shouldPoll = deps.shouldPoll ?? shouldPollSession;
  const trackedObjectUrls = new Set<string>();

  let sessionId: string | null = null;
  let running = false;
  let timer: TimerHandle | null = null;
  let inFlight: AbortHandle | null = null;

  function clearTimer(): void {
    if (timer === null) {
      return;
    }
    const handle = timer;
    timer = null;
    deps.timers.clearTimeout(handle);
  }

  function schedule(kind: "load" | "refresh"): void {
    clearTimer();
    timer = deps.timers.setTimeout(() => {
      timer = null;
      void run(kind);
    }, pollIntervalMs);
  }

  async function run(kind: "load" | "refresh"): Promise<void> {
    const target = sessionId;
    if (!running || target === null || inFlight !== null) {
      return;
    }
    const controller = deps.createAbortController();
    inFlight = controller;
    try {
      const session = await deps.fetchSession(target, { signal: controller.signal });
      if (!running || inFlight !== controller) {
        return;
      }
      inFlight = null;
      deps.dispatch(
        kind === "load"
          ? { type: "SESSION_LOADED", session, syncedAt: deps.now() }
          : { type: "SESSION_REFRESHED", session, syncedAt: deps.now() }
      );
      if (shouldPoll(session)) {
        schedule("refresh");
      }
    } catch (error) {
      if (!running || inFlight !== controller) {
        return;
      }
      inFlight = null;
      const info = classifySessionFailure(error);
      deps.dispatch({ type: "SESSION_FAILED", error: info });
      if (info.retryable) {
        schedule("load");
      }
    }
  }

  function stop(): void {
    running = false;
    clearTimer();
    const controller = inFlight;
    inFlight = null;
    controller?.abort("bead import session lifecycle stopped");
    for (const url of trackedObjectUrls) {
      deps.objectUrls.revokeObjectUrl(url);
    }
    trackedObjectUrls.clear();
  }

  async function start(target: string): Promise<void> {
    stop();
    sessionId = target;
    running = true;
    deps.dispatch({ type: "SESSION_REQUESTED", sessionId: target });
    await run("load");
  }

  function trackObjectUrl(source: Blob): string {
    const url = deps.objectUrls.createObjectUrl(source);
    trackedObjectUrls.add(url);
    return url;
  }

  function releaseObjectUrl(url: string): void {
    if (!trackedObjectUrls.delete(url)) {
      return;
    }
    deps.objectUrls.revokeObjectUrl(url);
  }

  return {
    start,
    refresh: () => run("refresh"),
    stop,
    trackObjectUrl,
    releaseObjectUrl,
    isRunning: () => running
  };
}
