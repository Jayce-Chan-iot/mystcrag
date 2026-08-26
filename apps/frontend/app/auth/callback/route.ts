import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /auth/callback is handled by proxy.ts → Auth0 SDK middleware.
// This route handler is a fallback that should never be reached in normal operation.
export async function GET() {
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Callback must be processed by the authentication middleware." } },
    { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
  );
}
