import type { NextRequest } from "next/server";

import { handleBeadImportProxyRequest } from "../../../../../src/features/admin-bead-import/proxy";

export const dynamic = "force-dynamic";

/**
 * Cookie-scoped mount of the bead import proxy. The admin session cookie is
 * bound to `/admin/bead-import`, so browsers never attach it to the
 * `/api/admin/bead-import/...` mount; this alias is the entry point the browser
 * client actually calls. All proxy rules live in the shared handler, so the two
 * mounts cannot drift.
 */
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleBeadImportProxyRequest(request, path);
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
