/**
 * Privacy-safe auth event logging tests.
 *
 * Coverage:
 * - Field whitelist: records carry ONLY event/category/requestId/outcome; extra
 *   properties (including planted sensitive values) are stripped before the sink.
 * - Closed literal sets: unknown event names and categories throw.
 * - Wiring proof per contract category (distinct semantics, never one bucket):
 *   - auth.sign_in on successful callback;
 *   - auth.callback_failed (authentication) on callback 401;
 *   - auth.dependency_failed (dependency) on callback/session/BFF/login/proxy/logout
 *     configuration or SDK failures;
 *   - auth.session_invalid (session_expired_or_malformed) on invalid-cookie clearing,
 *     on session_expired token failures, on missing_refresh_token (session cannot
 *     continue; no provider revoke observed) and on missing_session when a session
 *     main/chunk/legacy cookie is present (stale/corrupted/undecryptable);
 *   - auth.session_missing (session_missing) ONLY on missing_session token failures
 *     when the request carries no known session cookie;
 *   - auth.renewal_rejected (renewal_revoked) ONLY on an explicit provider refresh
 *     grant rejection/revocation (invalid_grant/access_denied);
 *   - auth.verification_failed (verification_failed) on Backend token verification 401;
 *   - auth.origin_rejected (origin_rejected) on BFF mutation and POST logout Origin
 *     rejections;
 *   - auth.open_redirect_rejected (open_redirect) with the login requestId;
 *   - auth.session_rotation (session_rotation) when page/session/BFF rolling actually
 *     produced Set-Cookie;
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
import { handleLoginRequest, type LoginDeps } from "./login";
import { handleProxyPageRolling, type ProxyPageDeps } from "./proxy-page";
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
      "auth.origin_rejected",
      "auth.renewal_rejected",
      "auth.session_invalid",
      "auth.session_missing",
      "auth.session_rotation",
      "auth.sign_in",
      "auth.verification_failed"
    ]
  );
  assert.deepEqual(
    [...AUTH_EVENT_CATEGORIES].sort(),
    [
      "authentication",
      "dependency",
      "open_redirect",
      "origin_rejected",
      "renewal_revoked",
      "session_expired_or_malformed",
      "session_missing",
      "session_rotation",
      "verification_failed"
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
  touch?: () => Promise<string[]>;
  getConfig?: () => ReturnType<typeof makeConfig>;
  rotate?: boolean;
  logAuthEvent: ReturnType<typeof makeAuthEventCapture>["logger"];
}): BffDeps {
  return {
    getConfig: options.getConfig ?? (() => makeConfig()),
    getAccessToken: async (_request, sink) => {
      if (options.rotate !== false) {
        sink.headers.append("Set-Cookie", "rotated=1; Path=/; HttpOnly; Secure");
      }
      return options.token ? options.token() : { token: "token-abc" };
    },
    touchSession: async () => (options.touch ? options.touch() : []),
    fetch: async () =>
      options.backend ? options.backend() : new Response("{}", { status: 200 }),
    generateRequestId: () => "req-log",
    logAuthEvent: options.logAuthEvent
  };
}

test("BFF refresh grant rejection logs auth.renewal_rejected (renewal_revoked)", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const deps = makeBffDeps({
    token: async () => {
      throw { code: "failed_to_refresh_token", cause: { code: "invalid_grant" } };
    },
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  assert.deepEqual(capture.records, [
    { event: "auth.renewal_rejected", category: "renewal_revoked", requestId: "req-log", outcome: "failure" }
  ]);
});

test("BFF missing_session WITHOUT any session cookie logs auth.session_missing", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const deps = makeBffDeps({
    token: async () => {
      throw { code: "missing_session" };
    },
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  assert.deepEqual(capture.records, [
    { event: "auth.session_missing", category: "session_missing", requestId: "req-log", outcome: "failure" }
  ]);
});

test("BFF missing_session WITH the main session cookie logs auth.session_invalid (expired/malformed)", async () => {
  const capture = makeAuthEventCapture();
  // The SDK emits missing_session for stale/corrupted/undecryptable cookies too, so a
  // present main cookie must NOT be logged as "missing".
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    cookieHeader: "__Host-mystcrag_session=stale-or-corrupted-ciphertext"
  });
  const deps = makeBffDeps({
    token: async () => {
      throw { code: "missing_session" };
    },
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  assert.deepEqual(capture.records, [
    {
      event: "auth.session_invalid",
      category: "session_expired_or_malformed",
      requestId: "req-log",
      outcome: "failure"
    }
  ]);
});

test("BFF missing_session WITH only a chunk session cookie logs auth.session_invalid (expired/malformed)", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    cookieHeader: "__Host-mystcrag_session__0=stale-chunk-ciphertext"
  });
  const deps = makeBffDeps({
    token: async () => {
      throw { code: "missing_session" };
    },
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  assert.deepEqual(capture.records, [
    {
      event: "auth.session_invalid",
      category: "session_expired_or_malformed",
      requestId: "req-log",
      outcome: "failure"
    }
  ]);
});

test("BFF session_expired logs auth.session_invalid (session_expired_or_malformed)", async () => {
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
    {
      event: "auth.session_invalid",
      category: "session_expired_or_malformed",
      requestId: "req-log",
      outcome: "failure"
    }
  ]);
});

test("BFF missing_refresh_token logs auth.session_invalid (never renewal_revoked)", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const deps = makeBffDeps({
    token: async () => {
      throw { code: "missing_refresh_token" };
    },
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  // The session cannot continue, but no provider revoke was observed: conservative
  // session_expired_or_malformed semantics, NOT renewal_revoked.
  assert.deepEqual(capture.records, [
    {
      event: "auth.session_invalid",
      category: "session_expired_or_malformed",
      requestId: "req-log",
      outcome: "failure"
    }
  ]);
});

test("BFF token infrastructure failure logs auth.dependency_failed", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  // rotate: false isolates the dependency-failure semantics; the actually-produced
  // rolling Set-Cookie → rotation pairing is covered by the dedicated rotation tests.
  const deps = makeBffDeps({
    rotate: false,
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

test("Backend 401 logs auth.verification_failed (distinct from renewal rejection)", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const deps = makeBffDeps({
    backend: () => new Response("{}", { status: 401 }),
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 401);
  assert.deepEqual(capture.records, [
    { event: "auth.verification_failed", category: "verification_failed", requestId: "req-log", outcome: "failure" }
  ]);
});

test("BFF mutation with wrong Origin logs auth.origin_rejected", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    method: "POST",
    headers: { origin: "https://evil.example.com" },
    body: "{}"
  });
  const deps = makeBffDeps({ logAuthEvent: capture.logger });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 403);
  assert.deepEqual(capture.records, [
    { event: "auth.origin_rejected", category: "origin_rejected", requestId: "req-log", outcome: "failure" }
  ]);
});

test("BFF getConfig failure logs auth.dependency_failed with stable 500", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const deps = makeBffDeps({
    getConfig: () => {
      throw new Error("config resolution failed");
    },
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  // The possibly-valid session cookie is never cleared on configuration failure.
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-log", outcome: "failure" }
  ]);
});

test("BFF rolling failure logs auth.dependency_failed", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const deps = makeBffDeps({
    touch: async () => {
      throw new Error("session store unavailable");
    },
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 500);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-log", outcome: "failure" }
  ]);
});

test("BFF actually-produced rolling Set-Cookie logs auth.session_rotation", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const deps = makeBffDeps({
    touch: async () => ["__Host-mystcrag_session=rolled; Max-Age=28800; Path=/; HttpOnly; Secure"],
    logAuthEvent: capture.logger
  });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 200);
  assert.deepEqual(capture.records, [
    { event: "auth.session_rotation", category: "session_rotation", requestId: "req-log", outcome: "success" }
  ]);
});

test("BFF without any rolling/rotation Set-Cookie logs no rotation event", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/api/designs");
  const deps = makeBffDeps({ rotate: false, logAuthEvent: capture.logger });
  const response = await handleBffRequest(request, ["designs"], deps);
  assert.equal(response.status, 200);
  assert.deepEqual(capture.records, []);
});

// --- Logout wiring ---

test("POST logout with wrong Origin logs auth.origin_rejected", () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://evil.example.com" }
  });
  const deps: LogoutDeps = {
    getConfig: () => makeConfig(),
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = handleLogoutPost(request, deps);
  assert.equal(response.status, 403);
  assert.deepEqual(capture.records, [
    { event: "auth.origin_rejected", category: "origin_rejected", requestId: "req-log", outcome: "failure" }
  ]);
});

test("logout getConfig failure logs auth.dependency_failed with stable 500", () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/logout", {
    method: "POST",
    headers: { origin: "https://app.mystcrag.com" }
  });
  const deps: LogoutDeps = {
    getConfig: () => {
      throw new Error("invalid config");
    },
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = handleLogoutPost(request, deps);
  assert.equal(response.status, 500);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-log", outcome: "failure" }
  ]);
});

// --- Session rotation + config failure wiring ---

test("session endpoint actually-produced rolling Set-Cookie logs auth.session_rotation", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const session = {
    user: { name: "User", email: "user@example.com", email_verified: true },
    internal: { createdAt: Math.floor(Date.now() / 1000) },
    tokenSet: { access_token: "t", token_type: "Bearer", expires_at: Math.floor(Date.now() / 1000) + 900 }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const deps: SessionDeps = {
    getConfig: () => makeConfig(),
    getSession: async () => session,
    touchSession: async () => ["__Host-mystcrag_session=rolled; Max-Age=28800; Path=/; HttpOnly; Secure"],
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = await handleSessionRequest(request, deps);
  assert.equal(response.status, 200);
  assert.deepEqual(capture.records, [
    { event: "auth.session_rotation", category: "session_rotation", requestId: "req-log", outcome: "success" }
  ]);
});

test("session getConfig failure logs auth.dependency_failed and clears no cookie", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/session", {
    cookieHeader: "__Host-mystcrag_session=cipher"
  });
  const deps: SessionDeps = {
    getConfig: () => {
      throw new Error("config resolution failed");
    },
    getSession: async () => null,
    touchSession: async () => [],
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = await handleSessionRequest(request, deps);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-log", outcome: "failure" }
  ]);
});

// --- Login + proxy wiring ---

test("login rejected returnTo logs auth.open_redirect_rejected with the requestId", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/login?returnTo=https%3A%2F%2Fevil.example%2Fphish");
  const deps: LoginDeps = {
    startInteractiveLogin: async () => new Response(null, { status: 302 }),
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = await handleLoginRequest(request, deps);
  assert.equal(response.status, 302);
  assert.deepEqual(capture.records, [
    { event: "auth.open_redirect_rejected", category: "open_redirect", requestId: "req-log", outcome: "failure" }
  ]);
  assert.ok(!JSON.stringify(capture.records).includes("evil.example"));
});

test("login configuration/SDK failure logs auth.dependency_failed", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/auth/login");
  const deps: LoginDeps = {
    startInteractiveLogin: async () => {
      throw new Error("getAuth0Client failed");
    },
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = await handleLoginRequest(request, deps);
  assert.equal(response.status, 500);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-log", outcome: "failure" }
  ]);
});

test("page proxy SDK/config failure logs auth.dependency_failed (fail closed)", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/dashboard");
  const deps: ProxyPageDeps = {
    middleware: async () => {
      throw new Error("sdk outage");
    },
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = await handleProxyPageRolling(request, deps);
  assert.equal(response.status, 500);
  assert.deepEqual(capture.records, [
    { event: "auth.dependency_failed", category: "dependency", requestId: "req-log", outcome: "failure" }
  ]);
});

test("page proxy actually-produced rolling Set-Cookie logs auth.session_rotation", async () => {
  const capture = makeAuthEventCapture();
  const request = makeRequest("https://app.mystcrag.com/design");
  const deps: ProxyPageDeps = {
    middleware: async () =>
      new Response(null, {
        status: 200,
        headers: { "Set-Cookie": "__Host-mystcrag_session=rolled; Max-Age=28800; Path=/; HttpOnly; Secure" }
      }),
    generateRequestId: () => "req-log",
    logAuthEvent: capture.logger
  };
  const response = await handleProxyPageRolling(request, deps);
  assert.equal(response.status, 200);
  assert.deepEqual(capture.records, [
    { event: "auth.session_rotation", category: "session_rotation", requestId: "req-log", outcome: "success" }
  ]);
});

// --- Sink-wide sensitive probe sweep across every emitted record ---

test("no emitted record across all wired paths contains sensitive material", async () => {
  const capture = makeAuthEventCapture();
  const config = makeConfig();

  // Trigger a representative path of each category, poisoning the request surface.
  await handleCallback(
    makeRequest("https://app.mystcrag.com/auth/callback?code=secret-code&state=secret-state"),
    {
      middleware: async () =>
        new Response(null, { status: 303, headers: { location: "https://app.mystcrag.com/" } }),
      getConfig: () => config,
      generateRequestId: () => "req-sweep",
      logAuthEvent: capture.logger
    }
  );
  await handleBffRequest(
    makeRequest("https://app.mystcrag.com/api/designs", {
      method: "POST",
      headers: { origin: "https://evil.example.com", cookie: "__Host-mystcrag_session=cipher" },
      body: "{}"
    }),
    ["designs"],
    makeBffDeps({ logAuthEvent: capture.logger })
  );

  for (const record of capture.records) {
    const serialized = JSON.stringify(record);
    for (const probe of SENSITIVE_PROBES) {
      assert.ok(!serialized.includes(probe), `record must not contain: ${probe}`);
    }
    assert.ok(!serialized.includes("secret-code"));
    assert.ok(!serialized.includes("secret-state"));
    assert.ok(!serialized.includes("evil.example"));
    assert.ok(!serialized.includes("cipher"));
  }
});
