"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildLoginHref, buildReturnTo, type BrowserLocation } from "../model/auth-actions";
import { submitLogoutForm } from "../browser/logout-form";
import {
  fetchSessionSnapshot,
  type SessionSnapshot,
  type SessionState
} from "../browser/session-client";
import {
  INITIAL_SESSION_STATUS,
  reduceSessionStatus,
  type SessionStatus
} from "../model/session-status";

export type { SessionSnapshot, SessionState, SessionStatus };

/**
 * The returnTo value for login navigations: the current location exactly as the user
 * sees it (pathname + search + hash). The server validates it via `validateReturnTo`
 * (absolute URLs, `//`, backslashes and encoded bypasses are rejected server-side).
 */
export function currentReturnTo(): string {
  const { pathname, search, hash } = window.location;
  return buildReturnTo({ pathname, search, hash });
}

export function useSession() {
  const [status, setStatus] = useState<SessionStatus>(INITIAL_SESSION_STATUS);
  const [session, setSession] = useState<SessionState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    fetchSessionSnapshot().then((result: SessionSnapshot) => {
      if (!cancelled && mountedRef.current) {
        setStatus(result.status);
        setSession(result.session);
        setError(null);
      }
    }).catch((err) => {
      if (!cancelled && mountedRef.current) {
        setError(err instanceof Error ? err : new Error("Unknown error"));
        setStatus((current) => reduceSessionStatus(current, { type: "failed" }));
      }
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  /**
   * Login always saves the current location (pathname + search + hash) as returnTo so
   * protected pages restore their exact position after authentication. The home page
   * simply produces returnTo="/". Server-side validation is the single trust boundary.
   */
  const login = useCallback((returnTo?: string) => {
    const location: BrowserLocation = window.location;
    const href = returnTo !== undefined
      ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
      : buildLoginHref(location);
    window.location.href = href;
  }, []);

  /**
   * Logout uses a top-level POST navigation via a dynamically created form.
   * This ensures the browser follows the 303 redirect from Authing end_session
   * (not a fetch following a cross-origin 303). The DOM form creation/submission is
   * the single tested helper `submitLogoutForm`.
   */
  const logout = useCallback(() => {
    submitLogoutForm(document);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setStatus((current) => reduceSessionStatus(current, { type: "reset" }));
      const result = await fetchSessionSnapshot();
      if (mountedRef.current) {
        setStatus(result.status);
        setSession(result.session);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error("Unknown error"));
        setStatus((current) => reduceSessionStatus(current, { type: "failed" }));
      }
    }
  }, []);

  return { status, session, error, login, logout, refresh };
}
