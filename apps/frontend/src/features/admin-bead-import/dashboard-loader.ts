import {
  type CreateAssetImportSessionResponse,
  type ListAssetImportSessionsQuery,
  type ListAssetImportSessionsResponse
} from "@mystcrag/design-contract";

import type { DashboardAction, DashboardState } from "./dashboard-model";
import { classifyFailure } from "./failure-copy";
import type { AbortHandle, AbortSignalLike } from "./session-lifecycle";

/**
 * Owns every side effect of the dashboard: one in-flight list request at a
 * time, cursor paging, session creation and the abort on unmount. Only the
 * newest request may reach the reducer, so a slow page can never overwrite the
 * filter the operator has already moved on from. Failure copy comes from the
 * shared classifier rather than off the error, because a raw transport error
 * can name the backend origin.
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
