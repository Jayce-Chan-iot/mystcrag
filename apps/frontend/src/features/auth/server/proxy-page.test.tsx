/**
 * Page-proxy fail-closed contract tests (logic of proxy.ts page navigations).
 *
 * Coverage:
 * - SDK middleware/configuration failure → stable 500 (NEVER NextResponse.next()),
 *   unified envelope, no-store/Pragma, NO Set-Cookie (cookies neither cleared nor
 *   overwritten), and a privacy-safe auth.dependency_failed event.
 * - Backend/API/auth passthrough routing decisions are unaffected by the failure path.
 * - Successful middleware responses pass through unchanged; actually-produced rolling
 *   Set-Cookie emits auth.session_rotation.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { handleProxyPageRolling, type ProxyPageDeps } from "./proxy-page";
import { decideProxyRoute } from "./proxy-routes";
import { makeAuthEventCapture, makeRequest } from "./auth-test-fixtures";

const ROLLING_COOKIE = "__Host-mystcrag_session=rolled; Max-Age=28800; Path=/; SameSite=Lax; HttpOnly; Secure";

function makeDeps(middleware: (request: Parameters<ProxyPageDeps["middleware"]>[0]) => Promise<Response>) {
  const capture = makeAuthEventCapture();
  const deps: ProxyPageDeps = {
    middleware,
    generateRequestId: () => "req-proxy",
    logAuthEvent: capture.logger
  };
  return { deps, capture };
}

test("SDK middleware failure returns 500, never NextResponse.next()", async () => {
  const { deps } = makeDeps(async () => {
    throw new Error("sdk middleware exploded with secret=SHOULD_NOT_APPEAR");
  });
  const request = makeRequest("https://app.mystcrag.com/dashboard");
  const response = await handleProxyPageRolling(request, deps);

  assert.equal(response.status, 500);
  // Fail closed: this must be a JSON error response, not a passthrough rewrite
  // (NextResponse.next() carries the x-middleware-next header and no body).
  assert.equal(response.headers.get("x-middleware-next"), null);
  assert.equal(response.headers.get("content-type")?.includes("application/json"), true);

  const body = await response.json();
  assert.deepEqual(body, {
    error: { code: "INTERNAL_ERROR", message: "Page temporarily unavailable.", requestId: "req-proxy" }
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  // No raw error material in the response.
  assert.ok(!JSON.stringify(body).includes("SHOULD_NOT_APPEAR"));
});

test("middleware failure produces no Set-Cookie (cookies are preserved)", async () => {
  const { deps } = makeDeps(async () => {
    throw new Error("session store outage");
  });
  const request = makeRequest("https://app.mystcrag.com/dashboard", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const response = await handleProxyPageRolling(request, deps);
  assert.equal(response.status, 500);
  // Neither clearing nor overwriting: the response carries no Set-Cookie at all.
  assert.equal(response.headers.getSetCookie().length, 0);
});

test("middleware failure emits exactly one auth.dependency_failed event", async () => {
  const { deps, capture } = makeDeps(async () => {
    throw new Error("config or sdk failure");
  });
  await handleProxyPageRolling(makeRequest("https://app.mystcrag.com/"), deps);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-proxy", outcome: "failure" }
  ]);
});

test("successful middleware response passes through unchanged", async () => {
  const sdkResponse = new Response(null, { status: 200 });
  const { deps, capture } = makeDeps(async () => sdkResponse);
  const response = await handleProxyPageRolling(makeRequest("https://app.mystcrag.com/"), deps);
  assert.strictEqual(response, sdkResponse);
  assert.deepEqual(capture.records, []);
});

test("rolling Set-Cookie from the middleware emits auth.session_rotation", async () => {
  const { deps, capture } = makeDeps(async () =>
    new Response(null, { status: 200, headers: { "Set-Cookie": ROLLING_COOKIE } })
  );
  const response = await handleProxyPageRolling(makeRequest("https://app.mystcrag.com/design"), deps);
  assert.equal(response.status, 200);
  assert.ok(response.headers.getSetCookie().includes(ROLLING_COOKIE));
  assert.deepEqual(capture.records, [
    { event: "auth.session_rotation", category: "session_rotation", requestId: "req-proxy", outcome: "success" }
  ]);
});

test("Backend/API/auth passthrough decisions are unaffected by the failure path", () => {
  // The routing decision is computed BEFORE any SDK interaction; a failing SDK
  // dependency cannot turn allowlisted/API paths into 404s or SDK middleware calls.
  assert.deepEqual(decideProxyRoute("/auth/login"), { kind: "passthrough" });
  assert.deepEqual(decideProxyRoute("/auth/callback"), { kind: "passthrough" });
  assert.deepEqual(decideProxyRoute("/auth/logout"), { kind: "passthrough" });
  assert.deepEqual(decideProxyRoute("/auth/session"), { kind: "passthrough" });
  assert.deepEqual(decideProxyRoute("/api/designs"), { kind: "passthrough" });
  assert.deepEqual(decideProxyRoute("/auth/evil"), { kind: "not-found" });
  // Only page navigations reach the fail-closed SDK middleware handler.
  assert.deepEqual(decideProxyRoute("/dashboard"), { kind: "sdk-rolling" });
});
