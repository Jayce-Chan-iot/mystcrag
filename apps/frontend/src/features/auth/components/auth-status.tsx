"use client";

import * as React from "react";
import { useSession } from "../hooks/use-session";
import { AUTH_STATUS_CLASSES, resolveAuthStatusView } from "./auth-status-view";

/**
 * Thin renderer over the pure AuthStatus view model. Every aria role/live region,
 * label, text and class contract lives in `auth-status-view.ts` and is covered by
 * `auth-status.test.tsx`.
 */
export function AuthStatus() {
  const { status, session, login, logout } = useSession();
  const view = resolveAuthStatusView(status, session?.user);

  if (view.state === "loading") {
    return (
      <div className={AUTH_STATUS_CLASSES.loadingRow} role={view.role} aria-live={view.ariaLive}>
        <span className="animate-pulse">{view.text}</span>
      </div>
    );
  }

  if (view.state === "error") {
    return (
      <div className={AUTH_STATUS_CLASSES.errorRow} role={view.role} aria-live={view.ariaLive}>
        <span className="shrink-0">{view.text}</span>
        <button
          type="button"
          onClick={() => login()}
          className={view.action.className}
          aria-label={view.action.ariaLabel}
        >
          {view.action.label}
        </button>
      </div>
    );
  }

  if (view.state === "unauthenticated") {
    return (
      <button
        type="button"
        onClick={() => login()}
        className={view.action.className}
        aria-label={view.action.ariaLabel}
      >
        {view.action.label}
      </button>
    );
  }

  return (
    <div className={view.rowClassName} role={view.role} aria-live={view.ariaLive}>
      <span className={view.displayNameClassName} title={view.displayName}>{view.displayName}</span>
      <button
        type="button"
        onClick={() => logout()}
        className={view.action.className}
        aria-label={view.action.ariaLabel}
      >
        {view.action.label}
      </button>
    </div>
  );
}
