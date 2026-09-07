import type { NextRequest } from "next/server";

import { handlePublicAssetRequest } from "../../../../src/features/design/server/public-asset-proxy";

export const dynamic = "force-dynamic";

/**
 * Public, credential-free same-origin delivery of approved bead assets. The
 * browser only ever sees this route; the proxy contract (strict key shape,
 * no forwarded credentials, streamed body, allowlisted response headers,
 * redacted failures) lives in the server helper so it is testable without a
 * running server. Public assets require no login and no admin cookie or key.
 */
async function get(_request: NextRequest, { params }: { params: Promise<{ assetKey: string }> }) {
  const { assetKey } = await params;
  return handlePublicAssetRequest({
    assetKeyParam: assetKey,
    env: { MYSTCRAG_BACKEND_ORIGIN: process.env.MYSTCRAG_BACKEND_ORIGIN }
  });
}

export { get as GET };
