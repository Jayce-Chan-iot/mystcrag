/**
 * Codex review regression suite for TASK-AUTH-011 blockers.
 * These cases must fail on 831de6b and pass after the fix commit.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import type { AuthConfig } from "../model/auth-config";
import {
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
  buildSessionSetCookies,
  readSession,
  rollSessionIfNeeded,
  type OidcSessionPayload
} from "./oidc-session-store";
import { OidcDiscoverySource } from "./oidc-discovery";
import { ProviderUnavailableError } from "./oidc-errors";
import { completeOidcCallback, getAccessToken } from "./oidc-server";
import { buildTransactionSetCookie } from "./oidc-transaction";
import { makeConfig, makeRequest } from "./auth-test-fixtures";

const SESSION_SECRET = "e".repeat(64);
const ISSUER = "https://pool.authing.cn/oidc/";

function cfg(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    ...makeConfig(),
    authSessionSecret: SESSION_SECRET,
    authProvider: "authing",
    authIssuer: ISSUER,
    authClientId: "client-id",
    authClientSecret: "client-secret",
    authCallbackUrl: "https://app.mystcrag.com/auth/callback",
    authLogoutUrl: "https://app.mystcrag.com",
    ...overrides
  };
}

function session(overrides: Partial<OidcSessionPayload> = {}): OidcSessionPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    user: { name: "U" },
    accessToken: "at",
    accessTokenExpiresAt: now + 900,
    refreshToken: "rt",
    createdAt: now,
    lastActivityAt: now,
    ...overrides
  };
}

function requestWithCookies(url: string, cookieHeader: string): NextRequest {
  return makeRequest(url, { cookieHeader });
}

function cookiePairs(setCookies: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of setCookies) {
    const eq = c.indexOf("=");
    if (eq <= 0) continue;
    map.set(c.slice(0, eq), c.slice(eq + 1).split(";")[0] ?? "");
  }
  return map;
}

// --- 1) idle expiry is authenticated server-side ---

test("replayed ciphertext older than 8h idle is rejected even before 7d absolute", async () => {
  const config = cfg();
  const now = Math.floor(Date.now() / 1000);
  const idleStale = session({
    createdAt: now - 9 * 3600,
    lastActivityAt: now - 9 * 3600
  });
  const cookies = await buildSessionSetCookies(idleStale, config);
  const header = cookies.map((c) => c.split(";")[0]).join("; ");
  const request = requestWithCookies("https://app.mystcrag.com/auth/session", header);
  const result = await readSession(request, config);
  assert.equal(result, null);
});

test("session within 8h idle and 7d absolute is accepted", async () => {
  const config = cfg();
  const cookies = await buildSessionSetCookies(session(), config);
  const header = cookies.map((c) => c.split(";")[0]).join("; ");
  const request = requestWithCookies("https://app.mystcrag.com/auth/session", header);
  const result = await readSession(request, config);
  assert.ok(result);
});

test("idle exactly 28800 seconds is rejected and 28799 is accepted", async () => {
  const config = cfg();
  const now = Math.floor(Date.now() / 1000);
  const exactIdle = session({
    createdAt: now - 100,
    lastActivityAt: now - SESSION_IDLE_SECONDS
  });
  const cookiesExact = await buildSessionSetCookies(exactIdle, config);
  const headerExact = cookiesExact.map((c) => c.split(";")[0]).join("; ");
  assert.equal(
    await readSession(requestWithCookies("https://app.mystcrag.com/auth/session", headerExact), config),
    null
  );

  const justInside = session({
    createdAt: now - 100,
    lastActivityAt: now - (SESSION_IDLE_SECONDS - 1)
  });
  const cookiesInside = await buildSessionSetCookies(justInside, config);
  const headerInside = cookiesInside.map((c) => c.split(";")[0]).join("; ");
  assert.ok(
    await readSession(requestWithCookies("https://app.mystcrag.com/auth/session", headerInside), config)
  );
});

test("absolute 7d ceiling still rejects", async () => {
  const config = cfg();
  const now = Math.floor(Date.now() / 1000);
  const expired = session({
    createdAt: now - SESSION_ABSOLUTE_SECONDS - 1,
    lastActivityAt: now - 60
  });
  const cookies = await buildSessionSetCookies(expired, config);
  const header = cookies.map((c) => c.split(";")[0]).join("; ");
  const request = requestWithCookies("https://app.mystcrag.com/auth/session", header);
  assert.equal(await readSession(request, config), null);
});

test("rolling updates authenticated lastActivityAt but never extends createdAt+7d", async () => {
  const config = cfg();
  const now = Math.floor(Date.now() / 1000);
  const createdAt = now - (SESSION_ABSOLUTE_SECONDS - 3600);
  const payload = session({ createdAt, lastActivityAt: now - 3600 });
  const rolled = await rollSessionIfNeeded(
    requestWithCookies("https://app.mystcrag.com/", ""),
    payload,
    config,
    now
  );
  assert.ok(rolled.length > 0);
  const pairs = cookiePairs(rolled);
  const value = pairs.get("__Host-mystcrag_session") ?? pairs.get("mystcrag_session") ?? "";
  assert.ok(value.length > 0);
  // decrypt via read path
  const header = rolled.map((c) => c.split(";")[0]).join("; ");
  const reread = await readSession(requestWithCookies("https://app.mystcrag.com/", header), config);
  assert.ok(reread);
  assert.ok(reread.lastActivityAt! >= now);
  assert.equal(reread.createdAt, createdAt);
  const maxAgeMatch = /Max-Age=(\d+)/.exec(rolled[0] ?? "");
  assert.ok(maxAgeMatch);
  assert.ok(Number(maxAgeMatch[1]) <= SESSION_IDLE_SECONDS);
  assert.ok(Number(maxAgeMatch[1]) <= 3600 + 1);
});

// --- 2) chunk protocol ---

test("multi-chunk write/read with explicit count metadata", async () => {
  const config = cfg();
  // Force multi-chunk by padding user/access token with a large refresh token.
  const large = session({
    accessToken: "at".repeat(2000),
    refreshToken: "rt".repeat(2000),
    idToken: "idt".repeat(1000)
  });
  const written = await buildSessionSetCookies(large, config);
  assert.ok(written.length > 1, "expected chunked cookies");
  const names = written.map((c) => c.split("=")[0] ?? "");
  assert.ok(names.some((n) => n.endsWith("__meta")), "expected explicit meta cookie");
  const header = written.map((c) => c.split(";")[0]).join("; ");
  const reread = await readSession(requestWithCookies("https://app.mystcrag.com/", header), config);
  assert.ok(reread);
  assert.equal(reread.accessToken, large.accessToken);
});

test("missing chunk after multi-chunk write is rejected", async () => {
  const config = cfg();
  const large = session({
    accessToken: "at".repeat(2000),
    refreshToken: "rt".repeat(2000)
  });
  const written = await buildSessionSetCookies(large, config);
  const kept = written.filter((c) => !c.startsWith("__Host-mystcrag_session__1=") && !c.startsWith("mystcrag_session__1="));
  const header = kept.map((c) => c.split(";")[0]).join("; ");
  assert.equal(await readSession(requestWithCookies("https://app.mystcrag.com/", header), config), null);
});

test("shrinking from many chunks to few clears leftover suffix cookies", async () => {
  const config = cfg();
  const large = session({
    accessToken: "at".repeat(4000),
    refreshToken: "rt".repeat(4000)
  });
  const many = await buildSessionSetCookies(large, config);
  const manyHeader = many.map((c) => c.split(";")[0]).join("; ");
  const manyRequest = requestWithCookies("https://app.mystcrag.com/", manyHeader);

  const small = session();
  const rewritten = await buildSessionSetCookies(small, config, { request: manyRequest });
  // leftover chunk indexes that are no longer used must be cleared (Max-Age=0)
  const clears = rewritten.filter((c) => /Max-Age=0/.test(c));
  assert.ok(clears.length > 0, "expected stale chunk clears when shrinking");
  // Read the new compact form alone must succeed
  const newHeader = rewritten.filter((c) => !/Max-Age=0/.test(c)).map((c) => c.split(";")[0]).join("; ");
  const reread = await readSession(requestWithCookies("https://app.mystcrag.com/", newHeader), config);
  assert.ok(reread);
  assert.equal(reread.accessToken, "at");
});

test("forged meta count larger than present chunks is rejected", async () => {
  const config = cfg();
  const large = session({
    accessToken: "at".repeat(2000),
    refreshToken: "rt".repeat(2000)
  });
  const written = await buildSessionSetCookies(large, config);
  const forged = written.map((c) =>
    c.includes("__meta=") ? c.replace(/__meta=\d+/, "__meta=99") : c
  );
  const header = forged.map((c) => c.split(";")[0]).join("; ");
  assert.equal(await readSession(requestWithCookies("https://app.mystcrag.com/", header), config), null);
});

// --- 3) client_secret_post ---

test("token exchange uses client_secret_post body and no Basic authorization header", async () => {
  const config = cfg();
  const originalFetch = globalThis.fetch;
  let sawAuthHeader: string | null | undefined;
  let bodyText = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("openid-configuration")) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: "https://pool.authing.cn/oidc/auth",
        token_endpoint: "https://pool.authing.cn/oidc/token",
        jwks_uri: "https://pool.authing.cn/oidc/keys",
        end_session_endpoint: "https://pool.authing.cn/oidc/session/end"
      });
    }
    if (url.includes("/token")) {
      sawAuthHeader = new Headers(init?.headers).get("authorization");
      bodyText = String(init?.body ?? "");
      return Response.json({ access_token: "x", expires_in: 900 });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;

  try {
    const { exchangeAuthorizationCode } = await import("./oidc-client");
    const document = {
      issuer: ISSUER,
      authorization_endpoint: "https://pool.authing.cn/oidc/auth",
      token_endpoint: "https://pool.authing.cn/oidc/token",
      jwks_uri: "https://pool.authing.cn/oidc/keys"
    };
    await exchangeAuthorizationCode(document, config, {
      code: "code",
      codeVerifier: "verifier"
    });
    assert.equal(sawAuthHeader, null);
    assert.match(bodyText, /client_id=client-id/);
    assert.match(bodyText, /client_secret=client-secret/);
    assert.match(bodyText, /grant_type=authorization_code/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- 4) bounded outbound calls ---

test("token endpoint hang aborts within the total timeout as ProviderUnavailable", async () => {
  const config = cfg();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      }
    });
  }) as typeof fetch;

  try {
    const { exchangeAuthorizationCode } = await import("./oidc-client");
    const document = {
      issuer: ISSUER,
      authorization_endpoint: "https://pool.authing.cn/oidc/auth",
      token_endpoint: "https://pool.authing.cn/oidc/token",
      jwks_uri: "https://pool.authing.cn/oidc/keys"
    };
    await assert.rejects(
      () => exchangeAuthorizationCode(document, config, { code: "c", codeVerifier: "v" }),
      ProviderUnavailableError
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- 5) callback always clears transaction ---

test("callback provider outage still clears the transaction cookie", async () => {
  const config = cfg();
  const transaction = {
    state: "state-out",
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
    const request = makeRequest(
      "https://app.mystcrag.com/auth/callback?code=x&state=state-out",
      { cookieHeader: cookie.split(";")[0] }
    );
    const outcome = await completeOidcCallback(request, config);
    assert.equal(outcome.kind, "internal");
    assert.ok("setCookies" in outcome);
    const setCookies = (outcome as { setCookies: string[] }).setCookies;
    assert.ok(setCookies.some((c) => c.startsWith("__txn_state-out=;") && /Max-Age=0/.test(c)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- 6) discovery same-origin ---

test("discovery rejects HTTPS endpoints on a different host than the issuer", async () => {
  const source = new OidcDiscoverySource({
    issuer: ISSUER,
    transport: async (url) => ({
      status: 200,
      url: String(url),
      json: async () => ({
        issuer: ISSUER,
        authorization_endpoint: "https://evil.example.com/oidc/auth",
        token_endpoint: "https://pool.authing.cn/oidc/token",
        jwks_uri: "https://pool.authing.cn/oidc/keys"
      })
    })
  });
  await assert.rejects(() => source.getDocument(), ProviderUnavailableError);
});

// --- refresh preserves latest activity ---

test("access-token refresh writes session with updated lastActivityAt", async () => {
  const config = cfg();
  const now = Math.floor(Date.now() / 1000);
  const payload = session({
    accessToken: "old",
    accessTokenExpiresAt: now + 5,
    lastActivityAt: now - 60
  });
  const cookies = await buildSessionSetCookies(payload, config);
  const header = cookies.map((c) => c.split(";")[0]).join("; ");
  const request = requestWithCookies("https://app.mystcrag.com/api/x", header);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("openid-configuration")) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: "https://pool.authing.cn/oidc/auth",
        token_endpoint: "https://pool.authing.cn/oidc/token",
        jwks_uri: "https://pool.authing.cn/oidc/keys"
      });
    }
    if (url.includes("/token")) {
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      return Response.json({ access_token: "new-at", expires_in: 900, refresh_token: "new-rt" });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;

  try {
    const result = await getAccessToken(request, config);
    assert.equal(result.token, "new-at");
    assert.ok(result.setCookies.length > 0);
    const newHeader = result.setCookies.map((c) => c.split(";")[0]).join("; ");
    const reread = await readSession(requestWithCookies("https://app.mystcrag.com/", newHeader), config);
    assert.ok(reread);
    assert.equal(reread.accessToken, "new-at");
    assert.ok(reread.lastActivityAt! >= now);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("callback rejects replay when provider returns invalid_grant on second code exchange", async () => {
  const config = cfg();
  const transaction = {
    state: "state-replay",
    nonce: "nonce-ok",
    codeVerifier: "verifier-ok",
    returnTo: "/",
    createdAt: Math.floor(Date.now() / 1000)
  };
  const cookie = await buildTransactionSetCookie(transaction, config);
  const originalFetch = globalThis.fetch;
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", use: "sig", alg: "RS256" };
  let tokenCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("openid-configuration")) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: "https://pool.authing.cn/oidc/auth",
        token_endpoint: "https://pool.authing.cn/oidc/token",
        jwks_uri: "https://pool.authing.cn/oidc/keys"
      });
    }
    if (url.includes("/token")) {
      tokenCalls += 1;
      if (tokenCalls > 1) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT({ nonce: "nonce-ok" })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(ISSUER)
        .setAudience("client-id")
        .setSubject("authing|replay")
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(privateKey);
      return Response.json({ access_token: "at", id_token: idToken, expires_in: 900 });
    }
    if (url.includes("/keys")) {
      return Response.json({ keys: [jwk] });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;

  try {
    const header = cookie.split(";")[0]!;
    const first = await completeOidcCallback(
      makeRequest("https://app.mystcrag.com/auth/callback?code=c&state=state-replay", {
        cookieHeader: header
      }),
      config
    );
    assert.equal(first.kind, "success");
    assert.ok(first.setCookies.some((c) => c.startsWith("__txn_state-replay=;")));
    const second = await completeOidcCallback(
      makeRequest("https://app.mystcrag.com/auth/callback?code=c&state=state-replay", {
        cookieHeader: header
      }),
      config
    );
    assert.equal(second.kind, "unauthorized");
    assert.ok(second.setCookies.some((c) => c.startsWith("__txn_state-replay=;")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discovery source process cache can be isolated for outage tests", async () => {
  const { __resetOidcDiscoveryCacheForTests, OidcDiscoverySource } = await import("./oidc-discovery");
  __resetOidcDiscoveryCacheForTests();
  const source = new OidcDiscoverySource({
    issuer: ISSUER,
    transport: async () => {
      throw new Error("outage");
    }
  });
  await assert.rejects(() => source.getDocument(), ProviderUnavailableError);
});


test("frontend accepts a custom Authing host only when allowlisted", async () => {
  const { OidcDiscoverySource } = await import("./oidc-discovery");
  assert.throws(
    () => new OidcDiscoverySource({ issuer: "https://sso.example.com/oidc" }),
    ProviderUnavailableError
  );
  const allowed = new OidcDiscoverySource({
    issuer: "https://sso.example.com/oidc",
    hostAllowlist: ["sso.example.com"],
    transport: async (url) => ({
      status: 200,
      url: String(url),
      json: async () => ({
        issuer: "https://sso.example.com/oidc",
        authorization_endpoint: "https://sso.example.com/oidc/auth",
        token_endpoint: "https://sso.example.com/oidc/token",
        jwks_uri: "https://sso.example.com/oidc/keys"
      })
    })
  });
  const doc = await allowed.getDocument();
  assert.equal(doc.issuer, "https://sso.example.com/oidc");
});

test("malformed allowlist entries are rejected by AuthConfig", async () => {
  const { resolveAuthConfig } = await import("../model/auth-config");
  const base = {
    NODE_ENV: "production",
    MYSTCRAG_APP_ORIGIN: "https://app.example.com",
    MYSTCRAG_AUTH_PROVIDER: "authing",
    MYSTCRAG_AUTH_ISSUER: "https://sso.example.com/oidc",
    MYSTCRAG_AUTH_AUDIENCE: "https://api.example.com",
    MYSTCRAG_AUTH_CLIENT_ID: "cid",
    MYSTCRAG_AUTH_CLIENT_SECRET: "secret",
    MYSTCRAG_AUTH_CALLBACK_URL: "https://app.example.com/auth/callback",
    MYSTCRAG_AUTH_LOGOUT_URL: "https://app.example.com",
    MYSTCRAG_AUTH_SESSION_SECRET: "a".repeat(64),
    MYSTCRAG_BACKEND_ORIGIN: "https://api.internal.example.com",
    MYSTCRAG_AUTH_ISSUER_HOST_ALLOWLIST: "sso.example.com"
  };
  const ok = resolveAuthConfig(base);
  assert.deepEqual(ok.authIssuerHostAllowlist, ["sso.example.com"]);
  assert.throws(() =>
    resolveAuthConfig({
      ...base,
      MYSTCRAG_AUTH_ISSUER_HOST_ALLOWLIST: "https://sso.example.com"
    })
  );
  assert.throws(() =>
    resolveAuthConfig({
      ...base,
      MYSTCRAG_AUTH_ISSUER_HOST_ALLOWLIST: "*.example.com"
    })
  );
});
