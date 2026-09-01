import assert from "node:assert/strict";
import test from "node:test";

import { Auth0AccessTokenVerifier } from "./auth0-access-token-verifier.js";
import { CredentialRejectedError } from "./auth-errors.js";
import { createAccessTokenVerifierFromEnvironment } from "./auth-provider.factory.js";
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

const developmentAuth0Environment = {
  ...productionAuth0Environment,
  NODE_ENV: "development"
};

test("signed test identities require an explicit test or development opt-in", () => {
  assert.ok(
    createAccessTokenVerifierFromEnvironment(configuredTestEnvironment) instanceof
      SignedTestTokenAuthProvider
  );
  assert.throws(
    () =>
      createAccessTokenVerifierFromEnvironment({
        ...configuredTestEnvironment,
        MYSTCRAG_ENABLE_SIGNED_TEST_AUTH: "false"
      }),
    /disabled/
  );
  assert.throws(
    () =>
      createAccessTokenVerifierFromEnvironment({
        ...configuredTestEnvironment,
        NODE_ENV: "production"
      }),
    /disabled/
  );
  assert.throws(
    () =>
      createAccessTokenVerifierFromEnvironment({
        ...configuredTestEnvironment,
        NODE_ENV: "staging"
      }),
    /disabled/
  );
});

test("production fails safely when authentication is not configured", () => {
  assert.throws(
    () => createAccessTokenVerifierFromEnvironment({ NODE_ENV: "production" }),
    /not configured/
  );
});

test("an unsupported provider is rejected", () => {
  assert.throws(
    () =>
      createAccessTokenVerifierFromEnvironment({
        ...productionAuth0Environment,
        MYSTCRAG_AUTH_PROVIDER: "oauth-proxy"
      }),
    /Unsupported authentication provider/
  );
});

test("a fully configured production auth0 environment builds the auth0 verifier", () => {
  const verifier = createAccessTokenVerifierFromEnvironment(productionAuth0Environment);
  assert.ok(verifier instanceof Auth0AccessTokenVerifier);
});

test("auth0 configuration without an issuer fails closed", () => {
  const { MYSTCRAG_AUTH_ISSUER: _issuer, ...withoutIssuer } = productionAuth0Environment;
  assert.throws(
    () => createAccessTokenVerifierFromEnvironment(withoutIssuer),
    /MYSTCRAG_AUTH_ISSUER/
  );
});

test("auth0 configuration without an audience fails closed", () => {
  const { MYSTCRAG_AUTH_AUDIENCE: _audience, ...withoutAudience } =
    productionAuth0Environment;
  assert.throws(
    () => createAccessTokenVerifierFromEnvironment(withoutAudience),
    /MYSTCRAG_AUTH_AUDIENCE/
  );
});

test("the auth0 issuer must be the exact canonical HTTPS form", () => {
  const rejectedIssuers = [
    "http://mystcrag-tenant.auth0.example.com/",
    "not a url",
    "ftp://mystcrag-tenant.auth0.example.com/",
    "https://mystcrag-tenant.auth0.example.com",
    "https://mystcrag-tenant.auth0.example.com/#fragment",
    "https://mystcrag-tenant.auth0.example.com/?query=1",
    "https://mystcrag-tenant.auth0.example.com/path/",
    "https://user:pass@mystcrag-tenant.auth0.example.com/",
    "https://localhost/",
    "https://LOCALHOST/",
    "https://localhost./",
    "https://127.0.0.1/",
    "https://127.0.0.7/",
    "https://127.1/",
    "https://[::1]/",
    "https://[0:0:0:0:0:0:0:1]/",
    "https://[::ffff:127.0.0.1]/"
  ];
  for (const issuer of rejectedIssuers) {
    assert.throws(
      () =>
        createAccessTokenVerifierFromEnvironment({
          ...productionAuth0Environment,
          MYSTCRAG_AUTH_ISSUER: issuer
        }),
      { message: /MYSTCRAG_AUTH_ISSUER/ },
      `issuer=${issuer} must be rejected`
    );
  }
});

test("the auth0 issuer host must be an exact DNS hostname", () => {
  const rejectedIssuers = [
    "https://*.example.com/",
    "https://tenant.*.auth0.example.com/",
    "https://8.8.8.8/",
    "https://0.0.0.0/",
    "https://192.168.1.10/",
    "https://[2001:db8::1]/",
    "https://[fe80::1]/"
  ];
  for (const issuer of rejectedIssuers) {
    assert.throws(
      () =>
        createAccessTokenVerifierFromEnvironment({
          ...productionAuth0Environment,
          MYSTCRAG_AUTH_ISSUER: issuer
        }),
      { message: /MYSTCRAG_AUTH_ISSUER/ },
      `issuer=${issuer} must be rejected`
    );
  }
});

test("custom-domain canonical HTTPS issuers are accepted", () => {
  for (const issuer of [
    "https://auth.mystcrag.example.com/",
    "https://mystcrag-tenant.auth0.example.com/",
    "https://login.mystcrag.example/"
  ]) {
    const verifier = createAccessTokenVerifierFromEnvironment({
      ...productionAuth0Environment,
      MYSTCRAG_AUTH_ISSUER: issuer
    });
    assert.ok(verifier instanceof Auth0AccessTokenVerifier, `issuer=${issuer}`);
  }
});

test("development and test also require an HTTPS auth0 issuer", () => {
  assert.throws(
    () =>
      createAccessTokenVerifierFromEnvironment({
        ...developmentAuth0Environment,
        MYSTCRAG_AUTH_ISSUER: "http://mystcrag-tenant.auth0.example.com/"
      }),
    /MYSTCRAG_AUTH_ISSUER/
  );
  assert.throws(
    () =>
      createAccessTokenVerifierFromEnvironment({
        ...developmentAuth0Environment,
        MYSTCRAG_AUTH_ISSUER: "https://localhost/"
      }),
    /MYSTCRAG_AUTH_ISSUER/
  );
  assert.ok(
    createAccessTokenVerifierFromEnvironment(developmentAuth0Environment) instanceof
      Auth0AccessTokenVerifier
  );
});

test("signed test provider rejects a token with an invalid signature", async () => {
  const verifier = createAccessTokenVerifierFromEnvironment(configuredTestEnvironment);
  const token = signTestAccessToken(
    {
      subject: "actor-owner",
      issuer: configuredTestEnvironment.MYSTCRAG_AUTH_ISSUER,
      audience: configuredTestEnvironment.MYSTCRAG_AUTH_AUDIENCE,
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 3_600
    },
    "different-mystcrag-auth-signing-secret-2026"
  );

  await assert.rejects(
    () => verifier.verifyAccessToken(token),
    (error: unknown) => error instanceof CredentialRejectedError && error.reason === "signature"
  );
});
