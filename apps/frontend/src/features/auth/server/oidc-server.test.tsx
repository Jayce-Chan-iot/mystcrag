import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import type { AuthConfig } from "../model/auth-config";
import {
  generateRequestId,
  getSessionCookieName,
  isSecureCookie,
  parseSessionCookieMaxAge,
  projectSessionState
} from "./oidc-server";
import {
  buildSessionSetCookies,
  hasSessionCookie,
  readSession,
  rollSessionIfNeeded,
  type OidcSessionPayload
} from "./oidc-session-store";
import { decryptJsonPayload } from "./oidc-session-crypto";

const SESSION_SECRET = "a".repeat(64);

function config(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    appOrigin: "https://app.example.com",
    environment: "production",
    authProvider: "authing",
    authIssuer: "https://pool.authing.cn/oidc/",
    authAudience: "https://api.example.com",
    authClientId: "client-id",
    authClientSecret: "client-secret",
    authCallbackUrl: "https://app.example.com/auth/callback",
    authLogoutUrl: "https://app.example.com",
    authSessionSecret: SESSION_SECRET,
    backendOrigin: "https://api.internal.example.com",
    enableSignedTestAuth: false,
    desktopAutoAuth: false,
    desktopAccessToken: "",
    ...overrides
  };
}

function sessionPayload(overrides: Partial<OidcSessionPayload> = {}): OidcSessionPayload {
  return {
    user: { name: "测试用户", email: "user@example.com", email_verified: false },
    accessToken: "server-only-access-token",
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 900,
    refreshToken: "server-only-refresh-token",
    createdAt: Math.floor(Date.now() / 1000),
    lastActivityAt: Math.floor(Date.now() / 1000),
    ...overrides
  };
}

test("production session cookie uses the __Host- prefix and Secure flag", () => {
  const cfg = config();
  assert.equal(getSessionCookieName(cfg), "__Host-mystcrag_session");
  assert.equal(isSecureCookie(cfg), true);
});

test("development session cookie name does not use __Host-", () => {
  const cfg = config({
    environment: "development",
    appOrigin: "http://localhost:3000"
  });
  assert.equal(getSessionCookieName(cfg), "mystcrag_session");
  assert.equal(isSecureCookie(cfg), false);
});

test("session cookies are HttpOnly host-only Lax Path=/ ciphertext", async () => {
  const cfg = config();
  const cookies = await buildSessionSetCookies(sessionPayload(), cfg);
  assert.equal(cookies.length, 1);
  const cookie = cookies[0]!;
  assert.match(cookie, /^__Host-mystcrag_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.doesNotMatch(cookie, /server-only-access-token/);
  assert.doesNotMatch(cookie, /server-only-refresh-token/);
});

test("encrypted session round-trips and never stores plaintext tokens in the cookie", async () => {
  const cfg = config();
  const payload = sessionPayload();
  const cookies = await buildSessionSetCookies(payload, cfg);
  const compact = cookies[0]!.slice("__Host-mystcrag_session=".length).split(";")[0]!;
  const decoded = await decryptJsonPayload<OidcSessionPayload>(compact, SESSION_SECRET, "session");
  assert.ok(decoded);
  assert.equal(decoded.accessToken, payload.accessToken);
  const request = new NextRequest("https://app.example.com/", {
    headers: { cookie: `__Host-mystcrag_session=${compact}` }
  });
  assert.equal(hasSessionCookie(request, cfg), true);
  const session = await readSession(request, cfg);
  assert.ok(session);
  assert.equal(session.user.name, "测试用户");
});

test("projectSessionState never exposes tokens or issuer/subject", () => {
  const state = projectSessionState(sessionPayload());
  assert.equal(state.authenticated, true);
  assert.equal(state.user?.displayName, "测试用户");
  assert.equal(state.user?.emailVerified, false);
  assert.ok(state.idleExpiresAt);
  assert.ok(state.absoluteExpiresAt);
  const json = JSON.stringify(state);
  assert.doesNotMatch(json, /access|refresh|token|issuer|subject|pool\.authing/i);
});

test("rolling reissues cookies without extending absolute expiry", async () => {
  const cfg = config();
  const createdAt = Math.floor(Date.now() / 1000) - 3600;
  const payload = sessionPayload({ createdAt });
  const cookies = await rollSessionIfNeeded(new NextRequest("https://app.example.com/"), payload, cfg);
  assert.ok(cookies.length > 0);
  const maxAge = parseSessionCookieMaxAge(cookies, getSessionCookieName(cfg));
  assert.ok(typeof maxAge === "number");
  assert.ok(maxAge! <= 28800);
  assert.ok(maxAge! <= createdAt + 604800 - Math.floor(Date.now() / 1000));
});

test("generateRequestId returns a unique opaque id", () => {
  const a = generateRequestId();
  const b = generateRequestId();
  assert.notEqual(a, b);
  assert.ok(a.length > 0);
});
