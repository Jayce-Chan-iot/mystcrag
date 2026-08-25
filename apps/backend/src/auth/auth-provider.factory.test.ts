import assert from "node:assert/strict";
import test from "node:test";

import { Auth0AccessTokenVerifier } from "./auth0-access-token-verifier.js";
import { createAuthProviderFromEnvironment } from "./auth-provider.factory.js";
import {
  SignedTestTokenAuthProvider,
  signTestAccessToken
} from "./signed-test-auth-provider.js";

const configuredTestEnvironment = {
  NODE_ENV: "test",
  MYSTCRAG_AUTH_PROVIDER: "signed-test",
  MYSTCRAG_ENABLE_SIGNED_TEST_AUTH: "true",
  MYSTCRAG_AUTH_SIGNING_SECRET: "mystcrag-auth-factory-test-secret-2026",
  MYSTCRAG_AUTH_ISSUER: "https://auth.test.mystcrag.local",
  MYSTCRAG_AUTH_AUDIENCE: "mystcrag-backend"
};

const productionAuth0Environment = {
  NODE_ENV: "production",
  MYSTCRAG_AUTH_PROVIDER: "auth0",
  MYSTCRAG_AUTH_ISSUER: "https://mystcrag-tenant.auth0.example.com/",
  MYSTCRAG_AUTH_AUDIENCE: "https://api.mystcrag.example.com"
};

test("signed test identities require an explicit test or development opt-in", () => {
  assert.ok(
    createAuthProviderFromEnvironment(configuredTestEnvironment) instanceof
      SignedTestTokenAuthProvider
  );
  assert.throws(
    () =>
      createAuthProviderFromEnvironment({
        ...configuredTestEnvironment,
        MYSTCRAG_ENABLE_SIGNED_TEST_AUTH: "false"
      }),
    /disabled/
  );
  assert.throws(
    () =>
      createAuthProviderFromEnvironment({
        ...configuredTestEnvironment,
        NODE_ENV: "production"
      }),
    /disabled/
  );
  assert.throws(
    () =>
      createAuthProviderFromEnvironment({
        ...configuredTestEnvironment,
        NODE_ENV: "staging"
      }),
    /disabled/
  );
});

test("production fails safely when authentication is not configured", () => {
  assert.throws(
    () => createAuthProviderFromEnvironment({ NODE_ENV: "production" }),
    /not configured/
  );
});

test("an unsupported provider is rejected", () => {
  assert.throws(
    () =>
      createAuthProviderFromEnvironment({
        ...productionAuth0Environment,
        MYSTCRAG_AUTH_PROVIDER: "oauth-proxy"
      }),
    /Unsupported authentication provider/
  );
});

test("a fully configured production auth0 environment builds the auth0 verifier", () => {
  const provider = createAuthProviderFromEnvironment(productionAuth0Environment);
  assert.ok(provider instanceof Auth0AccessTokenVerifier);
});

test("auth0 configuration without an issuer fails closed", () => {
  const { MYSTCRAG_AUTH_ISSUER: _issuer, ...withoutIssuer } = productionAuth0Environment;
  assert.throws(
    () => createAuthProviderFromEnvironment(withoutIssuer),
    /MYSTCRAG_AUTH_ISSUER/
  );
});

test("auth0 configuration without an audience fails closed", () => {
  const { MYSTCRAG_AUTH_AUDIENCE: _audience, ...withoutAudience } =
    productionAuth0Environment;
  assert.throws(
    () => createAuthProviderFromEnvironment(withoutAudience),
    /MYSTCRAG_AUTH_AUDIENCE/
  );
});

test("auth0 issuer must be a parseable HTTPS URL", () => {
  assert.throws(
    () =>
      createAuthProviderFromEnvironment({
        ...productionAuth0Environment,
        MYSTCRAG_AUTH_ISSUER: "http://mystcrag-tenant.auth0.example.com/"
      }),
    /HTTPS/
  );
  assert.throws(
    () =>
      createAuthProviderFromEnvironment({
        ...productionAuth0Environment,
        MYSTCRAG_AUTH_ISSUER: "not a url"
      }),
    /MYSTCRAG_AUTH_ISSUER/
  );
});

test("signed test provider rejects a token with an invalid signature", async () => {
  const provider = createAuthProviderFromEnvironment(configuredTestEnvironment);
  const token = signTestAccessToken(
    {
      subject: "actor-owner",
      issuer: configuredTestEnvironment.MYSTCRAG_AUTH_ISSUER,
      audience: configuredTestEnvironment.MYSTCRAG_AUTH_AUDIENCE,
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 3_600
    },
    "different-mystcrag-auth-signing-secret-2026"
  );

  await assert.rejects(() => provider.verifyAccessToken(token), /Invalid access token/);
});
