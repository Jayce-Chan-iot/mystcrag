import { NextRequest } from "next/server";
import type { AuthConfig } from "../../../src/features/auth/model/auth-config";
import { getAuth0Client, getAuthConfig, generateRequestId, touchSession } from "../../../src/features/auth/server/auth0-server";
import { handleSessionRequest, type SessionDeps } from "../../../src/features/auth/server/session";
import { logAuthEvent } from "../../../src/features/auth/server/auth-events";
import { buildDesktopSessionResponse, detectAuthMode } from "../../../src/features/auth/server/runtime-auth";

export const dynamic = "force-dynamic";

/**
 * GET /auth/session — Safe session projection endpoint.
 *
 * Thin adapter: the full contract logic (real projection, 200 + cookie clearing for
 * expired/malformed cookies, 500 on dependency failure without faking anonymity,
 * no-store caching) lives in `src/features/auth/server/session.ts` so it is
 * unit-testable.
 */

const deps: SessionDeps = {
  getConfig: () => getAuthConfig(),
  getSession: (request) => getAuth0Client().getSession(request),
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
