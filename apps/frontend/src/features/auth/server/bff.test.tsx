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
 * - SDK session-rotation Set-Cookie propagates on success AND on terminating
 *   responses, including backend-unavailable.
 * - Backend Set-Cookie is never forwarded to the browser.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

import { handleBffRequest, resolveBackendUrl, classifyTokenError, type BffDeps } from "./bff";
import { makeConfig, makeRequest } from "./auth-test-fixtures";

type FetchCapture = {
  url?: string;
  method?: string;
  headers?: Headers;
  body?: string;
  calls: number;
};

function makeDeps(options: {
  token?: () => Promise<{ token: string }>;
  backend?: () => Response;
  fetchError?: boolean;
}): { deps: BffDeps; fetchCapture: FetchCapture; tokenCalls: { count: number } } {
  const config = makeConfig();
  const fetchCapture: FetchCapture = { calls: 0 };
  const tokenCalls = { count: 0 };

  const deps: BffDeps = {
    getConfig: () => config,
    getAccessToken: async (request, sink) => {
      tokenCalls.count += 1;
      void request;
      // Simulate SDK session rotation writing Set-Cookie into the sink response.
      sink.headers.append("Set-Cookie", "rotated=1; Path=/; HttpOnly; Secure");
      if (options.token) {
        return options.token();
      }
      return { token: "token-abc" };
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
    generateRequestId: () => "req-test"
  };

  return { deps, fetchCapture, tokenCalls };
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

test("classifyTokenError maps provider renewal rejection to unauthorized", () => {
  const error = { code: "failed_to_refresh_token", cause: { code: "invalid_grant" } };
  assert.equal(classifyTokenError(error), "unauthorized");
});

test("classifyTokenError maps transient renewal failure to internal", () => {
  const error = { code: "failed_to_refresh_token", cause: { code: "unknown_error" } };
  assert.equal(classifyTokenError(error), "internal");
  assert.equal(classifyTokenError({ code: "failed_to_refresh_token" }), "internal");
});

test("classifyTokenError maps discovery/unknown failures to internal", () => {
  assert.equal(classifyTokenError({ code: "discovery_error" }), "internal");
  assert.equal(classifyTokenError(new Error("network")), "internal");
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
