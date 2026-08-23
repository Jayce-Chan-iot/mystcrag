import { redirect } from "next/navigation";

import { isAdminAuthenticated, isConsoleConfigured } from "./admin-auth";

/**
 * Server-side gate for every console page: fail closed to the login page when
 * the deployment has no admin key or the visitor has no valid session.
 */
export async function requireConsoleAccess(env: Record<string, string | undefined> = process.env): Promise<void> {
  if (!isConsoleConfigured(env)) {
    redirect("/admin/knowledge/login?error=not-configured");
  }
  if (!(await isAdminAuthenticated(env))) {
    redirect("/admin/knowledge/login");
  }
}
