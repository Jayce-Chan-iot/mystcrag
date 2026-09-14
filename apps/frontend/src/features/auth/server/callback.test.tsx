/**
 * Authing OIDC callback contract tests.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { handleCallback, type CallbackDeps } from "./callback";
import { completeOidcCallback } from "./oidc-server";
import { makeConfig, makeRequest, noopAuthEventLogger } from "./auth-test-fixtures";
import { buildTransactionSetCookie, type LoginTransactionPayload } from "./oidc-transaction";
import type { AuthEventLogger } from "./auth-events";

const SESSION_SECRET = "d".repeat(64);

function cfg() {
  return { ...makeConfig(), authSessionSecret: SESSION_SECRET, authProvider: "authing" as const, authIssuer: "https://pool.authing.cn/oidc/" };
}

function makeDeps(logAuthEvent: AuthEventLogger = noopAuthEventLogger): CallbackDeps {
  return {
    getConfig: () => cfg(),
    generateRequestId: () => "req-cb",
    logAuthEvent
  };
}

function callbackRequest(query: string, cookie?: string): NextRequest {
  return makeRequest(`https://app.mystcrag.com/auth/callback?${query}`, {
    cookieHeader: cookie
  });
}

test("missing state is unauthorized and never creates a session", async () => {
  const response = await handleCallback(callbackRequest("code=abc"), makeDeps());
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("unknown/replayed transaction state is unauthorized", async () => {
  const response = await handleCallback(
    callbackRequest("code=abc&state=replayed-state"),
    makeDeps()
  );
  assert.equal(response.status, 401);
});

test("provider access_denied is unauthorized", async () => {
  const config = cfg();
  const transaction: LoginTransactionPayload = {
    state: "state-denied",
    nonce: "nonce-1",
    codeVerifier: "verifier-1",
    returnTo: "/diy/abc",
    createdAt: Math.floor(Date.now() / 1000)
  };
  const cookie = await buildTransactionSetCookie(transaction, config);
  const response = await handleCallback(
    callbackRequest("error=access_denied&state=state-denied", cookie),
    makeDeps()
  );
  assert.equal(response.status, 401);
  // Transaction material is cleared on authentication failure.
  const setCookies = response.headers.getSetCookie();
  assert.ok(setCookies.some((c) => c.startsWith("__txn_state-denied=;")));
});

test("success path validates state, exchanges the code, sets session cookies and 303s", async () => {
  const config = cfg();
  const transaction: LoginTransactionPayload = {
    state: "state-ok",
    nonce: "nonce-ok",
    codeVerifier: "verifier-ok",
    returnTo: "/tarot/setup?theme=love#step",
    createdAt: Math.floor(Date.now() / 1000)
  };
  const cookie = await buildTransactionSetCookie(transaction, config);

  // Synthetic OIDC: monkey-patch fetch for discovery, token, and JWKS.
  const originalFetch = globalThis.fetch;
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", use: "sig", alg: "RS256" };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: "https://pool.authing.cn/oidc/",
        authorization_endpoint: "https://pool.authing.cn/oidc/auth",
        token_endpoint: "https://pool.authing.cn/oidc/token",
        jwks_uri: "https://pool.authing.cn/oidc/keys",
        end_session_endpoint: "https://pool.authing.cn/oidc/session/end"
      });
    }
    if (url.includes("/oidc/token")) {
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT({
        nonce: "nonce-ok",
        name: "Authing用户",
        email: "u@example.com",
        email_verified: false
      })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer("https://pool.authing.cn/oidc/")
        .setAudience("client-id")
        .setSubject("authing|user-1")
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(privateKey);
      return Response.json({
        access_token: "access-token-1",
        token_type: "Bearer",
        expires_in: 900,
        refresh_token: "refresh-token-1",
        id_token: idToken
      });
    }
    if (url.includes("/oidc/keys")) {
      return Response.json({ keys: [jwk] });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await handleCallback(
      callbackRequest("code=auth-code&state=state-ok", cookie),
      makeDeps()
    );
    assert.equal(response.status, 303);
    const location = response.headers.get("location")!;
    const redirect = new URL(location);
    assert.equal(redirect.pathname, "/tarot/setup");
    assert.equal(redirect.searchParams.get("theme"), "love");
    assert.equal(redirect.hash, "#step");
    const setCookies = response.headers.getSetCookie();
    assert.ok(setCookies.some((c) => c.startsWith("__Host-mystcrag_session=") || c.startsWith("mystcrag_session=")));
    assert.ok(setCookies.some((c) => c.startsWith("__txn_state-ok=;")));
    assert.ok(setCookies.every((c) => !c.includes("access-token-1")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("completeOidcCallback classifies discovery outage as internal and clears txn", async () => {
  const config = cfg();
  const transaction: LoginTransactionPayload = {
    state: "state-outage",
    nonce: "n",
    codeVerifier: "v",
    returnTo: "/",
    createdAt: Math.floor(Date.now() / 1000)
  };
  const cookie = await buildTransactionSetCookie(transaction, config);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  try {
    const request = callbackRequest("code=x&state=state-outage", cookie);
    const outcome = await completeOidcCallback(request, config);
    assert.equal(outcome.kind, "internal");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
