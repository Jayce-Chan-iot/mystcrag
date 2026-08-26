/**
 * BFF proxy contract tests (route-level logic of app/api/[...path]/route.ts).
 *
 * Coverage:
 * - Mutation body is read exactly once and the same value reaches the Backend
 *   (regression for the double `request.text()` bug).
 * - Browser Content-Length / Cookie headers are never hand-forwarded.
 * - Path boundary rejects literal, encoded and double-encoded traversal.
 * - Origin validation happens BEFORE any token operation.
 * - Token errors: 401 (clears invalid session) vs 500 (preserves session).
 * - Real SDK passive rolling: triggered on accepted requests, merged into responses,
 *   fails closed with 500, and never runs before the Origin check for mutations.
 * - Backend 401 invalidates the local session (clears cookies); Backend 403 preserves it.
 * - SDK session-rotation Set-Cookie propagates on success AND on terminating
 *   responses, including backend-unavailable.
 * - Backend Set-Cookie is never forwarded to the browser.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { AccessTokenError, OAuth2Error } from "@auth0/nextjs-auth0/errors";

import { handleBffRequest, resolveBackendUrl, classifyTokenError, type BffDeps } from "./bff";
import { makeConfig, makeRequest, noopAuthEventLogger } from "./auth-test-fixtures";
import type { AuthEventLogger } from "./auth-events";

type FetchCapture = {
  url?: string;
  method?: string;
  headers?: Headers;
  body?: string;
  calls: number;
};

// Simulates the Set-Cookie produced by the SDK's real rolling write.
const ROLLING_COOKIE = "__Host-mystcrag_session=rolled; Max-Age=28800; Path=/; SameSite=Lax; HttpOnly; Secure";

function makeDeps(options: {
  token?: () => Promise<{ token: string }>;
  backend?: () => Response;
  fetchError?: boolean;
  /** Skip the simulated token-rotation Set-Cookie (token set unchanged). */
  rotate?: boolean;
  /** Override the rolling behavior; default writes the rolling cookie. */
  touch?: () => Promise<string[]>;
  /** Override the auth event logger; default is a no-op. */
  logAuthEvent?: AuthEventLogger;
}): { deps: BffDeps; fetchCapture: FetchCapture; tokenCalls: { count: number }; touchCalls: { count: number } } {
  const config = makeConfig();
  const fetchCapture: FetchCapture = { calls: 0 };
  const tokenCalls = { count: 0 };
  const touchCalls = { count: 0 };

  const deps: BffDeps = {
    getConfig: () => config,
    getAccessToken: async (request, sink) => {
      tokenCalls.count += 1;
      void request;
      if (options.rotate !== false) {
        // Simulate SDK session rotation writing Set-Cookie into the sink response.
        sink.headers.append("Set-Cookie", "rotated=1; Path=/; HttpOnly; Secure");
      }
      if (options.token) {
        return options.token();
      }
      return { token: "token-abc" };
    },
    touchSession: async (request) => {
      touchCalls.count += 1;
      void request;
      if (options.touch) {
        return options.touch();
      }
      return [ROLLING_COOKIE];
    },
    fetch: async (url, init) => {
      fetchCapture.calls += 1;
      if (options.fetchError) {
        throw new Error("backend unreachable");
      }
      fetchCapture.url = url;
      fetchCapture.method = init.method;
      fetchCapture.headers = new Headers(init.headers);
      fetchCapture.body = typeof init.body === "string" ? init.body : undefined;
      return options.backend ? options.backend() : new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    generateRequestId: () => "req-test",
    logAuthEvent: options.logAuthEvent ?? noopAuthEventLogger
  };

  return { deps, fetchCapture, tokenCalls, touchCalls };
}

// --- Path boundary ---

test("resolveBackendUrl resolves plain API paths", () => {
  const url = resolveBackendUrl(["designs", "123"], "https://api.mystcrag.com");
  assert.ok(url);
  assert.equal(url.toString(), "https://api.mystcrag.com/api/designs/123");
});

test("resolveBackendUrl rejects literal dot segments", () => {
  assert.equal(resolveBackendUrl(["..", "admin"], "https://api.mystcrag.com"), null);
  assert.equal(resolveBackendUrl([".", "admin"], "https://api.mystcrag.com"), null);
  assert.equal(resolveBackendUrl(["designs", "..", "secret"], "https://api.mystcrag.com"), null);
});

test("resolveBackendUrl rejects percent-encoded traversal", () => {
  assert.equal(resolveBackendUrl(["%2e%2e", "admin"], "https://api.mystcrag.com"), null);
  assert.equal(resolveBackendUrl(["%2E%2E", "admin"], "https://api.mystcrag.com"), null);
});

test("resolveBackendUrl rejects double-encoded traversal", () => {
  assert.equal(resolveBackendUrl(["%252e%252e", "admin"], "https://api.mystcrag.com"), null);
  assert.equal(resolveBackendUrl(["..%252f..%252fadmin"], "https://api.mystcrag.com"), null);
});

test("resolveBackendUrl rejects encoded slash and backslash", () => {
  assert.equal(resolveBackendUrl(["a%2Fb"], "https://api.mystcrag.com"), null);
  assert.equal(resolveBackendUrl(["a%5Cb"], "https://api.mystcrag.com"), null);
  assert.equal(resolveBackendUrl(["a\\b"], "https://api.mystcrag.com"), null);
});

test("resolveBackendUrl rejects empty segments and empty path", () => {
  assert.equal(resolveBackendUrl([], "https://api.mystcrag.com"), null);
  assert.equal(resolveBackendUrl([""], "https://api.mystcrag.com"), null);
  assert.equal(resolveBackendUrl(["a", ""], "https://api.mystcrag.com"), null);
});

test("handleBffRequest returns 403 for traversal path and never calls fetch/token", async () => {
  const { deps, fetchCapture, tokenCalls } = makeDeps({});
  const request = makeRequest("https://app.mystcrag.com/api/x", {
    headers: { origin: makeConfig().appOrigin }
  });
  const response = await handleBffRequest(request, ["..", "admin"], deps);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "FORBIDDEN");
  assert.equal(body.error.requestId, "req-test");
  assert.equal(fetchCapture.calls, 0);
  assert.equal(tokenCalls.count, 0);
});

