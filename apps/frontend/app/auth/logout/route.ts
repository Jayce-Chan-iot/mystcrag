import { NextRequest } from "next/server";
import { getAuthConfig, generateRequestId } from "../../../src/features/auth/server/auth0-server";
import { handleLogoutGet, handleLogoutPost, type LogoutDeps } from "../../../src/features/auth/server/logout";

export const dynamic = "force-dynamic";

/**
 * /auth/logout — explicit Contract wrapper around the Auth0 logout flow.
 *
 * Thin adapter: the full contract logic (exact Origin validation, real SDK cookie
 * cleanup, 303 See Other to the server-constructed Auth0 logout URL, idempotence)
 * lives in `src/features/auth/server/logout.ts` so it is unit-testable.
 *
 * GET never mutates session state (405). POST performs the logout; the client keeps a
 * top-level POST form navigation and the browser follows the 303 to Auth0.
 */

const deps: LogoutDeps = {
  getConfig: () => getAuthConfig(),
  generateRequestId
};

export async function GET() {
  return handleLogoutGet(deps);
}

export async function POST(request: NextRequest) {
  return handleLogoutPost(request, deps);
}
