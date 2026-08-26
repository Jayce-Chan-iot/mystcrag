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

test("valid auth0 configuration is accepted", () => {
  const config = resolveAuthConfig(validAuth0Config);
  assert.equal(config.appOrigin, "https://mystcrag.com");
  assert.equal(config.authProvider, "auth0");
  assert.equal(config.authIssuer, "https://mystcrag.auth0.com/");
  assert.equal(config.authAudience, "mystcrag-backend");
  assert.equal(config.authClientId, "client-id-123");
  assert.equal(config.authClientSecret, "client-secret-456");
  assert.equal(config.authCallbackUrl, "https://mystcrag.com/auth/callback");
  assert.equal(config.authLogoutUrl, "https://mystcrag.com");
  assert.equal(config.authSessionSecret, "a".repeat(64));
  assert.equal(config.backendOrigin, "https://api.mystcrag.com");
});

test("valid signed-test configuration is accepted in development", () => {
  const config = resolveAuthConfig(validSignedTestConfig);
  assert.equal(config.appOrigin, "http://localhost:3000");
  assert.equal(config.authProvider, "signed-test");
  assert.equal(config.enableSignedTestAuth, true);
});

test("missing required fields fail closed", () => {
  assert.throws(() => resolveAuthConfig({}), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.fields.length > 0;
  });
});

test("missing MYSTCRAG_APP_ORIGIN fails", () => {
  const env = { ...validAuth0Config, MYSTCRAG_APP_ORIGIN: "" };
  assert.throws(() => resolveAuthConfig(env), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.message.includes("MYSTCRAG_APP_ORIGIN");
  });
});

test("invalid MYSTCRAG_APP_ORIGIN with path fails", () => {
  const env = { ...validAuth0Config, MYSTCRAG_APP_ORIGIN: "https://mystcrag.com/path" };
  assert.throws(() => resolveAuthConfig(env), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.message.includes("MYSTCRAG_APP_ORIGIN");
  });
});

test("loopback MYSTCRAG_APP_ORIGIN fails in production", () => {
  const env = { ...validAuth0Config, MYSTCRAG_APP_ORIGIN: "http://localhost:3000", NODE_ENV: "production" };
  assert.throws(() => resolveAuthConfig(env), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.message.includes("cannot be loopback");
  });
});

test("signed-test provider fails in production", () => {
  const env = { ...validSignedTestConfig, NODE_ENV: "production" };
  assert.throws(() => resolveAuthConfig(env), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.message.includes("signed-test");
  });
});

test("signed-test provider without enable flag fails", () => {
  const env = { ...validSignedTestConfig, MYSTCRAG_ENABLE_SIGNED_TEST_AUTH: "false" };
  assert.throws(() => resolveAuthConfig(env), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.message.includes("MYSTCRAG_ENABLE_SIGNED_TEST_AUTH");
  });
});

test("auth0 provider requires client ID", () => {
  const env = { ...validAuth0Config, MYSTCRAG_AUTH_CLIENT_ID: "" };
  assert.throws(() => resolveAuthConfig(env), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.message.includes("MYSTCRAG_AUTH_CLIENT_ID");
  });
});

test("auth0 provider requires client secret", () => {
  const env = { ...validAuth0Config, MYSTCRAG_AUTH_CLIENT_SECRET: "" };
  assert.throws(() => resolveAuthConfig(env), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.message.includes("MYSTCRAG_AUTH_CLIENT_SECRET");
  });
});

test("auth0 provider requires HTTPS issuer", () => {
  const env = { ...validAuth0Config, MYSTCRAG_AUTH_ISSUER: "http://mystcrag.auth0.com/" };
  assert.throws(() => resolveAuthConfig(env), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.message.includes("MYSTCRAG_AUTH_ISSUER");
  });
});

test("invalid session secret fails", () => {
  const env = { ...validAuth0Config, MYSTCRAG_AUTH_SESSION_SECRET: "too-short" };
  assert.throws(() => resolveAuthConfig(env), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.message.includes("MYSTCRAG_AUTH_SESSION_SECRET");
  });
});

test("session secret must be exactly 64 hex characters", () => {
  const env = { ...validAuth0Config, MYSTCRAG_AUTH_SESSION_SECRET: "g".repeat(64) };
  assert.throws(() => resolveAuthConfig(env), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.message.includes("64 hexadecimal");
  });
});

test("loopback callback URL is allowed in development", () => {
  const env = { ...validSignedTestConfig, MYSTCRAG_AUTH_CALLBACK_URL: "http://localhost:3000/auth/callback" };
  const config = resolveAuthConfig(env);
  assert.equal(config.authCallbackUrl, "http://localhost:3000/auth/callback");
});

test("loopback callback URL fails in production", () => {
  const env = { ...validAuth0Config, MYSTCRAG_AUTH_CALLBACK_URL: "http://localhost:3000/auth/callback", NODE_ENV: "production" };
  assert.throws(() => resolveAuthConfig(env), (error: unknown) => {
    const authError = error as AuthConfigError;
    return authError.code === "INVALID_CONFIG" && authError.message.includes("cannot be loopback");
  });
});

test("backendOrigin defaults to NEXT_PUBLIC_API_BASE_URL when MYSTCRAG_BACKEND_ORIGIN is missing", () => {
  const env = { ...validAuth0Config, MYSTCRAG_BACKEND_ORIGIN: undefined, NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:5000" };
  const config = resolveAuthConfig(env);
  assert.equal(config.backendOrigin, "http://127.0.0.1:5000");
});

test("backendOrigin strips trailing slash", () => {
  const env = { ...validAuth0Config, MYSTCRAG_BACKEND_ORIGIN: "https://api.mystcrag.com/" };
  const config = resolveAuthConfig(env);
  assert.equal(config.backendOrigin, "https://api.mystcrag.com");
});
