import {
  CreateOracleSessionRequestSchema,
  OracleCastSessionSchema,
  type CreateOracleSessionRequest,
  type OracleCastSession,
  type OraclePublicSession
} from "@mystcrag/design-contract";

import { toFrontendApiError, type FrontendApiError } from "../../lib/api/frontend-api-error";
import type { OracleApiClient } from "../../lib/api/oracle-api";

export const ORACLE_COORDINATOR_STATES = [
  "idle",
  "casting",
  "revealing",
  "recommended",
  "saving",
  "error"
] as const;

export type OracleCoordinatorState = (typeof ORACLE_COORDINATOR_STATES)[number];

export interface OracleCoordinatorSnapshot {
  readonly state: OracleCoordinatorState;
  readonly session: OraclePublicSession | null;
  readonly selectedDesignId: string | null;
  readonly error: FrontendApiError | null;
}

export type OracleCreateInput = Omit<CreateOracleSessionRequest, "requestId" | "operationId">;

export interface OracleCoordinatorDependencies {
  readonly api: OracleApiClient;
  readonly navigate: (sessionId: string) => void;
  readonly now: () => number;
}

export interface OracleCoordinator {
  getSnapshot(): OracleCoordinatorSnapshot;
  subscribe(listener: () => void): () => void;
  start(input: OracleCreateInput): Promise<void>;
  retryRecommendations(): Promise<void>;
  save(selectedDesignId: string): Promise<void>;
  restore(sessionId: string): Promise<void>;
}

export function createOracleCoordinator({
  api,
  navigate,
  now
}: OracleCoordinatorDependencies): OracleCoordinator {
  let state: OracleCoordinatorState = "idle";
  let session: OraclePublicSession | null = null;
  let selectedDesignId: string | null = null;
  let error: FrontendApiError | null = null;
  let sequence = 0;
  const listeners = new Set<() => void>();
  let snapshot: OracleCoordinatorSnapshot = { state, session, selectedDesignId, error };

  const nextOperationId = (kind: string): string => {
    sequence += 1;
    return `oracle-${kind}-${now()}-${sequence}`;
  };

  const publish = (): void => {
    snapshot = { state, session, selectedDesignId, error };
    for (const listener of listeners) listener();
  };

  const isBusy = (): boolean =>
    state === "casting" || state === "revealing" || state === "saving";

  // A lost create response is ambiguous: the Backend create is idempotent on
  // operationId, so replaying the identical request cannot draw new entropy, and
  // GET then reconciles the authoritative cast before the reveal starts.
  const reconcileCreate = async (request: CreateOracleSessionRequest): Promise<OracleCastSession> => {
    try {
      return (await api.create(request)).session;
    } catch (createError) {
      const apiError = toFrontendApiError(createError);
      if (apiError.code !== "NETWORK_ERROR") throw apiError;
      const replayed = await api.create(request);
      const restored = await api.get(replayed.session.sessionId);
      return OracleCastSessionSchema.parse(restored.session);
    }
  };

  const reconcileRecommendations = async (
    sessionId: string,
    apiError: FrontendApiError
  ): Promise<boolean> => {
    if (apiError.code !== "NETWORK_ERROR") return false;
    try {
      const restored = await api.get(sessionId);
      session = restored.session;
      if (restored.session.status === "RECOMMENDED" || restored.session.status === "SAVED") {
        state = "recommended";
        error = null;
        publish();
        return true;
      }
    } catch {
      // keep the locally readable cast and fall through to the error state
    }
    return false;
  };

  const loadRecommendations = async (): Promise<void> => {
    if (session === null) return;
    const sessionId = session.sessionId;
    const expectedRevision = session.revision;
    try {
      const response = await api.recommendations(sessionId, {
        requestId: nextOperationId("recommend-request"),
        operationId: nextOperationId("recommend-operation"),
        expectedRevision
      });
      session = response.session;
      state = "recommended";
      error = null;
      publish();
    } catch (recommendationError) {
      const apiError = toFrontendApiError(recommendationError);
      if (await reconcileRecommendations(sessionId, apiError)) return;
      error = apiError;
      state = "error";
      publish();
    }
  };

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async start(input) {
      if (isBusy() || state === "recommended") return;
      const request = CreateOracleSessionRequestSchema.parse({
        ...input,
        requestId: nextOperationId("create-request"),
        operationId: nextOperationId("create-operation")
      });
      state = "casting";
      error = null;
      selectedDesignId = null;
      publish();

      let created: OracleCastSession;
      try {
        created = await reconcileCreate(request);
      } catch (createError) {
        error = toFrontendApiError(createError);
        state = "error";
        publish();
        return;
      }

      session = created;
      state = "revealing";
      publish();
      navigate(created.sessionId);
      await loadRecommendations();
    },

    async retryRecommendations() {
      if (session === null || session.status !== "CAST" || isBusy()) return;
      state = "revealing";
      error = null;
      publish();
      await loadRecommendations();
    },

    async save(designId) {
      if (session === null || session.status !== "RECOMMENDED" || isBusy()) return;
      const sessionId = session.sessionId;
      const expectedRevision = session.revision;
      selectedDesignId = designId;
      state = "saving";
      error = null;
      publish();

      try {
        const response = await api.save(sessionId, {
          requestId: nextOperationId("save-request"),
          operationId: nextOperationId("save-operation"),
          expectedRevision,
          selectedDesignId: designId
        });
        session = response.session;
        selectedDesignId = response.session.selectedDesignId ?? designId;
        state = "recommended";
        error = null;
        publish();
      } catch (saveError) {
        const apiError = toFrontendApiError(saveError);
        if (apiError.code === "NETWORK_ERROR") {
          try {
            const restored = await api.get(sessionId);
            session = restored.session;
            if (restored.session.status === "SAVED" && restored.session.selectedDesignId === designId) {
              selectedDesignId = designId;
              state = "recommended";
              error = null;
              publish();
              return;
            }
          } catch {
            // keep the local selection so the operator does not lose their choice
          }
        }
        // The selection stays local and the operator can retry the same save.
        error = apiError;
        state = "error";
        publish();
      }
    },

    async restore(sessionId) {
      if (isBusy()) return;
      state = "casting";
      error = null;
      selectedDesignId = null;
      session = null;
      publish();

      let restored: OraclePublicSession;
      try {
        restored = (await api.get(sessionId)).session;
      } catch (restoreError) {
        error = toFrontendApiError(restoreError);
        state = "error";
        publish();
        return;
      }

      session = restored;
      selectedDesignId = restored.selectedDesignId ?? null;
      if (restored.status === "CAST") {
        state = "revealing";
        publish();
        await loadRecommendations();
        return;
      }
      state = "recommended";
      publish();
    }
  };
}
