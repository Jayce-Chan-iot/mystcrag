/**
 * SDK cookie matching tests aligned with Auth0 Next.js SDK 4.27.0 real behavior.
 *
 * Coverage:
 * - Session main cookie, current `{name}__{index}` chunks and SDK legacy cookies
 *   (`appSession` + `appSession.N` — NOT `{currentName}.N`) are matched from the cookies
 *   actually present on the request.
 * - `__txn_*` transaction cookies are only collected when requested.
 * - No fixed "up to ten guessed cookies" replacement: absent names are never emitted,
 *   unrelated cookies are never touched.
 * - Deletion attributes mirror creation attributes; Secure follows the verified app
 *   origin, not NODE_ENV.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  collectSdkCookieNames,
  buildClearCookieHeaders,
  buildClearTransactionCookieHeaders,
  hasSessionCookie
} from "./session-cookies";
import { makeConfig, makeDevConfig, makeRequest } from "./auth-test-fixtures";

const HTTPS_CONFIG = makeConfig();
const DEV_CONFIG = makeDevConfig();

test("collects main cookie, current chunks, SDK legacy cookies and transactions", () => {
  const request = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: [
      "__Host-mystcrag_session=main",
      "__Host-mystcrag_session__0=chunk0",
      "__Host-mystcrag_session__1=chunk1",
      "appSession=legacy-main",
      "appSession.0=legacy-chunk0",
      "appSession.1=legacy-chunk1",
      "__txn_state9=txn",
      "unrelated=1",
      "other__0=2"
    ].join("; ")
  });

  const names = collectSdkCookieNames(request, HTTPS_CONFIG, true);
  assert.ok(names.includes("__Host-mystcrag_session"));
  assert.ok(names.includes("__Host-mystcrag_session__0"));
  assert.ok(names.includes("__Host-mystcrag_session__1"));
  assert.ok(names.includes("appSession"));
  assert.ok(names.includes("appSession.0"));
  assert.ok(names.includes("appSession.1"));
  assert.ok(names.includes("__txn_state9"));
  assert.ok(!names.includes("unrelated"));
  assert.ok(!names.includes("other__0"));
});

test("legacy chunk format is appSession.N, not {currentName}.N", () => {
  // SDK 4.27.0 only reads legacy cookies under the fixed LEGACY_COOKIE_NAME `appSession`
  // with `.N` chunks. `{currentSessionName}.N` is not an SDK cookie and must be ignored.
  const request = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "__Host-mystcrag_session=main; __Host-mystcrag_session.2=not-sdk; appSession.3=legacy"
  });
  const names = collectSdkCookieNames(request, HTTPS_CONFIG, false);
  assert.ok(names.includes("appSession.3"));
  assert.ok(!names.includes("__Host-mystcrag_session.2"));
});

test("transaction cookies are excluded when not requested", () => {
  const request = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "__Host-mystcrag_session=main; __txn_state9=txn"
  });
  const names = collectSdkCookieNames(request, HTTPS_CONFIG, false);
  assert.ok(names.includes("__Host-mystcrag_session"));
  assert.ok(!names.includes("__txn_state9"));
});

test("chunk of a different cookie name is not matched", () => {
  const request = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "mystcrag_session__0=wrong-name-chunk"
  });
  const names = collectSdkCookieNames(request, HTTPS_CONFIG, true);
  assert.deepEqual(names, ["__Host-mystcrag_session"]);
});

test("hasSessionCookie detects main cookie, chunks and legacy cookies", () => {
  const withMain = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "__Host-mystcrag_session=main"
  });
  const withChunk = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "__Host-mystcrag_session__3=chunk"
  });
  const withLegacy = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "appSession=legacy"
  });
  const withLegacyChunk = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "appSession.0=legacy-chunk"
  });
  const anonymous = makeRequest("https://app.mystcrag.com/", { cookieHeader: "unrelated=1" });

  assert.equal(hasSessionCookie(withMain, HTTPS_CONFIG), true);
  assert.equal(hasSessionCookie(withChunk, HTTPS_CONFIG), true);
  assert.equal(hasSessionCookie(withLegacy, HTTPS_CONFIG), true);
  assert.equal(hasSessionCookie(withLegacyChunk, HTTPS_CONFIG), true);
  assert.equal(hasSessionCookie(anonymous, HTTPS_CONFIG), false);
});

test("clear headers mirror creation attributes for HTTPS origins", () => {
  const request = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "__Host-mystcrag_session=main; __Host-mystcrag_session__0=chunk; __txn_s=txn"
  });
  const headers = buildClearCookieHeaders(request, HTTPS_CONFIG, true);

  assert.ok(headers.includes("__Host-mystcrag_session=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly; Secure"));
  assert.ok(headers.includes("__Host-mystcrag_session__0=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly; Secure"));
  assert.ok(headers.includes("__txn_s=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly; Secure"));
  // host-only — no Domain attribute.
  assert.ok(headers.every((h) => !h.includes("Domain=")));
});

test("clear headers omit Secure for development loopback HTTP origins", () => {
  const request = makeRequest("http://localhost:3000/", {
    cookieHeader: "mystcrag_session=main; mystcrag_session__0=chunk"
  });
  const headers = buildClearCookieHeaders(request, DEV_CONFIG, true);

  assert.ok(headers.includes("mystcrag_session=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly"));
  assert.ok(headers.includes("mystcrag_session__0=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly"));
  assert.ok(headers.every((h) => !h.includes("Secure")));
});

test("no guessed cookie lists — only cookies present on the request are cleared", () => {
  const request = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "__Host-mystcrag_session=main"
  });
  const headers = buildClearCookieHeaders(request, HTTPS_CONFIG, true);
  assert.equal(headers.length, 1);
  assert.ok(headers[0]?.startsWith("__Host-mystcrag_session=;"));
});

test("development HTTPS origin uses mystcrag_session with the Secure flag", () => {
  // Cookie NAME follows the environment classification (development → no __Host- prefix)
  // while Secure follows the protocol (HTTPS → Secure), independent of each other.
  const devHttpsConfig = makeConfig({
    appOrigin: "https://localhost:3000",
    environment: "development",
    authCallbackUrl: "https://localhost:3000/auth/callback",
    authLogoutUrl: "https://localhost:3000"
  });
  const request = makeRequest("https://localhost:3000/", {
    cookieHeader: "mystcrag_session=main"
  });
  const headers = buildClearCookieHeaders(request, devHttpsConfig, false);
  assert.ok(headers.includes("mystcrag_session=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly; Secure"));
  assert.ok(!headers.some((h) => h.startsWith("__Host-")));
});

test("transaction-only clearing never touches session or unrelated cookies", () => {
  const request = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "__Host-mystcrag_session=main; __txn_state1=txn; unrelated=keep"
  });
  const headers = buildClearTransactionCookieHeaders(request, HTTPS_CONFIG);
  assert.equal(headers.length, 1);
  assert.ok(headers[0]?.startsWith("__txn_state1=; Max-Age=0"));
});
