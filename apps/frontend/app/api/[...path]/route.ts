import { NextRequest } from "next/server";
import {
  getAuthConfig,
  generateRequestId,
  getAccessToken,
  touchSession
} from "../../../src/features/auth/server/oidc-server";
import { handleBffRequest, type BffDeps } from "../../../src/features/auth/server/bff";
import { logAuthEvent } from "../../../src/features/auth/server/auth-events";
import { makeAccessTokenResolver, makeTouchSession } from "../../../src/features/auth/server/runtime-auth";

export const dynamic = "force-dynamic";

/**
 * BFF proxy route. Desktop mode swaps in the server-only desktop identity so the
 * Authing OIDC client is never instantiated.
 */

const oidcAccessTokenResolver = makeAccessTokenResolver(
  () => getAuthConfig(),
  async (request, sink) => {
    const result = await getAccessToken(request);
    for (const cookie of result.setCookies) {
      sink.headers.append("Set-Cookie", cookie);
    }
    return { token: result.token };
  }
);
const touchSessionForMode = makeTouchSession(() => getAuthConfig(), touchSession);

const deps: BffDeps = {
  getConfig: () => getAuthConfig(),
  getAccessToken: (request, sink) => oidcAccessTokenResolver(request, sink),
  touchSession: touchSessionForMode,
  fetch: (url, init) => fetch(url, init),
  generateRequestId,
  logAuthEvent
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleBffRequest(request, path, deps);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleBffRequest(request, path, deps);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleBffRequest(request, path, deps);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleBffRequest(request, path, deps);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleBffRequest(request, path, deps);
}