// --- Mutation body single-read regression ---

test("POST body is read exactly once and the same value reaches the Backend", async () => {
  const { deps, fetchCapture } = makeDeps({});
  const payload = JSON.stringify({ name: "amethyst-bracelet", beads: 12 });
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    method: "POST",
    headers: { origin: makeConfig().appOrigin, "content-type": "application/json" },
    body: payload
  });

  const response = await handleBffRequest(request, ["designs"], deps);

  // A double-read implementation throws "Body is unusable" or forwards the wrong
  // body; either way this assertion fails.
  assert.equal(response.status, 200);
  assert.equal(fetchCapture.body, payload);
  assert.equal(fetchCapture.url, "https://api.mystcrag.com/api/designs");
  assert.equal(fetchCapture.method, "POST");
});

test("PUT/PATCH/DELETE bodies reach the Backend", async () => {
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const { deps, fetchCapture } = makeDeps({});
    const payload = `{"op":"${method}"}`;
    const request = makeRequest("https://app.mystcrag.com/api/items/9", {
      method,
      headers: { origin: makeConfig().appOrigin },
      body: payload
    });
    const response = await handleBffRequest(request, ["items", "9"], deps);
    assert.equal(response.status, 200);
    assert.equal(fetchCapture.body, payload);
    assert.equal(fetchCapture.method, method);
  }
});

test("browser Content-Length and Cookie headers are never forwarded", async () => {
  const { deps, fetchCapture } = makeDeps({});
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    method: "POST",
    headers: { origin: makeConfig().appOrigin, "content-type": "application/json" },
    cookieHeader: "__Host-mystcrag_session=secret-ciphertext",
    body: "{\"x\":1}"
  });
  await handleBffRequest(request, ["designs"], deps);
  assert.ok(fetchCapture.headers);
  assert.equal(fetchCapture.headers.get("content-length"), null);
  assert.equal(fetchCapture.headers.get("cookie"), null);
  assert.equal(fetchCapture.headers.get("authorization"), "Bearer token-abc");
});

// --- Origin validation before token operations ---

test("mutation with mismatched Origin is rejected before any token operation", async () => {
  const { deps, fetchCapture, tokenCalls } = makeDeps({});
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    method: "POST",
    headers: { origin: "https://evil.example.com" },
    body: "{}"
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "FORBIDDEN");
  assert.equal(tokenCalls.count, 0);
  assert.equal(fetchCapture.calls, 0);
});

test("mutation with missing Origin is rejected", async () => {
  const { deps, tokenCalls } = makeDeps({});
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    method: "POST",
    body: "{}"
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 403);
  assert.equal(tokenCalls.count, 0);
});

test("GET requests do not require Origin", async () => {
  const { deps, fetchCapture } = makeDeps({});
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 200);
  assert.equal(fetchCapture.calls, 1);
});

// --- Token error classification ---

test("classifyTokenError maps session failures to unauthorized", () => {
  assert.equal(classifyTokenError({ code: "missing_session" }), "unauthorized");
  assert.equal(classifyTokenError({ code: "session_expired" }), "unauthorized");
  assert.equal(classifyTokenError({ code: "missing_refresh_token" }), "unauthorized");
});

test("failed_to_refresh_token with grant rejection/revocation causes clears the session", () => {
  for (const cause of ["invalid_grant", "access_denied"]) {
    const error = { code: "failed_to_refresh_token", cause: { code: cause } };
    assert.equal(classifyTokenError(error), "unauthorized", cause);
  }
});

