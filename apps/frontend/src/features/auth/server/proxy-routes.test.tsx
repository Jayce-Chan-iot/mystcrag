/**
 * Proxy routing policy tests (proxy.ts decision logic).
 *
 * Coverage:
 * - /auth/** allowlist: only login/callback/logout/session pass through.
 * - Unknown /auth/** paths fail closed with 404 (connect, MFA, passwordless, passkey,
 *   profile, access-token, SDK dummy routes, nested paths).
 * - Hard-coded SDK `/me/` and `/my-org/` browser endpoints are blocked.
 * - API routes are handled by the custom BFF handler, never SDK middleware.
 * - Page navigations keep SDK middleware rolling-session support.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { decideProxyRoute } from "./proxy-routes";

test("allowlisted auth endpoints pass through to their route handlers", () => {
  for (const path of ["/auth/login", "/auth/callback", "/auth/logout", "/auth/session"]) {
    assert.deepEqual(decideProxyRoute(path), { kind: "passthrough" }, path);
  }
});

test("unknown /auth/** paths fail closed with 404", () => {
  for (const path of [
    "/auth",
    "/auth/",
    "/auth/connect",
    "/auth/connect/account",
    "/auth/profile",
    "/auth/access-token",
    "/auth/me",
    "/auth/my-org",
    "/auth/mfa/authenticators",
    "/auth/mfa/challenge",
    "/auth/mfa/associate",
    "/auth/mfa/verify",
    "/auth/passwordless/start",
    "/auth/passwordless/verify",
    "/auth/passkey/register",
    "/auth/passkey/challenge",
    "/auth/back-channel-logout",
    "/auth/__sdk_login",
    "/auth/__sdk_logout",
    "/auth/__sdk_profile",
    "/auth/__sdk_access_token",
    "/auth/__sdk_bcl",
    "/auth/__sdk_connect",
    "/auth/logout/extra",
    "/auth/session/revoke"
  ]) {
    assert.deepEqual(decideProxyRoute(path), { kind: "not-found" }, path);
  }
});

test("SDK hard-coded /me and /my-org endpoints are blocked", () => {
  for (const path of ["/me", "/me/callback", "/my-org", "/my-org/switch"]) {
    assert.deepEqual(decideProxyRoute(path), { kind: "not-found" }, path);
  }
});

test("API routes pass through to the custom BFF handler, never SDK middleware", () => {
  assert.deepEqual(decideProxyRoute("/api"), { kind: "passthrough" });
  assert.deepEqual(decideProxyRoute("/api/designs"), { kind: "passthrough" });
  assert.deepEqual(decideProxyRoute("/api/designs/123"), { kind: "passthrough" });
});

test("page navigations keep SDK rolling-session middleware", () => {
  for (const path of ["/", "/design", "/gallery", "/about"]) {
    assert.deepEqual(decideProxyRoute(path), { kind: "sdk-rolling" }, path);
  }
});

test("paths that merely start with an allowlisted segment are not allowlisted", () => {
  assert.deepEqual(decideProxyRoute("/auth/login/step2"), { kind: "not-found" });
  assert.deepEqual(decideProxyRoute("/authx"), { kind: "sdk-rolling" });
});
