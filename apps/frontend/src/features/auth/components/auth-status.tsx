"use client";

import * as React from "react";

import { useSession } from "../hooks/use-session";
import { resolveAuthStatusView } from "./auth-status-view";
import { AuthStatusPresenter } from "./auth-status-presenter";

/**
 * Hook-backed AuthStatus: resolves session state into the pure view model and delegates
 * ALL rendering to `AuthStatusPresenter` (the single tested renderer). No second UI
 * tree exists — every aria role/live region, label, text and class contract is rendered
 * by the presenter and covered by `auth-status.test.tsx`.
 */
export function AuthStatus() {
  const { status, session, login, logout } = useSession();
  const view = resolveAuthStatusView(status, session?.user);

  return <AuthStatusPresenter view={view} onLogin={() => login()} onLogout={() => logout()} />;
}
