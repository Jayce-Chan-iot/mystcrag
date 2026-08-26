import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "../../../src/lib/auth/auth0-server";

export const dynamic = "force-dynamic";

// GET /auth/logout must NOT modify session.
// This is a security requirement: logout must use POST with Origin validation.
export async function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for logout." } },
    { status: 405, headers: { "Cache-Control": "no-store", "Allow": "POST" } }
  );
}

export async function POST(request: NextRequest) {
  try {
    const config = getAuthConfig();

    // Require exact Origin match for CSRF protection
    const origin = request.headers.get("origin");
    if (!origin || origin !== config.appOrigin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Origin validation failed." } },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Determine cookie name based on environment
    const nodeEnv: string = process.env.NODE_ENV ?? "development";
    const isProduction = nodeEnv === "production" || nodeEnv === "staging";
    const cookieName = isProduction ? "__Host-mystcrag_session" : "mystcrag_session";

    // Clear local session cookie
    const cookieParts = [
      `${cookieName}=`,
      "Max-Age=0",
      "Path=/",
      "SameSite=Lax",
      "HttpOnly"
    ];
    if (isProduction) {
      cookieParts.push("Secure");
    }

    // Build Auth0 logout redirect URL
    const logoutUrl = new URL(config.authLogoutUrl);
    // Return to app origin after Auth0 logout
    logoutUrl.searchParams.set("returnTo", config.appOrigin);
    logoutUrl.searchParams.set("client_id", config.authClientId);

    // Return 303 redirect to Auth0 logout endpoint
    const response = NextResponse.redirect(logoutUrl.toString(), 303);
    response.headers.append("Set-Cookie", cookieParts.join("; "));
    response.headers.set("Cache-Control", "no-store");

    return response;
  } catch (error) {
    console.error("Logout handler error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Authentication service unavailable." } },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
