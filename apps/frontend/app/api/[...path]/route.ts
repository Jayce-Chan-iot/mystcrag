import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client, getAuthConfig } from "../../../src/lib/auth/auth0-server";

export const dynamic = "force-dynamic";

// Headers that must be stripped from browser requests
const STRIP_HEADERS = [
  "authorization", "cookie", "host", "connection", "keep-alive",
  "transfer-encoding", "te", "trailer", "upgrade",
  "proxy-authorization", "proxy-connection"
];

async function proxyToBackend(request: NextRequest, path: string[]) {
  try {
    const config = getAuthConfig();

    if (config.authProvider !== "auth0") {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Authentication service unavailable." } },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Get access token from Auth0 session (server-to-server only)
    let accessToken: string;
    try {
      const auth0Client = getAuth0Client();
      const tokenResult = await auth0Client.getAccessToken(request, new NextResponse() as never);
      accessToken = tokenResult.token;
    } catch (error) {
      console.error("Token retrieval error:", error);
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication is required." } },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication is required." } },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Validate Origin for mutations (non-GET/HEAD)
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const origin = request.headers.get("origin");
      if (!origin || origin !== config.appOrigin) {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Origin validation failed." } },
          { status: 403, headers: { "Cache-Control": "no-store" } }
        );
      }
    }

    // Build backend URL — fixed server-side origin, never user-controlled
    const backendPath = path.join("/");
    const backendUrl = new URL(`/api/${backendPath}`, config.backendOrigin);

    // Copy query parameters
    for (const [key, value] of request.nextUrl.searchParams.entries()) {
      backendUrl.searchParams.append(key, value);
    }

    // Build headers, stripping forbidden ones from browser request
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (!STRIP_HEADERS.includes(lowerKey)) {
        headers.set(key, value);
      }
    }

    // Add Authorization header with server-side access token (token custody)
    headers.set("authorization", `Bearer ${accessToken}`);
    // Set correct Host header for backend
    headers.set("host", new URL(config.backendOrigin).host);

    // Forward request to backend (server-to-server)
    const backendResponse = await fetch(backendUrl.toString(), {
      method: request.method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await request.text(),
      cache: "no-store"
    });

    // Build response, stripping Set-Cookie from backend (never pass through)
    const responseHeaders = new Headers();
    for (const [key, value] of backendResponse.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== "set-cookie" && lowerKey !== "transfer-encoding" && lowerKey !== "connection") {
        responseHeaders.set(key, value);
      }
    }

    // Ensure no-store cache control on all responses
    responseHeaders.set("Cache-Control", "no-store");

    return new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    console.error("BFF proxy error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Backend service unavailable." } },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
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
