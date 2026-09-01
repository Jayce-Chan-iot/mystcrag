import { NextRequest } from "next/server";
import { getAuth0Client, getAuthConfig, generateRequestId, touchSession } from "../../../src/features/auth/server/auth0-server";
import { handleBffRequest, type BffDeps } from "../../../src/features/auth/server/bff";
import { logAuthEvent } from "../../../src/features/auth/server/auth-events";

export const dynamic = "force-dynamic";

/**
 * BFF (Backend-for-Frontend) proxy route. The full contract logic lives in
 * `src/features/auth/server/bff.ts` so it is unit-testable; this file is the thin
 * Next.js adapter that wires the real Auth0 SDK dependencies.
 */

const deps: BffDeps = {
  getConfig: () => getAuthConfig(),
  getAccessToken: (request, sink) => getAuth0Client().getAccessToken(request, sink),
  touchSession,
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
