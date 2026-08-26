import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client, getAuthConfig, generateRequestId } from "../../../src/features/auth/server/auth0-server";

export const dynamic = "force-dynamic";

/**
 * BFF (Backend-for-Frontend) proxy route.
 *
 * Contract:
 * - Origin validation happens BEFORE any session/token operations for mutations.
 * - Access Token is obtained server-side only (browser never sees tokens).
 * - Header strategy uses a minimal allowlist — sensitive headers are never forwarded.
 * - Target is always the validated MYSTCRAG_BACKEND_ORIGIN.
 * - Request path cannot escape /api/** via encoding or `..`.
 * - All responses include Cache-Control: no-store and a requestId.
 * - Refreshed/rotated token Set-Cookie headers are propagated to the browser response.
 * - Backend Set-Cookie headers are NOT forwarded to the browser.
 * - Never logs tokens, cookies, authorization, or raw provider errors.
 */

// Minimal header allowlist from browser requests.
// Everything else is stripped.
const ALLOWED_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "accept-encoding",
  "user-agent",
  "referer",
  "origin",
  "x-request-id"
]);

// Headers that must NEVER be forwarded from browser to backend
const NEVER_FORWARD_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
  "proxy-authorization",
  "proxy-connection",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "content-length",
  "x-mystcrag-actor-id",
  "x-mystcrag-session-id"
]);

/**
 * Validates that the request path does not escape /api/** via encoding or `..`.
 */
function isPathSafe(path: string[]): boolean {
  const joined = path.join("/");
  // Reject paths containing path traversal
  if (joined.includes("..")) return false;
  // Reject empty path segments that could cause issues
  if (joined.includes("//")) return false;
  // Each segment must be non-empty
  if (path.some((segment) => segment.length === 0)) return false;
  return true;
}

async function proxyToBackend(request: NextRequest, path: string[]) {
  const requestId = generateRequestId();

  // Validate path safety before any processing
  if (!isPathSafe(path)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Invalid request path.", requestId } },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const config = getAuthConfig();
  const method = request.method.toUpperCase();

  // Origin validation MUST happen BEFORE any session/token operations for mutations
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== config.appOrigin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Origin validation failed.", requestId } },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  // Get access token from Auth0 session (server-to-server only)
  let accessToken: string;
  let tokenResponse: Response | null = null;

  try {
    const auth0Client = getAuth0Client();
    // Use a real Response object to capture Set-Cookie from token refresh
    tokenResponse = new NextResponse();
    const tokenResult = await auth0Client.getAccessToken(request, tokenResponse as never);
    accessToken = tokenResult.token;
  } catch {
    // Token retrieval failure — classify as 401 (missing/expired/revoked session)
    // Do NOT log raw error (may contain token details)
    console.error("Token retrieval failed");
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication is required.", requestId } },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication is required.", requestId } },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Build backend URL — fixed server-side origin, never user-controlled
  const backendPath = path.join("/");
  let backendUrl: URL;
  try {
    backendUrl = new URL(`/api/${backendPath}`, config.backendOrigin);
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Invalid backend request.", requestId } },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Copy query parameters
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    backendUrl.searchParams.append(key, value);
  }

  // Build headers using minimal allowlist
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (ALLOWED_HEADERS.has(lowerKey) && !NEVER_FORWARD_HEADERS.has(lowerKey)) {
      headers.set(key, value);
    }
  }

  // Set server-side Authorization header (token custody)
  headers.set("authorization", `Bearer ${accessToken}`);
  // Set correct Host header for backend
  headers.set("host", new URL(config.backendOrigin).host);
  // Set Content-Length for body requests
  if (method !== "GET" && method !== "HEAD") {
    const bodyText = await request.text();
    if (bodyText) {
      headers.set("content-length", String(Buffer.byteLength(bodyText)));
    }
  }

  // Forward request to backend (server-to-server)
  let backendResponse: Response;
  try {
    backendResponse = await fetch(backendUrl.toString(), {
      method: request.method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await request.text(),
      cache: "no-store"
    });
  } catch {
    // Backend unreachable — 502 Bad Gateway
    console.error("Backend request failed");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Backend service unavailable.", requestId } },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Build response headers
  const responseHeaders = new Headers();

  // Copy safe response headers from backend (excluding Set-Cookie and hop-by-hop)
  for (const [key, value] of backendResponse.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (lowerKey !== "set-cookie" && lowerKey !== "transfer-encoding" && lowerKey !== "connection") {
      responseHeaders.set(key, value);
    }
  }

  // Propagate SDK session cookie refresh (from token acquisition) to the browser.
  // This ensures that refreshed/rotated token sets persist in the session cookie.
  if (tokenResponse) {
    const sdkCookies = tokenResponse.headers.getSetCookie?.() ?? [];
    for (const cookie of sdkCookies) {
      responseHeaders.append("Set-Cookie", cookie);
    }
  }

  // Ensure no-store cache control on all responses
  responseHeaders.set("Cache-Control", "no-store");

  return new NextResponse(backendResponse.body, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyToBackend(request, path);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyToBackend(request, path);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyToBackend(request, path);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyToBackend(request, path);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyToBackend(request, path);
}
