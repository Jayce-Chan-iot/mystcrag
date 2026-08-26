/**
 * SDK cookie matching tests aligned with Auth0 Next.js SDK 4.27.0 real behavior.
 *
 * Coverage:
 * - Session main cookie, current `{name}__{index}` chunks and legacy `{name}.{index}`
 *   chunks are matched from the cookies actually present on the request.
 * - `__txn_*` transaction cookies are only collected when requested.
 * - No fixed "up to ten guessed cookies" replacement: absent names are never emitted,
 *   unrelated cookies are never touched.
 * - Deletion attributes mirror creation attributes; Secure follows the verified app
 *   origin, not NODE_ENV.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { collectSdkCookieNames, buildClearCookieHeaders, hasSessionCookie } from "./session-cookies";
import { makeConfig, makeDevConfig, makeRequest } from "./auth-test-fixtures";

const HTTPS_CONFIG = makeConfig();
const DEV_CONFIG = makeDevConfig();

test("collects main cookie, current chunks, legacy chunks and transactions", () => {
  const request = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: [
      "__Host-mystcrag_session=main",
      "__Host-mystcrag_session__0=chunk0",
      "__Host-mystcrag_session__1=chunk1",
      "__Host-mystcrag_session.2=legacy",
      "__txn_state9=txn",
      "unrelated=1",
      "other__0=2"
    ].join("; ")
  });

  const names = collectSdkCookieNames(request, HTTPS_CONFIG, true);
  assert.ok(names.includes("__Host-mystcrag_session"));
  assert.ok(names.includes("__Host-mystcrag_session__0"));
  assert.ok(names.includes("__Host-mystcrag_session__1"));
  assert.ok(names.includes("__Host-mystcrag_session.2"));
  assert.ok(names.includes("__txn_state9"));
  assert.ok(!names.includes("unrelated"));
  assert.ok(!names.includes("other__0"));
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

test("hasSessionCookie detects main cookie and chunks only", () => {
  const withMain = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "__Host-mystcrag_session=main"
  });
  const withChunk = makeRequest("https://app.mystcrag.com/", {
    cookieHeader: "__Host-mystcrag_session__3=chunk"
  });
  const anonymous = makeRequest("https://app.mystcrag.com/", { cookieHeader: "unrelated=1" });

  assert.equal(hasSessionCookie(withMain, HTTPS_CONFIG), true);
  assert.equal(hasSessionCookie(withChunk, HTTPS_CONFIG), true);
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