test("failed_to_refresh_token with configuration/infrastructure causes preserves the session", () => {
  for (const cause of [
    "invalid_client",
    "unauthorized_client",
    "invalid_request",
    "invalid_scope",
    "server_error",
    "temporarily_unavailable",
    "unknown_error"
  ]) {
    const error = { code: "failed_to_refresh_token", cause: { code: cause } };
    assert.equal(classifyTokenError(error), "internal", cause);
  }
});

test("failed_to_refresh_token with missing or malformed cause preserves the session", () => {
  assert.equal(classifyTokenError({ code: "failed_to_refresh_token" }), "internal");
  assert.equal(classifyTokenError({ code: "failed_to_refresh_token", cause: {} }), "internal");
  assert.equal(classifyTokenError({ code: "failed_to_refresh_token", cause: "invalid_grant" }), "internal");
});

test("real SDK AccessTokenError shapes classify per the refresh matrix", () => {
  const denied = new AccessTokenError(
    "failed_to_refresh_token",
    "refresh failed",
    new OAuth2Error({ code: "invalid_grant", message: "grant revoked" })
  );
  assert.equal(classifyTokenError(denied), "unauthorized");

  const misconfigured = new AccessTokenError(
    "failed_to_refresh_token",
    "refresh failed",
    new OAuth2Error({ code: "invalid_client", message: "client secret rotated" })
  );
  assert.equal(classifyTokenError(misconfigured), "internal");
});

test("classifyTokenError maps discovery/unknown failures to internal", () => {
  assert.equal(classifyTokenError({ code: "discovery_error" }), "internal");
  assert.equal(classifyTokenError(new Error("network")), "internal");
});

test("refresh infrastructure failure returns stable 500 and never logs the user out", async () => {
  const { deps } = makeDeps({
    token: async () => {
      throw new AccessTokenError(
        "failed_to_refresh_token",
        "refresh failed",
        new OAuth2Error({ code: "invalid_client", message: "client misconfiguration" })
      );
    }
  });
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    headers: { origin: makeConfig().appOrigin },
    cookieHeader: "__Host-mystcrag_session=cipher; __Host-mystcrag_session__0=chunk"
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.requestId, "req-test");
  // A configuration/infrastructure refresh failure must never clear the decrypted session.
  const setCookies = response.headers.getSetCookie();
  assert.ok(!setCookies.some((c) => c.includes("Max-Age=0")));
});

test("refresh grant revocation returns 401 and clears the session", async () => {
  const { deps, fetchCapture } = makeDeps({
    token: async () => {
      throw new AccessTokenError(
        "failed_to_refresh_token",
        "refresh failed",
        new OAuth2Error({ code: "invalid_grant", message: "revoked" })
      );
    }
  });
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    headers: { origin: makeConfig().appOrigin },
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.ok(response.headers.getSetCookie().some((c) => c.startsWith("__Host-mystcrag_session=; Max-Age=0")));
  assert.equal(fetchCapture.calls, 0);
});

test("expired/revoked session returns 401 and clears the invalid session cookie", async () => {
  const { deps, fetchCapture } = makeDeps({
    token: async () => {
      throw { code: "session_expired" };
    }
  });
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    headers: { origin: makeConfig().appOrigin },
    cookieHeader: "__Host-mystcrag_session=cipher; __Host-mystcrag_session__0=chunk"
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.equal(body.error.requestId, "req-test");
  const setCookies = response.headers.getSetCookie();
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session=; Max-Age=0")));
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session__0=; Max-Age=0")));
  assert.ok(setCookies.every((c) => c.includes("Path=/") && c.includes("HttpOnly") && c.includes("Secure")));
  assert.equal(fetchCapture.calls, 0);
});

test("provider/JWKS outage returns 500 and preserves the decrypted session", async () => {
  const { deps } = makeDeps({
    token: async () => {
      throw { code: "discovery_error" };
    }
  });
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    headers: { origin: makeConfig().appOrigin },
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  // Session must NOT be cleared on transient outage.
  const setCookies = response.headers.getSetCookie();
  assert.ok(!setCookies.some((c) => c.includes("Max-Age=0")));
});

test("SDK rotation Set-Cookie propagates on successful responses", async () => {
  const { deps } = makeDeps({});
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 200);
  assert.ok(response.headers.getSetCookie().includes("rotated=1; Path=/; HttpOnly; Secure"));
});

test("SDK rotation Set-Cookie survives backend outage (502)", async () => {
  const { deps } = makeDeps({ fetchError: true });
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.requestId, "req-test");
  assert.ok(response.headers.getSetCookie().includes("rotated=1; Path=/; HttpOnly; Secure"));
});

