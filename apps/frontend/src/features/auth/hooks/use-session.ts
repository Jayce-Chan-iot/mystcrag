"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

export type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "error";

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
    status: data.authenticated ? "authenticated" : "unauthenticated",
    session: data
  };
}

export function useSession() {
  const [status, setStatus] = useState<SessionStatus>("loading");
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
        setStatus("error");
      }
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  const login = useCallback((returnTo?: string) => {
    const url = returnTo ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}` : "/auth/login";
    window.location.href = url;
  }, []);

  const logout = useCallback(async () => {
    try {
      const response = await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" }
      });

      if (response.ok || response.status === 303) {
        window.location.reload();
      } else {
        throw new Error(`Logout failed: ${response.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setStatus("loading");
      const result = await fetchSessionData();
      if (mountedRef.current) {
        setStatus(result.status);
        setSession(result.session);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error("Unknown error"));
        setStatus("error");
      }
    }
  }, []);

  return { status, session, error, login, logout, refresh };
}
