/**
 * Session endpoint contract tests (route-level logic of app/auth/session/route.ts).
 *
 * Coverage:
 * - Real session projection with no-store caching.
 * - A valid session use triggers real SDK passive rolling; the rolling Set-Cookie is
 *   merged into the response and idleExpiresAt matches the Max-Age really written.
 * - Rolling failure fails closed with 500 (never faked anonymity, session preserved).
 * - Missing/invalid sessions are never rolled.
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
import { makeAuthEventCapture, makeConfig, makeRequest, noopAuthEventLogger } from "./auth-test-fixtures";
import type { AuthEventLogger } from "./auth-events";

// Simulates the Set-Cookie produced by the SDK's real rolling write.
function rollingCookie(maxAge: number): string {
  return `__Host-mystcrag_session=rolled; Max-Age=${maxAge}; Path=/; SameSite=Lax; HttpOnly; Secure`;
}

function makeDeps(
  session: () => Promise<SessionData | null>,
  options: { touch?: () => Promise<string[]>; logAuthEvent?: AuthEventLogger } = {}
): { deps: SessionDeps; touchCalls: { count: number } } {
  const touchCalls = { count: 0 };
  const deps: SessionDeps = {
    getConfig: () => makeConfig(),
    getSession: async (request) => {
      void request;
      return session();
    },
    touchSession: async (request) => {
      touchCalls.count += 1;
      void request;
      if (options.touch) {
        return options.touch();
      }
      return [rollingCookie(28800)];
    },
    generateRequestId: () => "req-sess",
    logAuthEvent: options.logAuthEvent ?? noopAuthEventLogger
  };
  return { deps, touchCalls };
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

test("valid session returns the real projection and writes the rolling cookie", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const { deps, touchCalls } = makeDeps(async () => VALID_SESSION);
  const response = await handleSessionRequest(request, deps);

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
  // Real rolling happened and its Set-Cookie is merged into the response.
  assert.equal(touchCalls.count, 1);
  assert.ok(response.headers.getSetCookie().includes(rollingCookie(28800)));
});

test("idleExpiresAt matches the Max-Age really written by the rolling response", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const { deps } = makeDeps(async () => VALID_SESSION, {
    touch: async () => [rollingCookie(12345)]
  });
  const response = await handleSessionRequest(request, deps);
  const body = await response.json();

  const before = Math.floor(Date.now() / 1000);
  const idleAt = Math.floor(new Date(body.idleExpiresAt).getTime() / 1000);
  const after = Math.floor(Date.now() / 1000);
  // idleExpiresAt = now + the written Max-Age (not a fabricated now+8h).
  assert.ok(idleAt >= before + 12345 && idleAt <= after + 12345);
});

test("absolute ceiling is never extended by idle rolling", async () => {
  // Session created 6 days 23 hours ago: only 1h remains until the 7d absolute expiry.
  // The SDK's calculateMaxAge caps at createdAt + absoluteDuration, so the written
  // Max-Age is 3600 (not 28800), and the projection must follow the written value.
  const createdAt = Math.floor(Date.now() / 1000) - (604800 - 3600);
  const oldSession = {
    ...VALID_SESSION,
    internal: { createdAt }
  } as unknown as SessionData;
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const { deps } = makeDeps(async () => oldSession, {
    touch: async () => [rollingCookie(3600)]
  });
  const response = await handleSessionRequest(request, deps);
  const body = await response.json();

  const idleAt = Math.floor(new Date(body.idleExpiresAt).getTime() / 1000);
  const absoluteAt = Math.floor(new Date(body.absoluteExpiresAt).getTime() / 1000);
  assert.ok(idleAt <= absoluteAt);
  assert.ok(Math.abs(absoluteAt - (createdAt + 604800)) <= 1);
  // Idle expiry is capped at the absolute ceiling, not now+8h.
  assert.ok(idleAt <= Math.floor(Date.now() / 1000) + 3600 + 1);
});

test("rolling failure fails closed with 500 and preserves the decrypted session", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const { deps } = makeDeps(async () => VALID_SESSION, {
    touch: async () => {
      throw new Error("session store unavailable");
    }
  });
  const response = await handleSessionRequest(request, deps);

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.requestId, "req-sess");
  // Never clear a session that decrypted successfully.
  assert.equal(response.headers.getSetCookie().length, 0);
});

test("anonymous request returns authenticated:false without touching cookies", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/session");
  const { deps, touchCalls } = makeDeps(async () => null);
  const response = await handleSessionRequest(request, deps);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { authenticated: false });
  assert.equal(response.headers.getSetCookie().length, 0);
  // Missing sessions are never rolled.
  assert.equal(touchCalls.count, 0);
});

test("expired/malformed cookie returns authenticated:false AND clears the cookie", async () => {
  // The SDK returns null for an undecryptable cookie but leaves it in place; the
  // endpoint must clear it so the browser stops resending it.
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=garbage; __Host-mystcrag_session__0=chunk; appSession=legacy"
  });
  const { deps, touchCalls } = makeDeps(async () => null);
  const response = await handleSessionRequest(request, deps);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { authenticated: false });
  const setCookies = response.headers.getSetCookie();
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session=; Max-Age=0")));
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session__0=; Max-Age=0")));
  assert.ok(setCookies.some((c) => c.startsWith("appSession=; Max-Age=0")));
  // Transaction cookies are NOT cleared by the session endpoint.
  assert.ok(!setCookies.some((c) => c.startsWith("__txn_")));
  // Invalid sessions are never rolled.
  assert.equal(touchCalls.count, 0);
});

test("dependency failure returns 500 and never fakes anonymity", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const { deps } = makeDeps(async () => {
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

test("getConfig() throwing returns stable 500 INTERNAL_ERROR and preserves cookies", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const capture = makeAuthEventCapture();
  const deps: SessionDeps = {
    getConfig: () => {
      throw new Error("MYSTCRAG_* configuration invalid");
    },
    getSession: async () => null,
    touchSession: async () => [],
    generateRequestId: () => "req-sess",
    logAuthEvent: capture.logger
  };
  const response = await handleSessionRequest(request, deps);

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, {
    error: { code: "INTERNAL_ERROR", message: "Session service unavailable.", requestId: "req-sess" }
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  // A possibly-still-valid cookie is never cleared on configuration failure.
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-sess", outcome: "failure" }
  ]);
});
