import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig, generateRequestId } from "../../../src/features/auth/server/auth0-server";

export const dynamic = "force-dynamic";

/**
 * Cookie names used by the Auth0 SDK session.
 * Must match creation attributes exactly for deletion.
 */
function getCookieNames(): { session: string; chunkPrefix: string } {
  const nodeEnv: string = process.env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production" || nodeEnv === "staging";
  const session = isProduction ? "__Host-mystcrag_session" : "mystcrag_session";
  return { session, chunkPrefix: `${session}.` };
}

function isProductionLike(): boolean {
  const nodeEnv: string = process.env.NODE_ENV ?? "development";
  return nodeEnv === "production" || nodeEnv === "staging";
}

/**
 * Builds Set-Cookie header strings to clear all session-related cookies.
 * Deletion attributes must match creation attributes exactly.
 */
function buildCookieClearHeaders(): string[] {
  const { session: sessionName, chunkPrefix } = getCookieNames();
  const isProduction = isProductionLike();
  const cookies: string[] = [];

  // Clear main session cookie
  const mainParts = [
    `${sessionName}=`,
    "Max-Age=0",
    "Path=/",
    "SameSite=Lax",
    "HttpOnly"
  ];
  if (isProduction) mainParts.push("Secure");
  cookies.push(mainParts.join("; "));

  // Clear chunked session cookies (app.#mystcrag_session.0, .1, etc.)
  // We clear up to 10 chunks to cover all realistic session sizes
  for (let i = 0; i < 10; i++) {
    const chunkParts = [
      `${chunkPrefix}${i}=`,
      "Max-Age=0",
      "Path=/",
      "SameSite=Lax",
      "HttpOnly"
    ];
    if (isProduction) chunkParts.push("Secure");
    cookies.push(chunkParts.join("; "));
  }

  // Clear transaction cookies (app.transient, app.nonce, etc.)
  const transactionNames = [
    "app.transient",
    "app.nonce",
    "app.code_verifier",
    "app.state",
    "app.pkce"
  ];
  for (const name of transactionNames) {
    cookies.push(`${name}=; Max-Age=0; Path=/; SameSite=Lax`);
  }

  return cookies;
}

/**
 * Constructs the Auth0 upstream logout URL from the validated issuer.
 * Uses the OIDC RP-Initiated Logout endpoint: ${issuer}oidc/logout
 */
function buildUpstreamLogoutUrl(
  issuer: string,
  clientId: string,
  postLogoutReturnUrl: string
): string {
  // issuer is validated as https://dns-host/ with trailing slash
  const upstreamEndpoint = new URL("oidc/logout", issuer);
  upstreamEndpoint.searchParams.set("client_id", clientId);
  upstreamEndpoint.searchParams.set("post_logout_redirect_uri", postLogoutReturnUrl);
  return upstreamEndpoint.toString();
}

// GET /auth/logout must NOT modify session.
// This is a security requirement: logout must use POST with Origin validation.
export async function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for logout." } },
    { status: 405, headers: { "Cache-Control": "no-store", "Allow": "POST" } }
  );
}

/**
 * POST /auth/logout — authenticated logout with CSRF protection.
 *
 * 1. Validates Origin header.
 * 2. Clears all local session/transaction cookies.
 * 3. Returns an HTML page containing a secure auto-submitting form
 *    that POSTs to the Auth0 OIDC logout endpoint.
 * 4. The browser follows the 303 redirect from Auth0 back to the app.
 *
 * This approach ensures:
 * - Top-level navigation (not fetch) for cross-origin redirect.
 * - Local cookie cleanup happens before upstream navigation.
 * - No tokens in the logout URL.
 * - Idempotent: repeated POSTs produce the same result.
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId();

  try {
    const config = getAuthConfig();

    // Require exact Origin match for CSRF protection
    const origin = request.headers.get("origin");
    if (!origin || origin !== config.appOrigin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Origin validation failed.", requestId } },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Build cookie clearing headers
    const cookieHeaders = buildCookieClearHeaders();

    // Construct the Auth0 upstream logout URL from the validated issuer
    const upstreamLogoutUrl = buildUpstreamLogoutUrl(
      config.authIssuer,
      config.authClientId,
      config.authLogoutUrl
    );

    // Return an HTML page with an auto-submitting form that navigates to Auth0.
    // This ensures top-level navigation (not fetch following cross-origin 303).
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>退出登录</title></head>
<body>
<p>正在退出登录…</p>
<form id="logout-form" action="${escapeHtml(upstreamLogoutUrl)}" method="GET">
<noscript><button type="submit">继续退出</button></noscript>
</form>
<script>document.getElementById('logout-form').submit();</script>
</body>
</html>`;

    const response = new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });

    // Set cookie clearing headers BEFORE the browser processes the form
    for (const cookie of cookieHeaders) {
      response.headers.append("Set-Cookie", cookie);
    }

    return response;
  } catch {
    console.error("Logout handler failed");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Authentication service unavailable.", requestId } },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

/**
 * Escapes HTML special characters to prevent XSS in the form action URL.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
