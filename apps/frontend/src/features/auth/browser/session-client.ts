/**
 * Shared safe browser session snapshot for auth UI.
 *
 * Classification uses only the non-sensitive capability `logoutAvailable:false`.
 * The browser projection never carries a runtime mode string, credentials, or a
 * full authentication URL.
 */

import { classifySessionResponse, type SessionStatus } from "../model/session-status";

export type SessionState = {
  authenticated: boolean;
  user?: {
    displayName?: string;
    email?: string;
    emailVerified?: boolean;
  };
  /**
   * Server capability signal. `false` (desktop demo) means the UI must not offer a
   * logout control; absent/true keeps the interactive "退出" action.
   */
  logoutAvailable?: boolean;
  idleExpiresAt?: string;
  absoluteExpiresAt?: string;
};

export type SessionSnapshot = {
  status: SessionStatus;
  session: SessionState | null;
};

export async function fetchSessionSnapshot(
  fetcher: typeof fetch = fetch
): Promise<SessionSnapshot> {
  const response = await fetcher("/auth/session", {
    cache: "no-store",
    credentials: "same-origin"
  });

  if (!response.ok) {
    throw new Error(`Session request failed: ${response.status}`);
  }

  const session = (await response.json()) as SessionState;
  return {
    status: classifySessionResponse(session),
    session
  };
}

/**
 * Auth-required prompt mode. `desktop-recovery` is selected only when the session is
 * explicitly authenticated and carries the non-sensitive capability
 * `logoutAvailable: false`. Display names and other profile hints are never used.
 */
export function resolveAuthPromptMode(
  snapshot: SessionSnapshot
): "auth0" | "desktop-recovery" {
  return snapshot.status === "authenticated" &&
    snapshot.session?.authenticated === true &&
    snapshot.session.logoutAvailable === false
    ? "desktop-recovery"
    : "auth0";
}
