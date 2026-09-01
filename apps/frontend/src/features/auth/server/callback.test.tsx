/**
 * Callback contract tests (route-level logic of app/auth/callback/route.ts).
 *
 * Coverage:
 * - Success → real 303 See Other preserving SDK session + transaction Set-Cookie.
 * - Classification matrix over SDK code + wrapped OAuth2 cause code:
 *   - invalid/replayed state, issuer/session-domain rejection, session_expired → 401.
 *   - Provider-declared denial codes → 401.
 *   - authorization_error / authorization_code_grant_error wrapping a denial cause,
 *     invalid_grant or SDK-local `unknown_error` → 401.
 *   - authorization_error / authorization_code_grant_error wrapping
 *     invalid_client/unauthorized_client/invalid_scope/invalid_request/
 *     server_error/temporarily_unavailable → 500.
 *   - discovery/transport/JWKS/dependency outage → 500.
 * - Real Auth0 SDK 4.27 error instances (not plain objects) drive the middleware-throw
 *   path: AuthorizationError/AuthorizationCodeGrantError with OAuth2Error causes,
 *   DiscoveryError, AuthorizationCodeGrantRequestError, MissingStateError, OAuth2Error.
 * - 401 authentication failures clear the actual transaction material, never the session.
 * - 500 provider outage never clears a successfully decrypted session.
 * - Classification uses the typed SDK error, never the URL `error` parameter.
 * - SDK transaction-cleanup Set-Cookie is preserved on failure paths.
 * - All responses keep no-store + Pragma no-cache and never leak the private header.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthorizationCodeGrantError,
  AuthorizationCodeGrantRequestError,
  AuthorizationError,
  DiscoveryError,
  MissingStateError,
  OAuth2Error
} from "@auth0/nextjs-auth0/errors";

import { handleCallback, classifyCallbackError, type CallbackDeps } from "./callback";
import { CALLBACK_ERROR_HEADER } from "./auth0-server";
import { makeConfig, makeRequest, noopAuthEventLogger } from "./auth-test-fixtures";
import type { AuthEventLogger } from "./auth-events";

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

function makeDeps(
  result: () => Promise<Response> | Response,
  logAuthEvent: AuthEventLogger = noopAuthEventLogger
): CallbackDeps {
  return {
    middleware: async (request) => {
      void request;
      return result();
    },
    getConfig: () => makeConfig(),
    generateRequestId: () => "req-cb",
    logAuthEvent
  };
}

// --- Error classification matrix (SDK code | wrapped OAuth2 cause code) ---

test("top-level transaction/issuer/session-domain failures classify as unauthorized", () => {
  for (const code of [
    "missing_state",
    "invalid_state",
    "issuer_validation_error",
    "session_domain_mismatch",
    "domain_validation_error",
    "session_expired"
  ]) {
    assert.equal(classifyCallbackError(code, undefined), "unauthorized", code);
  }
});

test("wrapped provider-denial causes classify as unauthorized", () => {
  for (const cause of [
    "access_denied",
    "login_required",
    "interaction_required",
    "consent_required",
    "account_selection_required"
  ]) {
    assert.equal(classifyCallbackError("authorization_error", cause), "unauthorized", cause);
    assert.equal(classifyCallbackError("authorization_code_grant_error", cause), "unauthorized", cause);
  }
});

test("wrapped invalid_grant (invalid/replayed nonce, PKCE or code) classifies as unauthorized", () => {
  assert.equal(classifyCallbackError("authorization_code_grant_error", "invalid_grant"), "unauthorized");
});

test("SDK-local unknown_error inside known wrappers classifies as unauthorized", () => {
  // SDK 4.27 wraps local authorization-response / code-response validation exceptions
  // as authorization_error / authorization_code_grant_error + unknown_error.
  assert.equal(classifyCallbackError("authorization_error", "unknown_error"), "unauthorized");
  assert.equal(classifyCallbackError("authorization_code_grant_error", "unknown_error"), "unauthorized");
});

test("wrapped client-configuration/AS failure causes classify as internal", () => {
  for (const cause of [
    "invalid_client",
    "unauthorized_client",
    "invalid_scope",
    "invalid_request",
    "server_error",
    "temporarily_unavailable"
  ]) {
    assert.equal(classifyCallbackError("authorization_error", cause), "internal", cause);
    assert.equal(classifyCallbackError("authorization_code_grant_error", cause), "internal", cause);
  }
});

test("unknown or missing cause behind a wrapper fails closed as internal", () => {
  assert.equal(classifyCallbackError("authorization_code_grant_error", undefined), "internal");
  assert.equal(classifyCallbackError("authorization_error", undefined), "internal");
  assert.equal(classifyCallbackError("authorization_code_grant_error", "brand_new_provider_code"), "internal");
});

test("discovery/transport/JWKS/dependency outage codes classify as internal", () => {
  for (const code of [
    "discovery_error",
    "authorization_code_grant_request_error",
    "invalid_configuration",
    "domain_resolution_error",
    "something_unknown",
    "unknown_error"
  ]) {
    assert.equal(classifyCallbackError(code, undefined), "internal", code);
  }
});

test("bare OAuth2Error carrying a provider denial code classifies as unauthorized", () => {
  assert.equal(classifyCallbackError("access_denied", undefined), "unauthorized");
  assert.equal(classifyCallbackError("login_required", undefined), "unauthorized");
});

// --- Real SDK 4.27 error shapes (not plain objects) driving the middleware-throw path ---

function makeThrowingDeps(error: unknown, logAuthEvent: AuthEventLogger = noopAuthEventLogger): CallbackDeps {
  return {
    middleware: async () => {
      throw error;
    },
    getConfig: () => makeConfig(),
    generateRequestId: () => "req-cb",
    logAuthEvent
  };
}

test("real AuthorizationError wrapping OAuth2Error unknown_error returns 401", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const error = new AuthorizationError({
    cause: new OAuth2Error({ code: "unknown_error", message: "invalid nonce" })
  });
  const response = await handleCallback(request, makeThrowingDeps(error));
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.equal(body.error.requestId, "req-cb");
});

test("real AuthorizationCodeGrantError wrapping invalid_grant returns 401", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const error = new AuthorizationCodeGrantError({
    cause: new OAuth2Error({ code: "invalid_grant", message: "replayed code" })
  });
  const response = await handleCallback(request, makeThrowingDeps(error));
  assert.equal(response.status, 401);
});

test("real AuthorizationCodeGrantError wrapping invalid_client returns 500", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const error = new AuthorizationCodeGrantError({
    cause: new OAuth2Error({ code: "invalid_client", message: "client misconfiguration" })
  });
  const response = await handleCallback(request, makeThrowingDeps(error));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

test("real DiscoveryError returns 500 INTERNAL_ERROR", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const response = await handleCallback(request, makeThrowingDeps(new DiscoveryError()));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

test("real AuthorizationCodeGrantRequestError (transport) returns 500", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const error = new AuthorizationCodeGrantRequestError("fetch failed");
  const response = await handleCallback(request, makeThrowingDeps(error));
  assert.equal(response.status, 500);
});

test("real MissingStateError returns 401 and clears transaction material", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc", {
    cookieHeader: "__txn_abc=state-blob"
  });
  const response = await handleCallback(request, makeThrowingDeps(new MissingStateError()));
  assert.equal(response.status, 401);
  assert.ok(response.headers.getSetCookie().some((c) => c.startsWith("__txn_abc=; Max-Age=0")));
});

test("real bare OAuth2Error access_denied returns 401 without leaking provider detail", async () => {
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const error = new OAuth2Error({ code: "access_denied", message: "user said no" });
  const response = await handleCallback(request, makeThrowingDeps(error));
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
  // The provider description must never leave the server.
  assert.ok(!JSON.stringify(body).includes("user said no"));
  assert.ok(!JSON.stringify(body).includes("access_denied"));
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
    generateRequestId: () => "req-cb",
    logAuthEvent: noopAuthEventLogger
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
    generateRequestId: () => "req-cb",
    logAuthEvent: noopAuthEventLogger
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
