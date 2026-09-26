import { NextRequest } from "next/server";
import type { AuthConfig } from "../../../src/features/auth/model/auth-config";
import {
  getAuthConfig,
  generateRequestId,
  getSession,
  touchSession
} from "../../../src/features/auth/server/oidc-server";
import { handleSessionRequest, type SessionDeps } from "../../../src/features/auth/server/session";
import { logAuthEvent } from "../../../src/features/auth/server/auth-events";
import { buildDesktopSessionResponse, detectAuthMode } from "../../../src/features/auth/server/runtime-auth";

export const dynamic = "force-dynamic";

const deps: SessionDeps = {
  getConfig: () => getAuthConfig(),
  getSession: (request) => getSession(request),
  touchSession,
  generateRequestId,
  logAuthEvent
};

export async function GET(request: NextRequest) {
  let config: AuthConfig;
  try {
    config = getAuthConfig();
  } catch {
    return handleSessionRequest(request, deps);
  }
  if (detectAuthMode(config) === "desktop") {
    return buildDesktopSessionResponse();
  }
  return handleSessionRequest(request, deps);
}
