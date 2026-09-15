import { NextRequest } from "next/server";
import type { AuthConfig } from "../../../src/features/auth/model/auth-config";
import { getAuthConfig, generateRequestId } from "../../../src/features/auth/server/oidc-server";
import { handleLogoutGet, handleLogoutPost, type LogoutDeps } from "../../../src/features/auth/server/logout";
import { logAuthEvent } from "../../../src/features/auth/server/auth-events";
import { detectAuthMode, handleDesktopLogoutRequest } from "../../../src/features/auth/server/runtime-auth";

export const dynamic = "force-dynamic";

const deps: LogoutDeps = {
  getConfig: () => getAuthConfig(),
  generateRequestId,
  logAuthEvent
};

export async function GET() {
  return handleLogoutGet(deps);
}

export async function POST(request: NextRequest) {
  let config: AuthConfig;
  try {
    config = getAuthConfig();
  } catch {
    return handleLogoutPost(request, deps);
  }
  if (detectAuthMode(config) === "desktop") {
    return handleDesktopLogoutRequest(request, config, {
      generateRequestId,
      logAuthEvent
    });
  }
  return handleLogoutPost(request, deps);
}
