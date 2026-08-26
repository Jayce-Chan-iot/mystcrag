/**
 * Auth configuration validation tests.
 *
 * Coverage:
 * - strict config matrix (valid auth0 + signed-test)
 * - production HTTP rejection
 * - issuer wildcard/IP/localhost/path/query rejection
 * - callback/logout exact URL equality
 * - session secret 64 hex validation
 * - backend origin production requirements
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resolveAuthConfig, type AuthConfigError } from "./auth-config";

const validAuth0Config = {
  NODE_ENV: "production",
  MYSTCRAG_APP_ORIGIN: "https://mystcrag.com",
  MYSTCRAG_AUTH_PROVIDER: "auth0",
  MYSTCRAG_AUTH_ISSUER: "https://mystcrag.auth0.com/",
  MYSTCRAG_AUTH_AUDIENCE: "mystcrag-backend",
  MYSTCRAG_AUTH_CLIENT_ID: "client-id-123",
  MYSTCRAG_AUTH_CLIENT_SECRET: "client-secret-456",
  MYSTCRAG_AUTH_CALLBACK_URL: "https://mystcrag.com/auth/callback",
  MYSTCRAG_AUTH_LOGOUT_URL: "https://mystcrag.com",
  MYSTCRAG_AUTH_SESSION_SECRET: "a".repeat(64),
  MYSTCRAG_BACKEND_ORIGIN: "https://api.mystcrag.com"
};

const validSignedTestConfig = {
  NODE_ENV: "development",
  MYSTCRAG_APP_ORIGIN: "http://localhost:3000",
  MYSTCRAG_AUTH_PROVIDER: "signed-test",
  MYSTCRAG_AUTH_ISSUER: "mystcrag-local",
  MYSTCRAG_AUTH_AUDIENCE: "mystcrag-backend",
  MYSTCRAG_AUTH_CLIENT_ID: "",
  MYSTCRAG_AUTH_CLIENT_SECRET: "",
  MYSTCRAG_AUTH_CALLBACK_URL: "http://localhost:3000/auth/callback",
  MYSTCRAG_AUTH_LOGOUT_URL: "http://localhost:3000",
  MYSTCRAG_AUTH_SESSION_SECRET: "b".repeat(64),
  MYSTCRAG_ENABLE_SIGNED_TEST_AUTH: "true",
  MYSTCRAG_BACKEND_ORIGIN: "http://127.0.0.1:4000"
};

function expectConfigError(fn: () => unknown, messageIncludes?: string): void {
  assert.throws(fn, (error: unknown) => {
    const authError = error as AuthConfigError;
    if (authError.code !== "INVALID_CONFIG") return false;
    if (messageIncludes && !authError.message.includes(messageIncludes)) return false;
    return true;
  });
}

// --- Strict config matrix ---

test("valid auth0 production configuration is accepted", () => {
  const config = resolveAuthConfig(validAuth0Config);
  assert.equal(config.appOrigin, "https://mystcrag.com");
  assert.equal(config.authProvider, "auth0");
  assert.equal(config.authIssuer, "https://mystcrag.auth0.com/");
  assert.equal(config.authCallbackUrl, "https://mystcrag.com/auth/callback");
  assert.equal(config.authLogoutUrl, "https://mystcrag.com");
  assert.equal(config.backendOrigin, "https://api.mystcrag.com");
});

test("valid signed-test development configuration is accepted", () => {
  const config = resolveAuthConfig(validSignedTestConfig);
  assert.equal(config.appOrigin, "http://localhost:3000");
  assert.equal(config.authProvider, "signed-test");
  assert.equal(config.enableSignedTestAuth, true);
});

test("missing all required fields fails with multiple errors", () => {
  expectConfigError(() => resolveAuthConfig({}));
});

// --- Production HTTP rejection ---

test("production rejects HTTP app origin", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_APP_ORIGIN: "http://mystcrag.com" }),
    "HTTPS"
  );
});

test("production rejects HTTP backend origin", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_BACKEND_ORIGIN: "http://api.mystcrag.com" }),
    "HTTPS"
  );
});

test("development allows HTTP loopback app origin", () => {
  const config = resolveAuthConfig(validSignedTestConfig);
  assert.equal(config.appOrigin, "http://localhost:3000");
});

test("development rejects HTTP non-loopback app origin", () => {
  expectConfigError(
    () => resolveAuthConfig({
      ...validSignedTestConfig,
      MYSTCRAG_APP_ORIGIN: "http://192.168.1.10:3000",
      MYSTCRAG_AUTH_CALLBACK_URL: "http://192.168.1.10:3000/auth/callback",
      MYSTCRAG_AUTH_LOGOUT_URL: "http://192.168.1.10:3000"
    }),
    "HTTP is only allowed for loopback"
  );
});

test("development rejects HTTP non-loopback backend origin", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validSignedTestConfig, MYSTCRAG_BACKEND_ORIGIN: "http://10.0.0.5:4000" }),
    "HTTP is only allowed for loopback"
  );
});

// --- Credentials rejection ---

test("app origin rejects embedded username/password", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_APP_ORIGIN: "https://user:pass@mystcrag.com" }),
    "MYSTCRAG_APP_ORIGIN"
  );
});

test("backend origin rejects embedded username/password", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_BACKEND_ORIGIN: "https://user:pass@api.mystcrag.com" }),
    "MYSTCRAG_BACKEND_ORIGIN"
  );
});

test("logout URL rejects embedded username/password", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_LOGOUT_URL: "https://user:pass@mystcrag.com" }),
    "credentials"
  );
});

// --- Issuer validation ---

test("issuer must be HTTPS", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_ISSUER: "http://mystcrag.auth0.com/" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer must have trailing slash", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_ISSUER: "https://mystcrag.auth0.com" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects path component", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_ISSUER: "https://mystcrag.auth0.com/path/" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects query string", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_ISSUER: "https://mystcrag.auth0.com/?foo=bar" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects fragment", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_ISSUER: "https://mystcrag.auth0.com/#frag" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects wildcard", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_ISSUER: "https://*.auth0.com/" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects IPv4 literal", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_ISSUER: "https://192.168.1.1/" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects IPv6 literal", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_ISSUER: "https://[::1]/" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects credentials", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_ISSUER: "https://user:pass@mystcrag.auth0.com/" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects localhost", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_ISSUER: "https://localhost/" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

// --- Callback URL exact equality ---

test("callback URL must exactly match appOrigin/auth/callback", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_CALLBACK_URL: "https://mystcrag.com/wrong/callback" }),
    "must exactly equal"
  );
});

test("callback URL with different origin fails", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_CALLBACK_URL: "https://other.com/auth/callback" }),
    "must exactly equal"
  );
});

// --- Logout URL same-origin ---

test("logout URL must be same-origin as app origin", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_LOGOUT_URL: "https://other.com" }),
    "same-origin"
  );
});

// --- Session secret ---

test("session secret must be exactly 64 hex characters", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_SESSION_SECRET: "too-short" }),
    "64 hexadecimal"
  );
});

test("session secret rejects non-hex characters", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_SESSION_SECRET: "g".repeat(64) }),
    "64 hexadecimal"
  );
});

test("session secret accepts 64 hex chars (case insensitive)", () => {
  const config = resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_SESSION_SECRET: "aAbBcCdDeEfF00112233445566778899aAbBcCdDeEfF00112233445566778899" });
  assert.equal(config.authSessionSecret, "aAbBcCdDeEfF00112233445566778899aAbBcCdDeEfF00112233445566778899");
});

// --- Backend origin ---

test("backend origin is required — no fallback to NEXT_PUBLIC_API_BASE_URL", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_BACKEND_ORIGIN: "" }),
    "MYSTCRAG_BACKEND_ORIGIN is required"
  );
});

test("backend origin strips trailing slash", () => {
  const config = resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_BACKEND_ORIGIN: "https://api.mystcrag.com/" });
  assert.equal(config.backendOrigin, "https://api.mystcrag.com");
});

test("production rejects loopback backend origin", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_BACKEND_ORIGIN: "http://127.0.0.1:4000" }),
    "HTTPS"
  );
});

// --- App origin ---

test("app origin with path component fails", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_APP_ORIGIN: "https://mystcrag.com/path" }),
    "without path"
  );
});

test("production rejects loopback app origin", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_APP_ORIGIN: "http://localhost:3000" }),
    "HTTPS"
  );
});

// --- Provider validation ---

test("signed-test provider fails in production", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validSignedTestConfig, NODE_ENV: "production" }),
    "signed-test"
  );
});

test("signed-test without enable flag fails", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validSignedTestConfig, MYSTCRAG_ENABLE_SIGNED_TEST_AUTH: "false" }),
    "MYSTCRAG_ENABLE_SIGNED_TEST_AUTH"
  );
});

test("auth0 requires client ID", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_CLIENT_ID: "" }),
    "MYSTCRAG_AUTH_CLIENT_ID"
  );
});

test("auth0 requires client secret", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuth0Config, MYSTCRAG_AUTH_CLIENT_SECRET: "" }),
    "MYSTCRAG_AUTH_CLIENT_SECRET"
  );
});
