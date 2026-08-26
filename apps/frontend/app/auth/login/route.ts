import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client } from "../../../src/features/auth/server/auth0-server";
import { validateReturnTo } from "../../../src/features/auth/model/return-to";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const returnTo = validateReturnTo(request.nextUrl.searchParams.get("returnTo"));
    const auth0Client = getAuth0Client();
    const redirectResponse = await auth0Client.startInteractiveLogin({ returnTo });

    // Add cache control headers to prevent caching of auth redirects
    redirectResponse.headers.set("Cache-Control", "no-store");
    redirectResponse.headers.set("Pragma", "no-cache");

    return redirectResponse;
  } catch {
    // Do NOT log raw error details (may contain tokens or claims)
    console.error("Login handler failed");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Authentication service unavailable.", requestId: generateRequestId() } },
      { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
    );
  }
}

function generateRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
