/**
 * Server-only desktop identity runtime adapter tests.
 *
 * Coverage:
 * - mode detection (oidc vs desktop)
 * - safe local session projection (no token/issuer/subject/audience/id)
 * - desktop login sanitizes returnTo before a same-origin 303 and never creates a cookie
 * - desktop BFF access token and rolling shims never invoke the OIDC primitives
 * - token never reaches a projection, redirect Location, or logged event
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { NextResponse } from "next/server";

import {
  detectAuthMode,
  projectDesktopSession,
  buildDesktopSessionResponse,
  getDesktopBearerToken,
  handleDesktopLoginRequest,
  handleDesktopLogoutRequest,
  makeAccessTokenResolver,
  makeTouchSession,
  DESKTOP_DISPLAY_NAME
} from "./runtime-auth";
import {
  makeConfig,
  makeDevConfig,
  makeAuthEventCapture,
  makeRequest,
  noopAuthEventLogger
} from "./auth-test-fixtures";

function desktopConfig() {
  return makeDevConfig({
    authProvider: "signed-test",
    enableSignedTestAuth: true,
    desktopAutoAuth: true,
    desktopAccessToken: "desktop-secret-token"
  });
}

test("detectAuthMode is derived from the explicit desktop flag", () => {
  assert.equal(detectAuthMode(desktopConfig()), "desktop");
  assert.equal(detectAuthMode(makeConfig()), "oidc");
});

test("projectDesktopSession returns only the safe local projection", () => {
  const projection = projectDesktopSession();
  assert.deepEqual(projection, {
    authenticated: true,
    user: { displayName: DESKTOP_DISPLAY_NAME },
    logoutAvailable: false
  });
  assert.equal(projection.user.displayName, "本地演示用户");
  assert.equal(projection.logoutAvailable, false);
  const serialized = JSON.stringify(projection);
  assert.doesNotMatch(serialized, /token|issuer|subject|audience|user_id|desktop-secret/);
});

test("buildDesktopSessionResponse is a 200 no-store safe projection", async () => {
  const response = buildDesktopSessionResponse();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), projectDesktopSession());
});

test("getDesktopBearerToken exposes only the server-only token", () => {
  assert.equal(getDesktopBearerToken(desktopConfig()), "desktop-secret-token");
});

test("desktop login sanitizes a valid relative returnTo to a same-origin 303 without cookies", () => {
  const { logger, records } = makeAuthEventCapture();
  const request = makeRequest("http://localhost:3000/auth/login?returnTo=%2Fdiy%2Fx%3Fa%3D1%23h");
  const response = handleDesktopLoginRequest(request, desktopConfig(), {
    generateRequestId: () => "req-desktop-login",
    logAuthEvent: logger
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "http://localhost:3000/diy/x?a=1#h");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(records, []);
  assert.doesNotMatch(response.headers.get("location") ?? "", /desktop-secret-token/);
});

test("desktop login rejects a dangerous returnTo to same-origin root and logs rejection only", () => {
  const { logger, records } = makeAuthEventCapture();
  const request = makeRequest("http://localhost:3000/auth/login?returnTo=https%3A%2F%2Fevil.example%2Fsteal");
  const response = handleDesktopLoginRequest(request, desktopConfig(), {
    generateRequestId: () => "req-desktop-open-redirect",
    logAuthEvent: logger
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "http://localhost:3000/");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.event, "auth.open_redirect_rejected");
  assert.equal(records[0]?.requestId, "req-desktop-open-redirect");
  const serializedRecords = JSON.stringify(records);
  assert.doesNotMatch(serializedRecords, /evil\.example|desktop-secret-token/);
});

test("desktop access token resolver returns the token without calling the OIDC resolver", async () => {
  let oidcCalls = 0;
  const resolver = makeAccessTokenResolver(
    () => desktopConfig(),
    () => {
      oidcCalls += 1;
      return Promise.resolve({ token: "oidc-token" });
    }
  );
  const sink = new Response() as NextResponse;
  const result = await resolver(makeRequest("http://localhost:3000/api/design"), sink);
  assert.deepEqual(result, { token: "desktop-secret-token" });
  assert.equal(oidcCalls, 0);
});

test("oidc access token resolver delegates unchanged", async () => {
  let oidcCalls = 0;
  const resolver = makeAccessTokenResolver(
    () => makeConfig(),
    () => {
      oidcCalls += 1;
      return Promise.resolve({ token: "oidc-token" });
    }
  );
  const sink = new Response() as NextResponse;
  const result = await resolver(makeRequest("https://app.mystcrag.com/api/design"), sink);
  assert.deepEqual(result, { token: "oidc-token" });
  assert.equal(oidcCalls, 1);
});

test("desktop touchSession returns no rolling cookies without calling OIDC", async () => {
  let oidcCalls = 0;
  const touch = makeTouchSession(
    () => desktopConfig(),
    () => {
      oidcCalls += 1;
      return Promise.resolve(["mystcrag_session=rolled; Path=/"]);
    }
  );
  assert.deepEqual(await touch(makeRequest("http://localhost:3000/")), []);
  assert.equal(oidcCalls, 0);
});

test("desktop logout requires exact Origin and rejects a mismatched Origin with 403", () => {
  const { logger, records } = makeAuthEventCapture();
  const request = makeRequest("http://localhost:3000/auth/logout", {
    method: "POST",
    headers: { origin: "http://evil.example.com" }
  });
  const response = handleDesktopLogoutRequest(request, desktopConfig(), {
    generateRequestId: () => "req-desktop-logout",
    logAuthEvent: logger
  });

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
  assert.deepEqual(records, [
    { event: "auth.origin_rejected", category: "origin_rejected", requestId: "req-desktop-logout", outcome: "failure" }
  ]);
});

test("desktop logout is a controlled no-store same-origin result that never builds an upstream URL", async () => {
  const request = makeRequest("http://localhost:3000/auth/logout", {
    method: "POST",
    headers: { origin: "http://localhost:3000" }
  });
  const response = handleDesktopLogoutRequest(request, desktopConfig(), {
    generateRequestId: () => "req-desktop-logout",
    logAuthEvent: noopAuthEventLogger
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("set-cookie"), null);
  // No upstream Authing logout URL is constructed or pointed at.
  assert.equal(response.headers.get("location"), null);
  const body = await response.json();
  assert.equal(body.status, "local-demo");
  assert.equal(body.requestId, "req-desktop-logout");
  assert.doesNotMatch(body.message, /撤销|revoke|已退出/);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /desktop-secret-token|client_id|oidc/);
});

test("oidc touchSession delegates unchanged", async () => {
  let oidcCalls = 0;
  const touch = makeTouchSession(
    () => makeConfig(),
    () => {
      oidcCalls += 1;
      return Promise.resolve(["mystcrag_session=rolled; Path=/"]);
    }
  );
  const cookies = await touch(makeRequest("https://app.mystcrag.com/"));
  assert.deepEqual(cookies, ["mystcrag_session=rolled; Path=/"]);
  assert.equal(oidcCalls, 1);
});