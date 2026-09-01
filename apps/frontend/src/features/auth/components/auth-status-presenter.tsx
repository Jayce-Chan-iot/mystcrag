/**
 * AuthStatus presentational renderer.
 *
 * The single React renderer consumed by `AuthStatus`. It receives the pure view model
 * (`resolveAuthStatusView`) plus the login/logout callbacks and renders every aria
 * role/live region, label, text and class contract. `AuthStatus` (the hook-backed
 * component) delegates all rendering here — there is no second UI tree.
 */

import * as React from "react";
import { AUTH_STATUS_CLASSES, type AuthStatusView } from "./auth-status-view";

export type AuthStatusPresenterProps = {
  readonly view: AuthStatusView;
  readonly onLogin: () => void;
  readonly onLogout: () => void;
};

export function AuthStatusPresenter({ view, onLogin, onLogout }: AuthStatusPresenterProps) {
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
          onClick={() => onLogin()}
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
        onClick={() => onLogin()}
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
        onClick={() => onLogout()}
        className={view.action.className}
        aria-label={view.action.ariaLabel}
      >
        {view.action.label}
      </button>
    </div>
  );
}
