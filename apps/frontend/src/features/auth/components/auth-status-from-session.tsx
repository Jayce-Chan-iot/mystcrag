"use client";

/**
 * The single, testable session-to-presenter composition boundary.
 *
 * It receives the exact `useSession()` result shape (status/session/login/logout),
 * resolves the pure view model and binds the REAL login/logout actions to
 * `AuthStatusPresenter`. The top-level `AuthStatus` passes its hook result straight
 * into this boundary (structured spread, no manual action remapping), so this file —
 * not the hook-backed component — is where login/logout wiring is decided and tested.
 * There is exactly one such boundary: any login/logout swap would be caught by
 * `auth-status.test.tsx`, which renders this component as a real ReactElement and
 * invokes the rendered buttons' onClick handlers.
 */

import * as React from "react";
import type { SessionState, SessionStatus } from "../hooks/use-session";
import { resolveAuthStatusView } from "./auth-status-view";
import { AuthStatusPresenter } from "./auth-status-presenter";

export type AuthStatusFromSessionProps = {
  readonly status: SessionStatus;
  readonly session: SessionState | null;
  readonly login: (returnTo?: string) => void;
  readonly logout: () => void;
};

export function AuthStatusFromSession({ status, session, login, logout }: AuthStatusFromSessionProps) {
  const view = resolveAuthStatusView(status, session?.user);
  return <AuthStatusPresenter view={view} onLogin={() => login()} onLogout={() => logout()} />;
}
