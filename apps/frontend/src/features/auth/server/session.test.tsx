/**
 * Session endpoint contract tests (route-level logic of app/auth/session/route.ts).
 *
 * Coverage:
 * - Real session projection with no-store caching.
 * - Expired/malformed/authentication-tag-invalid cookie → 200 {"authenticated":false}
 *   plus cookie clearing (the SDK returns null and does not clear it itself).
 * - Anonymous request → 200 {"authenticated":false} without any Set-Cookie.
 * - SDK/runtime dependency failure → 500 INTERNAL_ERROR, never fake anonymity, and the
 *   possibly-valid cookie is preserved.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionData } from "@auth0/nextjs-auth0/types";

import { handleSessionRequest, type SessionDeps } from "./session";
import { makeConfig, makeRequest } from "./auth-test-fixtures";

function makeDeps(session: () => Promise<SessionData | null>): SessionDeps {
  return {
    getConfig: () => makeConfig(),
    getSession: async (request) => {
      void request;
      return session();
    },
    generateRequestId: () => "req-sess"
  };
}

const VALID_SESSION = {
  user: { name: "User", email: "user@example.com", email_verified: true },
  internal: { createdAt: Math.floor(Date.now() / 1000) },
  tokenSet: {
    access_token: "secret-token",
    token_type: "Bearer",
    expires_at: Math.floor(Date.now() / 1000) + 900
  }
} as unknown as SessionData;

test("valid session returns the real projection", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const response = await handleSessionRequest(request, makeDeps(async () => VALID_SESSION));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.user.displayName, "User");
  assert.equal(body.user.email, "user@example.com");
  assert.ok(body.idleExpiresAt);
  assert.ok(body.absoluteExpiresAt);
  // No token/claim leakage.
  assert.ok(!JSON.stringify(body).includes("secret-token"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.getSetCookie().length, 0);
});

test("anonymous request returns authenticated:false without touching cookies", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/session");
  const response = await handleSessionRequest(request, makeDeps(async () => null));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { authenticated: false });
  assert.equal(response.headers.getSetCookie().length, 0);
});

test("expired/malformed cookie returns authenticated:false AND clears the cookie", async () => {
  // The SDK returns null for an undecryptable cookie but leaves it in place; the
  // endpoint must clear it so the browser stops resending it.
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=garbage; __Host-mystcrag_session__0=chunk"
  });
  const response = await handleSessionRequest(request, makeDeps(async () => null));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { authenticated: false });
  const setCookies = response.headers.getSetCookie();
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session=; Max-Age=0")));
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session__0=; Max-Age=0")));
  // Transaction cookies are NOT cleared by the session endpoint.
  assert.ok(!setCookies.some((c) => c.startsWith("__txn_")));
});

test("dependency failure returns 500 and never fakes anonymity", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const deps = makeDeps(async () => {
    throw new Error("sdk runtime failure");
  });
  const response = await handleSessionRequest(request, deps);

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.requestId, "req-sess");
  // The successfully-decryptable session must NOT be cleared on transient outage.
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
