"use client";

import type { AssetImportSessionState } from "@mystcrag/design-contract";
import * as React from "react";

import { createBeadImportClient, newIdempotencyKey } from "../api-client";
import { createDashboardLoader } from "../dashboard-loader";
import { DASHBOARD_DEFAULT_LIMIT, dashboardReducer, initialDashboardState } from "../dashboard-model";
import { DashboardView } from "./dashboard-view";

/**
 * Wiring only. Decisions live in `dashboard-model`, side effects in
 * `dashboard-loader`. Opening a session navigates the whole document so the task
 * page re-verifies the admin cookie on the server and rebuilds itself from the
 * Backend instead of inheriting anything held here.
 */
export function BeadImportDashboard() {
  const [state, dispatch] = React.useReducer(dashboardReducer, undefined, () =>
    initialDashboardState(DASHBOARD_DEFAULT_LIMIT)
  );

  const loader = React.useMemo(
    () =>
      createDashboardLoader({
        client: createBeadImportClient(),
        dispatch,
        now: () => new Date().toISOString(),
        createAbortController: () => new AbortController(),
        newIdempotencyKey,
        openSession: (sessionId) => {
          window.location.assign(`/admin/bead-import/${encodeURIComponent(sessionId)}`);
        }
      }),
    []
  );

  React.useEffect(() => {
    void loader.load({ filter: state.filter, limit: state.limit });
  }, [loader, state.filter, state.limit]);

  React.useEffect(() => {
    return () => loader.cancel();
  }, [loader]);

  const handleCreate = React.useCallback(() => {
    void loader.create();
  }, [loader]);

  const handleRetry = React.useCallback(() => {
    void loader.load({ filter: state.filter, limit: state.limit });
  }, [loader, state.filter, state.limit]);

  const handleLoadMore = React.useCallback(() => {
    if (state.nextCursor === null) {
      return;
    }
    void loader.load({
      filter: state.filter,
      limit: state.limit,
      cursor: state.nextCursor,
      append: true
    });
  }, [loader, state.filter, state.limit, state.nextCursor]);

  const handleFilterChange = React.useCallback((value: AssetImportSessionState | "ALL") => {
    dispatch({ type: "FILTER_CHANGED", state: value });
  }, []);

  return (
    <DashboardView
      state={state}
      onCreate={handleCreate}
      onRetry={handleRetry}
      onLoadMore={handleLoadMore}
      onFilterChange={handleFilterChange}
    />
  );
}
