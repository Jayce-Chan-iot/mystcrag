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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { resolveAuthConfig, type AuthConfigError } from "./auth-config";

const validAuthingConfig = {
  NODE_ENV: "production",
  MYSTCRAG_APP_ORIGIN: "https://mystcrag.com",
  MYSTCRAG_AUTH_PROVIDER: "authing",
  MYSTCRAG_AUTH_ISSUER: "https://mystcrag-pool.authing.cn/oidc",
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

test("valid authing production configuration is accepted", () => {
  const config = resolveAuthConfig(validAuthingConfig);
  assert.equal(config.appOrigin, "https://mystcrag.com");
  assert.equal(config.authProvider, "authing");
  assert.equal(config.authIssuer, "https://mystcrag-pool.authing.cn/oidc/");
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
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_APP_ORIGIN: "http://mystcrag.com" }),
    "HTTPS"
  );
});

test("production rejects HTTP backend origin", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_BACKEND_ORIGIN: "http://api.mystcrag.com" }),
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
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_APP_ORIGIN: "https://user:pass@mystcrag.com" }),
    "MYSTCRAG_APP_ORIGIN"
  );
});

test("backend origin rejects embedded username/password", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_BACKEND_ORIGIN: "https://user:pass@api.mystcrag.com" }),
    "MYSTCRAG_BACKEND_ORIGIN"
  );
});

test("logout URL rejects embedded username/password", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_LOGOUT_URL: "https://user:pass@mystcrag.com" }),
    "credentials"
  );
});

// --- Issuer validation ---

test("issuer must be HTTPS", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_ISSUER: "http://mystcrag-pool.authing.cn/oidc" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer accepts Authing /oidc with or without trailing slash and normalizes it", () => {
  const withoutSlash = resolveAuthConfig({
    ...validAuthingConfig,
    MYSTCRAG_AUTH_ISSUER: "https://mystcrag-pool.authing.cn/oidc"
  });
  assert.equal(withoutSlash.authIssuer, "https://mystcrag-pool.authing.cn/oidc/");
  const withSlash = resolveAuthConfig({
    ...validAuthingConfig,
    MYSTCRAG_AUTH_ISSUER: "https://mystcrag-pool.authing.cn/oidc/"
  });
  assert.equal(withSlash.authIssuer, "https://mystcrag-pool.authing.cn/oidc/");
});

test("issuer rejects path component", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_ISSUER: "https://mystcrag-pool.authing.cn/oidcpath/" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("removed auth0 provider is rejected", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_PROVIDER: "auth0" }),
    "MYSTCRAG_AUTH_PROVIDER"
  );
});

test("issuer rejects query string", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_ISSUER: "https://mystcrag-pool.authing.cn/oidc?foo=bar" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects fragment", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_ISSUER: "https://mystcrag-pool.authing.cn/oidc#frag" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects wildcard", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_ISSUER: "https://*.authing.cn/oidc" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects IPv4 literal", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_ISSUER: "https://192.168.1.1/" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects IPv6 literal", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_ISSUER: "https://[::1]/" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects credentials", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_ISSUER: "https://user:pass@mystcrag-pool.authing.cn/oidc" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

test("issuer rejects localhost", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_ISSUER: "https://localhost/" }),
    "MYSTCRAG_AUTH_ISSUER"
  );
});

// --- Callback URL exact equality ---

test("callback URL must exactly match appOrigin/auth/callback", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_CALLBACK_URL: "https://mystcrag.com/wrong/callback" }),
    "must exactly equal"
  );
});

test("callback URL with different origin fails", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_CALLBACK_URL: "https://other.com/auth/callback" }),
    "must exactly equal"
  );
});

// --- Logout URL same-origin ---

test("logout URL must be same-origin as app origin", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_LOGOUT_URL: "https://other.com" }),
    "same-origin"
  );
});

// --- Session secret ---

test("session secret must be exactly 64 hex characters", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_SESSION_SECRET: "too-short" }),
    "64 hexadecimal"
  );
});

test("session secret rejects non-hex characters", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_SESSION_SECRET: "g".repeat(64) }),
    "64 hexadecimal"
  );
});

test("session secret accepts 64 hex chars (case insensitive)", () => {
  const config = resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_SESSION_SECRET: "aAbBcCdDeEfF00112233445566778899aAbBcCdDeEfF00112233445566778899" });
  assert.equal(config.authSessionSecret, "aAbBcCdDeEfF00112233445566778899aAbBcCdDeEfF00112233445566778899");
});

// --- Backend origin ---

test("backend origin is required — no fallback to NEXT_PUBLIC_API_BASE_URL", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_BACKEND_ORIGIN: "" }),
    "MYSTCRAG_BACKEND_ORIGIN is required"
  );
});

test("backend origin strips trailing slash", () => {
  const config = resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_BACKEND_ORIGIN: "https://api.mystcrag.com/" });
  assert.equal(config.backendOrigin, "https://api.mystcrag.com");
});

test("production rejects loopback backend origin", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_BACKEND_ORIGIN: "http://127.0.0.1:4000" }),
    "HTTPS"
  );
});

// --- App origin ---

test("app origin with path component fails", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_APP_ORIGIN: "https://mystcrag.com/path" }),
    "without path"
  );
});

test("production rejects loopback app origin", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_APP_ORIGIN: "http://localhost:3000" }),
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

