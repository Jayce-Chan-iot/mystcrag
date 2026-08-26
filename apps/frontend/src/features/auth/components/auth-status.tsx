"use client";

import * as React from "react";

import { useSession } from "../hooks/use-session";
import { AuthStatusFromSession } from "./auth-status-from-session";

/**
 * Hook-backed AuthStatus: hands the `useSession()` result STRAIGHT to the single tested
 * composition boundary `AuthStatusFromSession` (structured spread — login/logout are
 * never remapped by hand here, so they cannot be swapped at the top level). All view
 * resolution, aria contracts and action binding live in the tested boundary/presenter;
 * no second UI tree exists.
 */
export function AuthStatus() {
  const sessionState = useSession();
  return <AuthStatusFromSession {...sessionState} />;
}
