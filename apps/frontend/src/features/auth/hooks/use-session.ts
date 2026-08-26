"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildLoginHref, buildLogoutFormSpec, buildReturnTo, type BrowserLocation } from "../model/auth-actions";
import {
  INITIAL_SESSION_STATUS,
  classifySessionResponse,
  reduceSessionStatus,
  type SessionStatus
} from "../model/session-status";

export type { SessionStatus };

export type SessionState = {
  authenticated: boolean;
  user?: {
    displayName?: string;
    email?: string;
    emailVerified?: boolean;
  };
  idleExpiresAt?: string;
  absoluteExpiresAt?: string;
};

async function fetchSessionData(): Promise<{ status: SessionStatus; session: SessionState | null }> {
  const response = await fetch("/auth/session", {
    cache: "no-store",
    credentials: "same-origin"
  });

  if (!response.ok) {
    throw new Error(`Session request failed: ${response.status}`);
  }

  const data: SessionState = await response.json();
  return {
    status: classifySessionResponse(data),
    session: data
  };
}

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

    fetchSessionData().then((result) => {
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
   * This ensures the browser follows the 303 redirect from Auth0
   * (not a fetch following a cross-origin 303).
   */
  const logout = useCallback(() => {
    const spec = buildLogoutFormSpec();
    const form = document.createElement("form");
    form.method = spec.method;
    form.action = spec.action;
    form.style.display = spec.display;
    document.body.appendChild(form);
    form.submit();
  }, []);

  const refresh = useCallback(async () => {
    try {
      setStatus((current) => reduceSessionStatus(current, { type: "reset" }));
      const result = await fetchSessionData();
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
