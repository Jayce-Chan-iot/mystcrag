import {
  ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE,
  type CreateAssetImportSessionResponse,
  type ListAssetImportSessionsQuery,
  type ListAssetImportSessionsResponse
} from "@mystcrag/design-contract";

import { BEAD_IMPORT_CLIENT_ERROR_CODES, safeOperatorMessage } from "./api-client";
import type { DashboardAction, DashboardError, DashboardState } from "./dashboard-model";
import type { AbortHandle, AbortSignalLike } from "./session-lifecycle";

/**
 * Owns every side effect of the dashboard: one in-flight list request at a
 * time, cursor paging, session creation and the abort on unmount. Only the
 * newest request may reach the reducer, so a slow page can never overwrite the
 * filter the operator has already moved on from. Failure copy is classified
 * here rather than read off the error, because a raw transport error can name
 * the backend origin.
 */

export type DashboardLoaderAction = DashboardAction;

export type DashboardLoaderClient = {
  listSessions(
    query: ListAssetImportSessionsQuery,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<ListAssetImportSessionsResponse>;
  createSession(idempotencyKey: string): Promise<CreateAssetImportSessionResponse>;
};

export type DashboardLoadRequest = {
  filter: DashboardState["filter"];
  limit: number;
  cursor?: string;
  append?: boolean;
};

export type DashboardLoaderDeps = {
  client: DashboardLoaderClient;
  dispatch: (action: DashboardLoaderAction) => void;
  now: () => string;
  createAbortController: () => AbortHandle;
  newIdempotencyKey: () => string;
  openSession: (sessionId: string) => void;
};

export type DashboardLoader = {
  load(request: DashboardLoadRequest): Promise<void>;
  create(): Promise<void>;
  cancel(): void;
};

const KNOWN_FAILURE_CODES: ReadonlySet<string> = new Set([
  ...Object.keys(ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE),
  ...BEAD_IMPORT_CLIENT_ERROR_CODES
]);

const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set(["UNAUTHORIZED", "NOT_FOUND", "VALIDATION_ERROR"]);

const FALLBACK_MESSAGE_BY_CODE: Readonly<Record<string, string>> = {
  UNAUTHORIZED: "管理员会话已失效，请重新登录。",
  NOT_FOUND: "导入任务不存在或已被清理。",
  NETWORK_ERROR: "无法连接珠子素材导入服务，请稍后重试。"
};
const GENERIC_FAILURE_MESSAGE = "珠子素材导入服务暂时不可用，请稍后重试。";

function classifyFailure(error: unknown): DashboardError {
  const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown } | null | undefined;
  const rawCode = typeof candidate?.code === "string" ? candidate.code : null;
  // An error without a known code never came from the contract client, so its
  // message is untrusted and is dropped instead of being sanitised.
  const known = rawCode !== null && KNOWN_FAILURE_CODES.has(rawCode);
  const code = known && rawCode !== null ? rawCode : "NETWORK_ERROR";
  const fallback = FALLBACK_MESSAGE_BY_CODE[code] ?? GENERIC_FAILURE_MESSAGE;
  const rawMessage = known ? candidate?.message : undefined;
  return {
    code,
    message:
      typeof rawMessage === "string" && rawMessage.trim() !== ""
        ? safeOperatorMessage(rawMessage, fallback)
        : fallback,
    retryable:
      known && typeof candidate?.retryable === "boolean" ? candidate.retryable : !NON_RETRYABLE_CODES.has(code)
  };
}

export function createDashboardLoader(deps: DashboardLoaderDeps): DashboardLoader {
  let requestId = 0;
  let inFlight: AbortHandle | null = null;

  function isCurrent(id: number, controller: AbortHandle): boolean {
    return id === requestId && inFlight === controller;
  }

  async function load(request: DashboardLoadRequest): Promise<void> {
    const append = request.append === true;
    const id = requestId + 1;
    requestId = id;
    const controller = deps.createAbortController();
    const superseded = inFlight;
    inFlight = controller;
    superseded?.abort("bead import dashboard request superseded");

    deps.dispatch({ type: append ? "LOAD_MORE_STARTED" : "LOAD_STARTED" });

    const query: ListAssetImportSessionsQuery = { limit: request.limit };
    if (request.filter !== "ALL") {
      query.state = request.filter;
    }
    if (request.cursor !== undefined) {
      query.cursor = request.cursor;
    }

    try {
      const response = await deps.client.listSessions(query, { signal: controller.signal });
      if (!isCurrent(id, controller)) {
        return;
      }
      inFlight = null;
      deps.dispatch({
        type: append ? "APPEND_SUCCEEDED" : "LOAD_SUCCEEDED",
        sessions: response.sessions,
        nextCursor: response.nextCursor,
        syncedAt: deps.now()
      });
    } catch (error) {
      if (!isCurrent(id, controller)) {
        return;
      }
      inFlight = null;
      deps.dispatch({ type: "LOAD_FAILED", ...classifyFailure(error) });
    }
  }

  async function create(): Promise<void> {
    deps.dispatch({ type: "CREATE_REQUESTED" });
    try {
      const response = await deps.client.createSession(deps.newIdempotencyKey());
      deps.dispatch({ type: "CREATE_SUCCEEDED", sessionId: response.sessionId });
      deps.openSession(response.sessionId);
    } catch (error) {
      deps.dispatch({ type: "CREATE_FAILED", ...classifyFailure(error) });
    }
  }

  function cancel(): void {
    const controller = inFlight;
    inFlight = null;
    requestId += 1;
    controller?.abort("bead import dashboard unmounted");
  }

  return { load, create, cancel };
}