test("authing requires client ID", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_CLIENT_ID: "" }),
    "MYSTCRAG_AUTH_CLIENT_ID"
  );
});

test("authing requires client secret", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validAuthingConfig, MYSTCRAG_AUTH_CLIENT_SECRET: "" }),
    "MYSTCRAG_AUTH_CLIENT_SECRET"
  );
});

// --- Environment classification (cookie NAME source, independent of Secure) ---

test("environment classification is resolved reliably from NODE_ENV", () => {
  assert.equal(resolveAuthConfig(validAuthingConfig).environment, "production");
  assert.equal(
    resolveAuthConfig({ ...validAuthingConfig, NODE_ENV: "staging" }).environment,
    "staging"
  );
  assert.equal(resolveAuthConfig(validSignedTestConfig).environment, "development");
  assert.equal(
    resolveAuthConfig({ ...validSignedTestConfig, NODE_ENV: "test" }).environment,
    "test"
  );
  // Unknown NODE_ENV values fall back to development (never production semantics).
  assert.equal(
    resolveAuthConfig({ ...validSignedTestConfig, NODE_ENV: "something-else" }).environment,
    "development"
  );
});

// --- Desktop auto auth mode matrix ---

const validDesktopConfig = {
  ...validSignedTestConfig,
  MYSTCRAG_DESKTOP_AUTO_AUTH: "true",
  MYSTCRAG_DESKTOP_ACCESS_TOKEN: "desktop-token-value"
};

test("valid desktop configuration passes and exposes server-only desktop fields", () => {
  const config = resolveAuthConfig(validDesktopConfig);
  assert.equal(config.desktopAutoAuth, true);
  assert.equal(config.desktopAccessToken, "desktop-token-value");
});

test("desktop mode with empty token fails closed", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validDesktopConfig, MYSTCRAG_DESKTOP_ACCESS_TOKEN: "" }),
    "MYSTCRAG_DESKTOP_ACCESS_TOKEN"
  );
});

test("desktop flag with authing provider fails closed", () => {
  expectConfigError(
    () => resolveAuthConfig({
      ...validAuthingConfig,
      MYSTCRAG_DESKTOP_AUTO_AUTH: "true",
      MYSTCRAG_DESKTOP_ACCESS_TOKEN: "desktop-token-value"
    }),
    "signed-test"
  );
});

test("desktop flag with NODE_ENV=test fails closed", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validDesktopConfig, NODE_ENV: "test" }),
    "development"
  );
});

test("desktop flag with NODE_ENV unset fails closed", () => {
  const rest = Object.fromEntries(
    Object.entries(validDesktopConfig).filter(([key]) => key !== "NODE_ENV")
  );
  expectConfigError(() => resolveAuthConfig(rest), "development");
});

test("desktop flag with empty NODE_ENV fails closed", () => {
  expectConfigError(() => resolveAuthConfig({ ...validDesktopConfig, NODE_ENV: "" }), "development");
});

test("desktop flag with NODE_ENV=unexpected fails closed", () => {
  expectConfigError(() => resolveAuthConfig({ ...validDesktopConfig, NODE_ENV: "unexpected" }), "development");
});

test("desktop flag with NODE_ENV=staging fails closed", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validDesktopConfig, NODE_ENV: "staging" }),
    "development"
  );
});

test("desktop flag with NODE_ENV=production fails closed", () => {
  expectConfigError(
    () => resolveAuthConfig({ ...validDesktopConfig, NODE_ENV: "production" }),
    "development"
  );
});

test("desktop flag with non-loopback app origin fails closed", () => {
  expectConfigError(
    () => resolveAuthConfig({
      ...validDesktopConfig,
      MYSTCRAG_APP_ORIGIN: "https://mystcrag.com",
      MYSTCRAG_AUTH_CALLBACK_URL: "https://mystcrag.com/auth/callback",
      MYSTCRAG_AUTH_LOGOUT_URL: "https://mystcrag.com"
    }),
    "loopback"
  );
});

test("desktop flag with non-loopback backend origin fails closed", () => {
  expectConfigError(
    () => resolveAuthConfig({
      ...validDesktopConfig,
      MYSTCRAG_BACKEND_ORIGIN: "https://api.mystcrag.com"
    }),
    "loopback"
  );
});

test("desktop flag absent preserves all existing behavior", () => {
  const config = resolveAuthConfig(validSignedTestConfig);
  assert.equal(config.desktopAutoAuth, false);
  assert.equal(config.desktopAccessToken, "");
});

test("desktop variables never use NEXT_PUBLIC_ and are not renamed to a public value", () => {
  const source = readFileSync(join(process.cwd(), "src", "features", "auth", "model", "auth-config.ts"), "utf8");
  assert.equal(source.includes("NEXT_PUBLIC_MYSTCRAG_DESKTOP"), false);
  assert.match(source, /MYSTCRAG_DESKTOP_AUTO_AUTH/);
  assert.match(source, /MYSTCRAG_DESKTOP_ACCESS_TOKEN/);

  const config = resolveAuthConfig(validDesktopConfig);
  // The resolved config keys stay private singular names; the token is not mapped
  // onto any NEXT_PUBLIC_* field.
  assert.deepEqual(
    Object.keys(config).filter((key) => key.toLowerCase().includes("desktop")),
    ["desktopAutoAuth", "desktopAccessToken"]
  );
});
