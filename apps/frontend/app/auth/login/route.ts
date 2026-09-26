import { NextRequest } from "next/server";
import type { AuthConfig } from "../../../src/features/auth/model/auth-config";
import {
  getAuthConfig,
  generateRequestId,
  startInteractiveLogin
} from "../../../src/features/auth/server/oidc-server";
import { handleLoginRequest, type LoginDeps } from "../../../src/features/auth/server/login";
import { logAuthEvent } from "../../../src/features/auth/server/auth-events";
import { detectAuthMode, handleDesktopLoginRequest } from "../../../src/features/auth/server/runtime-auth";

export const dynamic = "force-dynamic";

/**
 * GET /auth/login — interactive login initiation against Authing Universal Login.
 * Desktop signed-test mode never instantiates the OIDC client.
 */

function makeDeps(request: NextRequest): LoginDeps {
  return {
    startInteractiveLogin: (options) =>
      startInteractiveLogin({ returnTo: options.returnTo, request }),
    generateRequestId,
    logAuthEvent
  };
}

export async function GET(request: NextRequest) {
  let config: AuthConfig;
  try {
    config = getAuthConfig();
  } catch {
    return handleLoginRequest(request, makeDeps(request));
  }
  if (detectAuthMode(config) === "desktop") {
    return handleDesktopLoginRequest(request, config, {
      generateRequestId,
      logAuthEvent
    });
  }
  return handleLoginRequest(request, makeDeps(request));
}
