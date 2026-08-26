import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client } from "../../../src/lib/auth/auth0-server";
import { validateReturnTo } from "../../../src/lib/auth/return-to";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Validate returnTo parameter before initiating login
    const returnTo = validateReturnTo(request.nextUrl.searchParams.get("returnTo"));

    const auth0Client = getAuth0Client();

    // Use SDK's startInteractiveLogin with validated returnTo
    return await auth0Client.startInteractiveLogin({ returnTo });
  } catch (error) {
    console.error("Login handler error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Authentication service unavailable." } },
      { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
    );
  }
}
