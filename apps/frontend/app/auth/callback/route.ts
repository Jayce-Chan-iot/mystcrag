import { NextRequest } from "next/server";
import { getAuthConfig, generateRequestId } from "../../../src/features/auth/server/oidc-server";
import { handleCallback, type CallbackDeps } from "../../../src/features/auth/server/callback";
import { logAuthEvent } from "../../../src/features/auth/server/auth-events";

export const dynamic = "force-dynamic";

const deps: CallbackDeps = {
  getConfig: () => getAuthConfig(),
  generateRequestId,
  logAuthEvent
};

export async function GET(request: NextRequest) {
  return handleCallback(request, deps);
}