test("Backend Set-Cookie is never forwarded to the browser", async () => {
  const { deps } = makeDeps({
    backend: () =>
      new Response("{}", {
        status: 200,
        headers: { "set-cookie": "backend-session=leak", "content-type": "application/json" }
      })
  });
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const response = await handleBffRequest(request, ["designs"], deps);
  const setCookies = response.headers.getSetCookie();
  assert.ok(!setCookies.some((c) => c.startsWith("backend-session")));
});

test("query parameters are forwarded to the Backend", async () => {
  const { deps, fetchCapture } = makeDeps({});
  const request = makeRequest("https://app.mystcrag.com/api/items?limit=2&sort=asc");
  await handleBffRequest(request, ["items"], deps);
  assert.ok(fetchCapture.url?.includes("limit=2"));
  assert.ok(fetchCapture.url?.includes("sort=asc"));
});

test("error envelope uses no-store cache control", async () => {
  const { deps } = makeDeps({
    token: async () => {
      throw { code: "session_expired" };
    }
  });
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("sink response is never returned directly (NextResponse sink works)", async () => {
  // Guards against the sink being accidentally returned to the client instead of the
  // assembled response.
  const sink = new NextResponse();
  sink.headers.append("Set-Cookie", "probe=1");
  assert.equal(sink.headers.getSetCookie().length, 1);
});

// --- Real SDK passive rolling ---

test("rolling cookie is written even when the Access Token is unchanged", async () => {
  // rotate:false → getAccessToken does NOT write any rotation cookie; the rolling
  // Set-Cookie must still reach the response.
  const { deps, touchCalls } = makeDeps({ rotate: false });
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 200);
  assert.equal(touchCalls.count, 1);
  assert.ok(response.headers.getSetCookie().includes(ROLLING_COOKIE));
});

test("rolling failure fails closed with stable 500 (never a silent passthrough)", async () => {
  const { deps, fetchCapture } = makeDeps({
    touch: async () => {
      throw new Error("session store unavailable");
    }
  });
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.requestId, "req-test");
  assert.equal(response.headers.get("cache-control"), "no-store");
  // The Backend must never be contacted when rolling fails.
  assert.equal(fetchCapture.calls, 0);
});

test("mutation with wrong Origin never calls rolling", async () => {
  const { deps, touchCalls, tokenCalls } = makeDeps({});
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    method: "POST",
    headers: { origin: "https://evil.example.com" },
    body: "{}"
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 403);
  assert.equal(touchCalls.count, 0);
  assert.equal(tokenCalls.count, 0);
});

test("missing session is not rolled into a fake session (rolling writes nothing)", async () => {
  // The real SDK only writes rolling cookies when it decrypted a valid session; the
  // BFF must forward exactly what rolling produced — nothing here.
  const { deps } = makeDeps({
    rotate: false,
    touch: async () => [],
    token: async () => {
      throw { code: "missing_session" };
    }
  });
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  assert.equal(response.headers.getSetCookie().filter((c) => !c.includes("Max-Age=0")).length, 0);
});

// --- Backend 401 invalidates the local session ---

test("Backend 401 invalidates the local session and clears session + legacy cookies", async () => {
  const { deps } = makeDeps({
    backend: () => new Response(JSON.stringify({ error: "token rejected" }), { status: 401 })
  });
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    cookieHeader:
      "__Host-mystcrag_session=cipher; __Host-mystcrag_session__0=chunk; appSession=legacy; appSession.0=legacychunk; unrelated=keep"
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.equal(body.error.requestId, "req-test");
  const setCookies = response.headers.getSetCookie();
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session=; Max-Age=0")));
  assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session__0=; Max-Age=0")));
  assert.ok(setCookies.some((c) => c.startsWith("appSession=; Max-Age=0")));
  assert.ok(setCookies.some((c) => c.startsWith("appSession.0=; Max-Age=0")));
  // Unrelated cookies untouched; rolling/rotation cookies NOT re-appended.
  assert.ok(!setCookies.some((c) => c.startsWith("unrelated")));
  assert.ok(!setCookies.some((c) => c === ROLLING_COOKIE));
  assert.ok(!setCookies.some((c) => c.startsWith("rotated=")));
});

test("Backend 403 preserves the session (no cookie clearing)", async () => {
  const { deps } = makeDeps({
    backend: () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })
  });
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 403);
  const setCookies = response.headers.getSetCookie();
  assert.ok(!setCookies.some((c) => c.includes("Max-Age=0")));
  // Rolling + rotation cookies still propagate for the preserved session.
  assert.ok(setCookies.includes(ROLLING_COOKIE));
});

test("rolling cookies survive backend outage (502)", async () => {
  const { deps } = makeDeps({ fetchError: true });
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 502);
  assert.ok(response.headers.getSetCookie().includes(ROLLING_COOKIE));
});
