/**
 * Logout contract tests (route-level logic of app/auth/logout/route.ts).
 *
 * Coverage:
 * - GET → 405 and never mutates cookies.
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

import { handleLogoutGet, handleLogoutPost, buildUpstreamLogoutUrl, type LogoutDeps } from "./logout";
import { makeConfig, makeDevConfig, makeRequest } from "./auth-test-fixtures";

function makeDeps(config = makeConfig()): LogoutDeps {
  return {
    getConfig: () => config,
    generateRequestId: () => "req-out"
  };
}

const SESSION_COOKIES =
  "__Host-mystcrag_session=cipher; __Host-mystcrag_session__0=chunk0; __Host-mystcrag_session__1=chunk1; " +
  "appSession=legacy; appSession.0=legacychunk; __txn_state123=txn; unrelated=keep";

// --- GET is 405 and non-mutating ---

test("GET /auth/logout returns 405 and never sets cookies", () => {
  const response = handleLogoutGet(makeDeps());
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.equal(response.headers.getSetCookie().length, 0);
});

// --- Origin validation ---

test("POST with missing Origin returns 403 and clears nothing", () => {
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    cookieHeader: SESSION_COOKIES
  });
  const response = handleLogoutPost(request, makeDeps());
  assert.equal(response.status, 403);
  const body = response.json();
  assert.equal(response.headers.getSetCookie().length, 0);
  return body.then((parsed) => {
    assert.equal(parsed.error.code, "FORBIDDEN");
    assert.equal(parsed.error.requestId, "req-out");
  });
});

test("POST with mismatched Origin returns 403 and clears nothing", () => {
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://evil.example.com" },
    cookieHeader: SESSION_COOKIES
  });
  const response = handleLogoutPost(request, makeDeps());
  assert.equal(response.status, 403);
  assert.equal(response.headers.getSetCookie().length, 0);
});

// --- Success: real 303 to server-constructed logout URL ---

test("POST returns a real 303 See Other to the Auth0 logout URL", () => {
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://app.mystcrag.com" },
    cookieHeader: SESSION_COOKIES
  });
  const response = handleLogoutPost(request, makeDeps());

  assert.equal(response.status, 303);
  const location = response.headers.get("location");
  assert.ok(location);
  const url = new URL(location as string);
  assert.equal(url.origin, "https://mystcrag.auth0.com");
  assert.equal(url.pathname, "/oidc/logout");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("post_logout_redirect_uri"), "https://app.mystcrag.com");
  // No token/session material in the logout URL.
  assert.ok(!location.includes("token"));
  assert.ok(!location.includes("cipher"));

  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
});

test("POST never returns 200 HTML", () => {
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://app.mystcrag.com" },
    cookieHeader: SESSION_COOKIES
  });
  const response = handleLogoutPost(request, makeDeps());
  assert.notEqual(response.status, 200);
  assert.ok(!(response.headers.get("content-type") ?? "").includes("text/html"));
});

// --- Real SDK cookie cleanup ---

test("POST clears session main cookie, SDK chunks, legacy cookies and transaction cookies", () => {
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://app.mystcrag.com" },
    cookieHeader: SESSION_COOKIES
  });
  const response = handleLogoutPost(request, makeDeps());
  const setCookies = response.headers.getSetCookie();

  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session=; ")));
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session__0=; ")));
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session__1=; ")));
  // SDK legacy cookies (v3) are also recognized and cleared.
  assert.ok(setCookies.some((c) => c.startsWith("appSession=; ")));
  assert.ok(setCookies.some((c) => c.startsWith("appSession.0=; ")));
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

test("Secure attribute derives from app origin, not NODE_ENV (dev loopback HTTP)", () => {
  const request = makeRequest("http://localhost:3000/auth/logout", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    cookieHeader: "mystcrag_session=cipher; mystcrag_session__0=chunk0"
  });
  const response = handleLogoutPost(request, makeDeps(makeDevConfig()));
  const setCookies = response.headers.getSetCookie();

  assert.ok(setCookies.some((c) => c.startsWith("mystcrag_session=; ")));
  assert.ok(setCookies.some((c) => c.startsWith("mystcrag_session__0=; ")));
  for (const cookie of setCookies) {
    assert.ok(!cookie.includes("Secure"), cookie);
  }
});

// --- Idempotence ---

test("repeated POSTs are idempotent 303 sequences", () => {
  const deps = makeDeps();

  // First logout clears everything.
  const first = handleLogoutPost(
    makeRequest("https://app.mystcrag.com/auth/logout", {
      method: "POST",
      headers: { origin: "https://app.mystcrag.com" },
      cookieHeader: SESSION_COOKIES
    }),
    deps
  );
  assert.equal(first.status, 303);
  const firstLocation = first.headers.get("location");

  // Second logout: the browser no longer sends the cleared cookies.
  const second = handleLogoutPost(
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
});

// --- Upstream URL construction ---

test("buildUpstreamLogoutUrl uses only client id and allowlisted post-logout URL", () => {
  const url = buildUpstreamLogoutUrl("https://mystcrag.auth0.com/", "cid", "https://app.mystcrag.com");
  assert.equal(url, "https://mystcrag.auth0.com/oidc/logout?client_id=cid&post_logout_redirect_uri=https%3A%2F%2Fapp.mystcrag.com");
});

test("config failure surfaces as 500, not a redirect", () => {
  const deps: LogoutDeps = {
    getConfig: () => {
      throw new Error("invalid config");
    },
    generateRequestId: () => "req-out"
  };
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://app.mystcrag.com" }
  });
  const response = handleLogoutPost(request, deps);
  assert.equal(response.status, 500);
});
