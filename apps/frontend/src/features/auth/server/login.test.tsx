/**
 * Login route contract tests (route-level logic of app/auth/login/route.ts).
 *
 * Coverage:
 * - Successful login initiation returns the SDK redirect with no-store caching.
 * - Rejected returnTo → safe fallback, auth.open_redirect_rejected carrying the SAME
 *   requestId as used by the response; the raw returnTo never reaches the log.
 * - Configuration/SDK initialization failure → stable 500 INTERNAL_ERROR envelope whose
 *   requestId equals the one in the auth.dependency_failed log record.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

import { handleLoginRequest, type LoginDeps } from "./login";
import { makeAuthEventCapture, makeRequest } from "./auth-test-fixtures";

function makeDeps(options: {
  startInteractiveLogin?: (options: { returnTo: string }) => Promise<Response>;
}) {
  const capture = makeAuthEventCapture();
  const seenReturnTo: string[] = [];
  const deps: LoginDeps = {
    startInteractiveLogin: async (opts) => {
      seenReturnTo.push(opts.returnTo);
      if (options.startInteractiveLogin) {
        return options.startInteractiveLogin(opts);
      }
      return new NextResponse(null, {
        status: 302,
        headers: { location: "https://mystcrag.auth0.com/authorize" }
      });
    },
    generateRequestId: () => "req-login",
    logAuthEvent: capture.logger
  };
  return { deps, capture, seenReturnTo };
}

test("valid returnTo is forwarded to the SDK and the redirect is no-store", async () => {
  const { deps, capture, seenReturnTo } = makeDeps({});
  const request = makeRequest("https://app.mystcrag.com/auth/login?returnTo=%2Fdesign%3Fb%3D1");
  const response = await handleLoginRequest(request, deps);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.deepEqual(seenReturnTo, ["/design?b=1"]);
  assert.deepEqual(capture.records, []);
});

test("rejected returnTo falls back to / and logs open_redirect_rejected with the requestId", async () => {
  const { deps, capture, seenReturnTo } = makeDeps({});
  const request = makeRequest(
    "https://app.mystcrag.com/auth/login?returnTo=https%3A%2F%2Fevil.example%2Fphish"
  );
  const response = await handleLoginRequest(request, deps);

  assert.equal(response.status, 302);
  assert.deepEqual(seenReturnTo, ["/"]);
  assert.deepEqual(capture.records, [
    { event: "auth.open_redirect_rejected", category: "open_redirect", requestId: "req-login", outcome: "failure" }
  ]);
  // The raw returnTo never reaches the sink.
  assert.ok(!JSON.stringify(capture.records).includes("evil.example"));
});

test("configuration/SDK failure returns stable 500 sharing the log requestId", async () => {
  const { deps, capture } = makeDeps({
    startInteractiveLogin: async () => {
      // Simulates getAuth0Client()/config resolution throwing inside the dep.
      throw new Error("MYSTCRAG_AUTH_ISSUER missing (secret detail SHOULD_NOT_APPEAR)");
    }
  });
  const request = makeRequest("https://app.mystcrag.com/auth/login");
  const response = await handleLoginRequest(request, deps);

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  const body = await response.json();
  assert.deepEqual(body, {
    error: { code: "INTERNAL_ERROR", message: "Authentication service unavailable.", requestId: "req-login" }
  });
  // Same requestId in the structured log; exactly one dependency event; no raw error.
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-login", outcome: "failure" }
  ]);
  assert.ok(!JSON.stringify(body).includes("SHOULD_NOT_APPEAR"));
});
