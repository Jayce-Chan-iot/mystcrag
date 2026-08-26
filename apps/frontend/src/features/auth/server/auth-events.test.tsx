/**
 * Privacy-safe auth event logging tests.
 *
 * Coverage:
 * - Field whitelist: records carry ONLY event/category/requestId/outcome; extra
 *   properties (including planted sensitive values) are stripped before the sink.
 * - Closed literal sets: unknown event names and categories throw.
 * - Wiring proof per contract category:
 *   - auth.sign_in on successful callback;
 *   - auth.callback_failed (authentication) on callback 401;
 *   - auth.dependency_failed (dependency) on callback/session/BFF 500;
 *   - auth.session_invalid (session_expired_or_malformed) on invalid-cookie clearing;
 *   - auth.renewal_rejected (renewal_revoked / revocation_observed) on BFF 401 paths;
 *   - auth.logout on successful POST logout.
 * - Sensitive material (tokens, cookies, provider descriptions, returnTo) never reaches
 *   the sink.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_EVENT_CATEGORIES,
  AUTH_EVENT_NAMES,
  createAuthEventLogger,
  type AuthEventRecord
} from "./auth-events";
import { handleCallback, type CallbackDeps } from "./callback";
import { handleLogoutPost, type LogoutDeps } from "./logout";
import { handleSessionRequest, type SessionDeps } from "./session";
import { handleBffRequest, type BffDeps } from "./bff";
import { CALLBACK_ERROR_HEADER } from "./auth0-server";
import { makeAuthEventCapture, makeConfig, makeRequest } from "./auth-test-fixtures";

const SENSITIVE_PROBES = [
  "eyJhbGciOi.token-payload", // token-shaped material
  "refresh-token-value",
  "authorization_code_value",
  "__Host-mystcrag_session=cipher", // cookie material
  "Cookie: session",
  "user said no", // provider error description
  "https://evil.example/phish", // raw returnTo
  "subject-claim",
  "issuer-raw-value"
];

// --- Module contract ---

test("records contain only whitelisted fields", () => {
  const captured: AuthEventRecord[] = [];
  const log = createAuthEventLogger((record) => captured.push(record));
  log("auth.sign_in", { category: "authentication", requestId: "req-1", outcome: "success" });

  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0], {
    event: "auth.sign_in",
    category: "authentication",
    requestId: "req-1",
    outcome: "success"
  });
});

test("extra properties on the input are stripped before the sink", () => {
  const captured: AuthEventRecord[] = [];
  const log = createAuthEventLogger((record) => captured.push(record));

  // Simulate a misuse: a caller object carrying sensitive fields. The whitelist copy
  // must drop everything that is not event/category/requestId/outcome.
  const poisoned = {
    category: "authentication",
    requestId: "req-1",
    outcome: "success",
    token: "eyJhbGciOi.token-payload",
    cookie: "__Host-mystcrag_session=cipher",
    returnTo: "https://evil.example/phish",
    providerDescription: "user said no",
    email: "someone@example.com"
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log("auth.sign_in", poisoned as any);

  const record = captured[0];
  if (!record) throw new Error("expected a captured record");
  assert.deepEqual(Object.keys(record).sort(), ["category", "event", "outcome", "requestId"]);
  const serialized = JSON.stringify(record);
  for (const probe of SENSITIVE_PROBES) {
    assert.ok(!serialized.includes(probe), `record must not contain: ${probe}`);
  }
  assert.ok(!serialized.includes("someone@example.com"));
});

test("unknown event names and categories throw instead of logging", () => {
  const log = createAuthEventLogger(() => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.throws(() => log("auth.exploit" as any, { category: "authentication" }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.throws(() => log("auth.sign_in", { category: "exfiltration" as any }));
});

test("event names and categories are closed literal sets", () => {
  assert.deepEqual(
    [...AUTH_EVENT_NAMES].sort(),
    [
      "auth.callback_failed",
      "auth.dependency_failed",
      "auth.logout",
      "auth.open_redirect_rejected",
      "auth.renewal_rejected",
      "auth.session_invalid",
      "auth.sign_in"
    ]
  );
  assert.deepEqual(
    [...AUTH_EVENT_CATEGORIES].sort(),
    [
      "authentication",
      "dependency",
      "open_redirect",
      "renewal_revoked",
      "revocation_observed",
      "session_expired_or_malformed"
    ]
  );
});

test("empty requestId is omitted from the record", () => {
  const captured: AuthEventRecord[] = [];
  const log = createAuthEventLogger((record) => captured.push(record));
  log("auth.open_redirect_rejected", { category: "open_redirect", requestId: "", outcome: "failure" });
  assert.deepEqual(captured[0], {
    event: "auth.open_redirect_rejected",
    category: "open_redirect",
    outcome: "failure"
  });
});

// --- Wiring proof ---

test("callback success logs auth.sign_in with requestId", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const deps: CallbackDeps = {
    middleware: async () =>
      new Response(null, { status: 303, headers: { location: "https://app.mystcrag.com/" } }),
    getConfig: () => makeConfig(),
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = await handleCallback(request, deps);
  assert.equal(response.status, 303);
  assert.deepEqual(capture.records, [
    { event: "auth.sign_in", category: "authentication", requestId: "req-log", outcome: "success" }
  ]);
});

test("callback 401 logs auth.callback_failed (authentication) with requestId", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const deps: CallbackDeps = {
    middleware: async () =>
      new Response(null, { status: 500, headers: { [CALLBACK_ERROR_HEADER]: "invalid_state|" } }),
    getConfig: () => makeConfig(),
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = await handleCallback(request, deps);
  assert.equal(response.status, 401);
  assert.deepEqual(capture.records, [
    { event: "auth.callback_failed", category: "authentication", requestId: "req-log", outcome: "failure" }
  ]);
});

test("callback 500 logs auth.dependency_failed (dependency) with requestId", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/callback?code=abc&state=xyz");
  const deps: CallbackDeps = {
    middleware: async () =>
      new Response(null, { status: 500, headers: { [CALLBACK_ERROR_HEADER]: "discovery_error|" } }),
    getConfig: () => makeConfig(),
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = await handleCallback(request, deps);
  assert.equal(response.status, 500);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-log", outcome: "failure" }
  ]);
});

test("successful POST logout logs auth.logout", async () => {
  const capture = makeAuthEventCapture();
  const config = makeConfig();
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: config.appOrigin }
  });
  const deps: LogoutDeps = {
    getConfig: () => config,
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = handleLogoutPost(request, deps);
  assert.equal(response.status, 303);
  assert.deepEqual(capture.records, [
    { event: "auth.logout", category: "authentication", requestId: "req-log", outcome: "success" }
  ]);
});

test("session dependency failure logs auth.dependency_failed", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/session");
  const deps: SessionDeps = {
    getConfig: () => makeConfig(),
    getSession: async () => {
      throw new Error("sdk outage");
    },
    touchSession: async () => [],
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = await handleSessionRequest(request, deps);
  assert.equal(response.status, 500);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-log", outcome: "failure" }
  ]);
});

test("invalid session cookie clearing logs auth.session_invalid", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=undecryptable"
  });
  const deps: SessionDeps = {
    getConfig: () => makeConfig(),
    getSession: async () => null,
    touchSession: async () => [],
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = await handleSessionRequest(request, deps);
  assert.equal(response.status, 200);
  assert.deepEqual(capture.records, [
    {
      event: "auth.session_invalid",
      category: "session_expired_or_malformed",
      requestId: "req-log",
      outcome: "failure"
    }
  ]);
});

function makeBffDeps(options: {
  token?: () => Promise<{ token: string }>;
  backend?: () => Response;
  logAuthEvent: ReturnType<typeof makeAuthEventCapture>["logger"];
}): BffDeps {
  return {
    getConfig: () => makeConfig(),
    getAccessToken: async () => (options.token ? options.token() : { token: "token-abc" }),
    touchSession: async () => [],
    fetch: async () =>
      options.backend ? options.backend() : new Response("{}", { status: 200 }),
    generateRequestId: () => "req-log",
    logAuthEvent: options.logAuthEvent
  };
}

test("BFF refresh rejection logs auth.renewal_rejected (renewal_revoked)", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const deps = makeBffDeps({
    token: async () => {
      throw { code: "session_expired" };
    },
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  assert.deepEqual(capture.records, [
    { event: "auth.renewal_rejected", category: "renewal_revoked", requestId: "req-log", outcome: "failure" }
  ]);
});

test("BFF token infrastructure failure logs auth.dependency_failed", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const deps = makeBffDeps({
    token: async () => {
      throw { code: "discovery_error" };
    },
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 500);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-log", outcome: "failure" }
  ]);
});

test("Backend 401 logs auth.renewal_rejected (revocation_observed)", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const deps = makeBffDeps({
    backend: () => new Response("{}", { status: 401 }),
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  assert.deepEqual(capture.records, [
    { event: "auth.renewal_rejected", category: "revocation_observed", requestId: "req-log", outcome: "failure" }
  ]);
});
