import type { NextRequest } from "next/server";

import { handleBeadImportProxyRequest } from "../../../../../src/features/admin-bead-import/proxy";

export const dynamic = "force-dynamic";

/**
 * Thin Next.js adapter: the proxy contract (auth-first, path safety, header
 * allowlists, streamed bodies) lives in `src/features/admin-bead-import/proxy.ts`
 * so it is unit-testable without a running server.
 */
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleBeadImportProxyRequest(request, path);
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
