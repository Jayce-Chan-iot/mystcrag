/**
 * Callback contract tests (route-level logic of app/auth/callback/route.ts).
 *
 * Coverage:
 * - Success → real 303 See Other preserving SDK session + transaction Set-Cookie.
 * - state/nonce/PKCE/code/replay/provider-denial → 401 UNAUTHORIZED.
 * - Provider/JWKS/SDK outage → 500 INTERNAL_ERROR.
 * - Classification uses the typed SDK error code, never the URL `error` parameter.
 * - SDK transaction-cleanup Set-Cookie is preserved on failure paths.
 * - All responses keep no-store + Pragma no-cache and never leak the private header.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { handleCallback, classifyCallbackErrorCode, type CallbackDeps } from "./callback";
import { CALLBACK_ERROR_HEADER } from "./auth0-server";
import { makeRequest } from "./auth-test-fixtures";

function sdkSuccess(cookies: string[] = []): Response {
  const response = new Response(null, {
    status: 303,
    headers: { location: "https://app.mystcrag.com/dashboard" }
  });
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

function sdkFailure(code: string, cookies: string[] = []): Response {
  const response = new Response(null, {
    status: 500,
    headers: { [CALLBACK_ERROR_HEADER]: code }
  });
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

function makeDeps(result: () => Promise<Response> | Response): CallbackDeps {
  return {
    middleware: async (request) => {
      void request;
      return result();
    },
    generateRequestId: () => "req-cb"
  };
}

// --- Error-code classification table ---

test("auth-failure codes classify as unauthorized", () => {
  for (const code of [
    "missing_state",
    "invalid_state",
    "authorization_error",
    "authorization_code_grant_error",
    "session_expired",
    "access_denied",
    "login_required",
    "consent_required"
  ]) {
    assert.equal(classifyCallbackErrorCode(code), "unauthorized", code);
  }
});

test("infrastructure codes classify as internal", () => {
  for (const code of [
    "discovery_error",
    "authorization_code_grant_request_error",
    "issuer_validation_error",
    "something_unknown"
  ]) {
    assert.equal(classifyCallbackErrorCode(code), "internal", code);
  }
});

// --- Success ---

test("successful callback returns a real 303 preserving session cookies", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const response = await handleCallback(
    request,
    makeDeps(() =>
      sdkSuccess(["__Host-mystcrag_session=cipher; Path=/; HttpOnly; Secure", "__txn_xyz=; Max-Age=0; Path=/"])
    )
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://app.mystcrag.com/dashboard");
  const setCookies = response.headers.getSetCookie();
  assert.ok(setCookies.includes("__Host-mystcrag_session=cipher; Path=/; HttpOnly; Secure"));
  assert.ok(setCookies.some((c) => c.startsWith("__txn_xyz=; Max-Age=0")));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get(CALLBACK_ERROR_HEADER), null);
});

// --- Authentication failures → 401 ---

test("invalid state returns 401 UNAUTHORIZED with requestId", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const response = await handleCallback(
    request,
    makeDeps(() => sdkFailure("invalid_state", ["__txn_xyz=; Max-Age=0; Path=/"]))
  );

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.equal(body.error.requestId, "req-cb");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get(CALLBACK_ERROR_HEADER), null);
});

test("provider denial returns 401 even when the SDK throws an OAuth2Error", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?error=access_denied");
  const deps: CallbackDeps = {
    middleware: async () => {
      throw Object.assign(new Error("denied"), { code: "access_denied" });
    },
    generateRequestId: () => "req-cb"
  };
  const response = await handleCallback(request, deps);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("transaction cleanup Set-Cookie is preserved on 401", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const response = await handleCallback(
    request,
    makeDeps(() => sdkFailure("authorization_code_grant_error", ["__txn_xyz=; Max-Age=0; Path=/; HttpOnly"]))
  );
  assert.equal(response.status, 401);
  assert.ok(response.headers.getSetCookie().some((c) => c.startsWith("__txn_xyz=; Max-Age=0")));
});

// --- Infrastructure failures → 500 ---

test("discovery outage returns 500 INTERNAL_ERROR", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const response = await handleCallback(request, makeDeps(() => sdkFailure("discovery_error")));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.requestId, "req-cb");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("middleware throwing an unknown error returns 500, never a blanket 401", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const deps: CallbackDeps = {
    middleware: async () => {
      throw new Error("jwks fetch failed");
    },
    generateRequestId: () => "req-cb"
  };
  const response = await handleCallback(request, deps);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

// --- Classification must not rely on URL `error` parameter ---

test("URL error parameter alone does NOT force 401 when the SDK succeeds", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?error=access_denied&code=abc");
  const response = await handleCallback(request, makeDeps(() => sdkSuccess()));
  assert.equal(response.status, 303);
});

test("missing URL error parameter does NOT force success semantics", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const response = await handleCallback(request, makeDeps(() => sdkFailure("discovery_error")));
  assert.equal(response.status, 500);
});
