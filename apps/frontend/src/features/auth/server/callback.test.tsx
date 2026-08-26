/**
 * Callback contract tests (route-level logic of app/auth/callback/route.ts).
 *
 * Coverage:
 * - Success → real 303 See Other preserving SDK session + transaction Set-Cookie.
 * - Classification matrix over SDK code + wrapped OAuth2 cause code:
 *   - invalid/replayed state, issuer mismatch, session_expired → 401.
 *   - authorization_error / authorization_code_grant_error with denial or invalid-grant
 *     cause (covers invalid/replayed nonce, PKCE, code) → 401.
 *   - authorization_error / authorization_code_grant_error with server_error /
 *     temporarily_unavailable cause → 500.
 *   - discovery/transport/JWKS/dependency outage → 500.
 * - 401 authentication failures clear the actual transaction material, never the session.
 * - 500 provider outage never clears a successfully decrypted session.
 * - Classification uses the typed SDK error, never the URL `error` parameter.
 * - SDK transaction-cleanup Set-Cookie is preserved on failure paths.
 * - All responses keep no-store + Pragma no-cache and never leak the private header.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { handleCallback, classifyCallbackError, type CallbackDeps } from "./callback";
import { CALLBACK_ERROR_HEADER } from "./auth0-server";
import { makeConfig, makeRequest } from "./auth-test-fixtures";

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

/** Builds the sentinel response the onCallback hook produces: `{code}|{causeCode}`. */
function sdkFailure(code: string, cookies: string[] = [], causeCode = ""): Response {
  const response = new Response(null, {
    status: 500,
    headers: { [CALLBACK_ERROR_HEADER]: `${code}|${causeCode}` }
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
    getConfig: () => makeConfig(),
    generateRequestId: () => "req-cb"
  };
}

// --- Error classification matrix (SDK code | wrapped OAuth2 cause code) ---

test("top-level transaction/issuer failures classify as unauthorized", () => {
  for (const code of [
    "missing_state",
    "invalid_state",
    "issuer_validation_error",
    "session_domain_mismatch",
    "session_expired"
  ]) {
    assert.equal(classifyCallbackError(code, undefined), "unauthorized", code);
  }
});

test("authorization_error with denial causes classifies as unauthorized", () => {
  for (const cause of ["access_denied", "login_required", "interaction_required", "consent_required"]) {
    assert.equal(classifyCallbackError("authorization_error", cause), "unauthorized", cause);
  }
});

test("authorization_error with provider outage causes classifies as internal", () => {
  assert.equal(classifyCallbackError("authorization_error", "server_error"), "internal");
  assert.equal(classifyCallbackError("authorization_error", "temporarily_unavailable"), "internal");
});

test("invalid/replayed nonce, PKCE and code (grant error + invalid_grant) classify as unauthorized", () => {
  for (const cause of ["invalid_grant", "invalid_request", "invalid_scope", "unauthorized_client"]) {
    assert.equal(classifyCallbackError("authorization_code_grant_error", cause), "unauthorized", cause);
  }
});

test("grant error with provider outage cause classifies as internal", () => {
  assert.equal(classifyCallbackError("authorization_code_grant_error", "server_error"), "internal");
  assert.equal(classifyCallbackError("authorization_code_grant_error", "temporarily_unavailable"), "internal");
});

test("unknown cause behind a grant failure fails closed as internal", () => {
  assert.equal(classifyCallbackError("authorization_code_grant_error", undefined), "internal");
  assert.equal(classifyCallbackError("authorization_code_grant_error", "brand_new_provider_code"), "internal");
});

test("discovery/transport/JWKS/dependency outage codes classify as internal", () => {
  for (const code of [
    "discovery_error",
    "authorization_code_grant_request_error",
    "invalid_configuration",
    "domain_resolution_error",
    "something_unknown"
  ]) {
    assert.equal(classifyCallbackError(code, undefined), "internal", code);
  }
});

test("bare OAuth2Error carrying a provider denial code classifies as unauthorized", () => {
  assert.equal(classifyCallbackError("access_denied", undefined), "unauthorized");
  assert.equal(classifyCallbackError("login_required", undefined), "unauthorized");
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

test("invalid/replayed state returns 401 UNAUTHORIZED with requestId", async () => {
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

test("issuer validation error returns 401", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const response = await handleCallback(request, makeDeps(() => sdkFailure("issuer_validation_error")));
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("provider denial (authorization_error + access_denied cause) returns 401", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const response = await handleCallback(
    request,
    makeDeps(() => sdkFailure("authorization_error", [], "access_denied"))
  );
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("replayed code/PKCE (grant error + invalid_grant cause) returns 401", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const response = await handleCallback(
    request,
    makeDeps(() => sdkFailure("authorization_code_grant_error", [], "invalid_grant"))
  );
  assert.equal(response.status, 401);
});

test("provider outage (authorization_error + server_error cause) returns 500", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const response = await handleCallback(
    request,
    makeDeps(() => sdkFailure("authorization_error", [], "server_error"))
  );
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

test("provider denial returns 401 even when the SDK throws an OAuth2Error", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?error=access_denied");
  const deps: CallbackDeps = {
    middleware: async () => {
      throw Object.assign(new Error("denied"), { code: "access_denied" });
    },
    getConfig: () => makeConfig(),
    generateRequestId: () => "req-cb"
  };
  const response = await handleCallback(request, deps);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("401 clears actual transaction material present on the request", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz", {
    cookieHeader: "__txn_xyz=transaction-state; unrelated=keep"
  });
  const deps: CallbackDeps = {
    // SDK crashed before producing a cleanup Set-Cookie.
    middleware: async () => {
      throw Object.assign(new Error("replayed"), { code: "invalid_state" });
    },
    getConfig: () => makeConfig(),
    generateRequestId: () => "req-cb"
  };
  const response = await handleCallback(request, deps);
  assert.equal(response.status, 401);
  const setCookies = response.headers.getSetCookie();
  assert.ok(setCookies.some((c) => c.startsWith("__txn_xyz=; Max-Age=0")));
  // Session cookies and unrelated cookies are never touched by callback 401.
  assert.ok(!setCookies.some((c) => c.startsWith("unrelated")));
  assert.ok(!setCookies.some((c) => c.startsWith("__Host-mystcrag_session=;")));
});

test("transaction cleanup Set-Cookie from the SDK is preserved on 401", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const response = await handleCallback(
    request,
    makeDeps(() =>
      sdkFailure("authorization_code_grant_error", ["__txn_xyz=; Max-Age=0; Path=/; HttpOnly"], "invalid_grant")
    )
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

test("500 provider outage never clears the successfully decrypted session", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz", {
    cookieHeader: "__Host-mystcrag_session=valid-cipher; __Host-mystcrag_session__0=chunk"
  });
  const response = await handleCallback(request, makeDeps(() => sdkFailure("discovery_error")));
  assert.equal(response.status, 500);
  const setCookies = response.headers.getSetCookie();
  assert.ok(!setCookies.some((c) => c.includes("Max-Age=0") && c.startsWith("__Host-mystcrag_session")));
});

test("middleware throwing an unknown error returns 500, never a blanket 401", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const deps: CallbackDeps = {
    middleware: async () => {
      throw new Error("jwks fetch failed");
    },
    getConfig: () => makeConfig(),
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
