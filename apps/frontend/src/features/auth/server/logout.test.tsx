/**
 * Logout contract tests (route-level logic of app/auth/logout/route.ts).
 *
 * Coverage:
 * - GET → unified-envelope 405 ({error:{code,message,requestId}}, Allow: POST,
 *   Cache-Control: no-store) and never mutates cookies.
 * - POST validates exact Origin first; missing/mismatched Origin → 403, no cookies.
 * - Success → real 303 See Other to the server-constructed Auth0 logout URL.
 * - Never returns 200 inline-script HTML.
 * - Real SDK cookie cleanup: session main cookie, `{name}__{index}` chunks, SDK legacy
 *   `appSession`/`appSession.N` cookies and `__txn_*` transaction cookies present on
 *   the request, with deletion attributes mirroring creation attributes (Path, SameSite,
 *   HttpOnly, Secure/host-only).
 * - Secure derives from the verified app origin, not NODE_ENV.
 * - Repeated POSTs are idempotent.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { handleLogoutGet, handleLogoutPost, type LogoutDeps } from "./logout";
import { makeAuthEventCapture, makeConfig, makeDevConfig, makeRequest, noopAuthEventLogger } from "./auth-test-fixtures";
import type { AuthEventLogger } from "./auth-events";


async function withDiscoveryMock<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("openid-configuration")) {
      return Response.json({
        issuer: "https://pool.authing.cn/oidc/",
        authorization_endpoint: "https://pool.authing.cn/oidc/auth",
        token_endpoint: "https://pool.authing.cn/oidc/token",
        jwks_uri: "https://pool.authing.cn/oidc/keys",
        end_session_endpoint: "https://pool.authing.cn/oidc/session/end"
      });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function makeDeps(config = makeConfig(), logAuthEvent: AuthEventLogger = noopAuthEventLogger): LogoutDeps {
  return {
    getConfig: () => config,
    generateRequestId: () => "req-out",
    logAuthEvent
  };
}

const SESSION_COOKIES =
  "__Host-mystcrag_session=cipher; __Host-mystcrag_session__0=chunk0; __Host-mystcrag_session__1=chunk1; " +
  "__txn_state123=txn; unrelated=keep";

// --- GET is 405 and non-mutating ---

test("GET /auth/logout returns the unified 405 envelope and never sets cookies", async () => {
  const response = handleLogoutGet(makeDeps());
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.getSetCookie().length, 0);
  const body = await response.json();
  assert.deepEqual(body, {
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for logout.",
      requestId: "req-out"
    }
  });
});

// --- Origin validation ---

test("POST with missing Origin returns 403 and clears nothing", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    cookieHeader: SESSION_COOKIES
  });
  const response = await handleLogoutPost(request, makeDeps());
  assert.equal(response.status, 403);
  const body = response.json();
  assert.equal(response.headers.getSetCookie().length, 0);
  return body.then((parsed) => {
    assert.equal(parsed.error.code, "FORBIDDEN");
    assert.equal(parsed.error.requestId, "req-out");
  });
});

test("POST with mismatched Origin returns 403, clears nothing and logs auth.origin_rejected", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://evil.example.com" },
    cookieHeader: SESSION_COOKIES
  });
  const response = await handleLogoutPost(request, makeDeps(makeConfig(), capture.logger));
  assert.equal(response.status, 403);
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.deepEqual(capture.records, [
    { event: "auth.origin_rejected", category: "origin_rejected", requestId: "req-out", outcome: "failure" }
  ]);
});

// --- Success: real 303 to server-constructed logout URL ---

test("POST returns a real 303 See Other to the discovery end_session URL", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://app.mystcrag.com" },
    cookieHeader: SESSION_COOKIES
  });
  const response = await withDiscoveryMock(() => handleLogoutPost(request, makeDeps()));

  assert.equal(response.status, 303);
  const location = response.headers.get("location");
  assert.ok(location);
  const url = new URL(location as string);
  assert.equal(url.origin, "https://pool.authing.cn");
  assert.equal(url.pathname, "/oidc/session/end");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("post_logout_redirect_uri"), "https://app.mystcrag.com");
  // No token/session material in the logout URL.
  assert.ok(!location.includes("token"));
  assert.ok(!location.includes("cipher"));

  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
});

test("POST never returns 200 HTML", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://app.mystcrag.com" },
    cookieHeader: SESSION_COOKIES
  });
  const response = await handleLogoutPost(request, makeDeps());
  assert.notEqual(response.status, 200);
  assert.ok(!(response.headers.get("content-type") ?? "").includes("text/html"));
});

// --- Real SDK cookie cleanup ---

test("POST clears session main cookie, chunks and transaction cookies", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://app.mystcrag.com" },
    cookieHeader: SESSION_COOKIES
  });
  const response = await withDiscoveryMock(() => handleLogoutPost(request, makeDeps()));
  const setCookies = response.headers.getSetCookie();

  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session=; ")));
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session__0=; ")));
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session__1=; ")));
  assert.ok(setCookies.some((c) => c.startsWith("__txn_state123=; ")));

  // Deletion attributes mirror creation attributes.
  for (const cookie of setCookies) {
    assert.ok(cookie.includes("Max-Age=0"), cookie);
    assert.ok(cookie.includes("Path=/"), cookie);
    assert.ok(cookie.includes("SameSite=Lax"), cookie);
    assert.ok(cookie.includes("HttpOnly"), cookie);
    assert.ok(cookie.includes("Secure"), cookie); // HTTPS app origin → Secure
    assert.ok(!cookie.includes("Domain="), cookie); // host-only
  }

  // Never guesses fixed `.0`..`.9` names for cookies that do not exist, and never
  // touches unrelated cookies.
  assert.ok(!setCookies.some((c) => c.startsWith("unrelated=")));
  assert.ok(!setCookies.some((c) => c.startsWith("__Host-mystcrag_session.0=")));
});

test("Secure attribute derives from app origin, not NODE_ENV (dev loopback HTTP)", async () => {
  const request = makeRequest("http://localhost:3000/auth/logout", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    cookieHeader: "mystcrag_session=cipher; mystcrag_session__0=chunk0"
  });
  const response = await withDiscoveryMock(() => handleLogoutPost(request, makeDeps(makeDevConfig())));
  const setCookies = response.headers.getSetCookie();

  assert.ok(setCookies.some((c) => c.startsWith("mystcrag_session=; ")));
  assert.ok(setCookies.some((c) => c.startsWith("mystcrag_session__0=; ")));
  for (const cookie of setCookies) {
    assert.ok(!cookie.includes("Secure"), cookie);
  }
});

// --- Idempotence ---

test("repeated POSTs are idempotent 303 sequences", async () => {
  const deps = makeDeps();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: "https://pool.authing.cn/oidc/",
        authorization_endpoint: "https://pool.authing.cn/oidc/auth",
        token_endpoint: "https://pool.authing.cn/oidc/token",
        jwks_uri: "https://pool.authing.cn/oidc/keys",
        end_session_endpoint: "https://pool.authing.cn/oidc/session/end"
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    // First logout clears everything.
    const first = await handleLogoutPost(
      makeRequest("https://app.mystcrag.com/auth/logout", {
        method: "POST",
        headers: { origin: "https://app.mystcrag.com" },
        cookieHeader: SESSION_COOKIES
      }),
      deps
    );
    assert.equal(first.status, 303);
    const firstLocation = first.headers.get("location");
    assert.ok(firstLocation?.includes("/session/end"));

    // Second logout: the browser no longer sends the cleared cookies.
    const second = await handleLogoutPost(
      makeRequest("https://app.mystcrag.com/auth/logout", {
        method: "POST",
        headers: { origin: "https://app.mystcrag.com" }
      }),
      deps
    );
    assert.equal(second.status, 303);
    assert.equal(second.headers.get("location"), firstLocation);

    // Nothing chunk/transaction-specific remains to clear.
    const setCookies = second.headers.getSetCookie();
    assert.ok(!setCookies.some((c) => c.startsWith("__Host-mystcrag_session__0=")));
    assert.ok(!setCookies.some((c) => c.startsWith("__txn_")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- Upstream URL construction ---


test("config failure surfaces as stable 500 envelope with dependency event, not a redirect", async () => {
  const capture = makeAuthEventCapture();
  const deps: LogoutDeps = {
    getConfig: () => {
      throw new Error("invalid config");
    },
    generateRequestId: () => "req-out",
    logAuthEvent: capture.logger
  };
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://app.mystcrag.com" },
    cookieHeader: SESSION_COOKIES
  });
  const response = await handleLogoutPost(request, deps);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = response.json();
  // No cookie is touched on configuration failure.
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-out", outcome: "failure" }
  ]);
  return body.then((parsed) => {
    assert.deepEqual(parsed, {
      error: { code: "INTERNAL_ERROR", message: "Authentication service unavailable.", requestId: "req-out" }
    });
  });
});
