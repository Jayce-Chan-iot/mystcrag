import assert from "node:assert/strict";
import test from "node:test";

import { OidcAccessTokenVerifier } from "./oidc-access-token-verifier.js";
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

const productionAuthingEnvironment = {
  NODE_ENV: "production",
  MYSTCRAG_AUTH_PROVIDER: "authing",
  MYSTCRAG_AUTH_ISSUER: "https://mystcrag-pool.authing.cn/oidc",
  MYSTCRAG_AUTH_AUDIENCE: "https://api.mystcrag.example.com"
};

const developmentAuthingEnvironment = {
  ...productionAuthingEnvironment,
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
        ...productionAuthingEnvironment,
        MYSTCRAG_AUTH_PROVIDER: "oauth-proxy"
      }),
    /Unsupported authentication provider/
  );
});

test("the removed auth0 provider is rejected with a migration message", () => {
  assert.throws(
    () =>
      createAccessTokenVerifierFromEnvironment({
        ...productionAuthingEnvironment,
        MYSTCRAG_AUTH_PROVIDER: "auth0"
      }),
    /auth0/
  );
});

test("a fully configured production authing environment builds the OIDC verifier", () => {
  const verifier = createAccessTokenVerifierFromEnvironment(productionAuthingEnvironment);
  assert.ok(verifier instanceof OidcAccessTokenVerifier);
});

test("authing configuration without an issuer fails closed", () => {
  const { MYSTCRAG_AUTH_ISSUER: _issuer, ...withoutIssuer } = productionAuthingEnvironment;
  assert.throws(
    () => createAccessTokenVerifierFromEnvironment(withoutIssuer),
    /MYSTCRAG_AUTH_ISSUER/
  );
});

test("authing configuration without an audience fails closed", () => {
  const { MYSTCRAG_AUTH_AUDIENCE: _audience, ...withoutAudience } =
    productionAuthingEnvironment;
  assert.throws(
    () => createAccessTokenVerifierFromEnvironment(withoutAudience),
    /MYSTCRAG_AUTH_AUDIENCE/
  );
});

test("the authing issuer must be HTTPS and reject unsafe forms", () => {
  const rejectedIssuers = [
    "http://mystcrag-pool.authing.cn/oidc",
    "not a url",
    "ftp://mystcrag-pool.authing.cn/oidc",
    "https://mystcrag-pool.authing.cn/oidc#fragment",
    "https://mystcrag-pool.authing.cn/oidc?query=1",
    "https://mystcrag-pool.authing.cn/custom-path",
    "https://evil.example.com/oidc",
    "https://user:pass@mystcrag-pool.authing.cn/oidc",
    "https://localhost/oidc",
    "https://LOCALHOST/oidc",
    "https://127.0.0.1/oidc",
    "https://[::1]/oidc"
  ];
  for (const issuer of rejectedIssuers) {
    assert.throws(
      () =>
        createAccessTokenVerifierFromEnvironment({
          ...productionAuthingEnvironment,
          MYSTCRAG_AUTH_ISSUER: issuer
        }),
      { message: /MYSTCRAG_AUTH_ISSUER/ },
      `issuer=${issuer} must be rejected`
    );
  }
});

test("the authing issuer host must be an exact DNS hostname", () => {
  const rejectedIssuers = [
    "https://*.authing.cn/oidc",
    "https://pool.*.authing.cn/oidc",
    "https://8.8.8.8/oidc",
    "https://192.168.1.10/oidc"
  ];
  for (const issuer of rejectedIssuers) {
    assert.throws(
      () =>
        createAccessTokenVerifierFromEnvironment({
          ...productionAuthingEnvironment,
          MYSTCRAG_AUTH_ISSUER: issuer
        }),
      { message: /MYSTCRAG_AUTH_ISSUER/ },
      `issuer=${issuer} must be rejected`
    );
  }
});

test("Authing /oidc issuers are accepted with or without a trailing slash", () => {
  for (const issuer of [
    "https://mystcrag-pool.authing.cn/oidc",
    "https://mystcrag-pool.authing.cn/oidc/",
    "https://login.authing.cn/oidc"
  ]) {
    const verifier = createAccessTokenVerifierFromEnvironment({
      ...productionAuthingEnvironment,
      MYSTCRAG_AUTH_ISSUER: issuer
    });
    assert.ok(verifier instanceof OidcAccessTokenVerifier, `issuer=${issuer}`);
  }
});

test("root-path HTTPS Authing issuers remain accepted", () => {
  const verifier = createAccessTokenVerifierFromEnvironment({
    ...productionAuthingEnvironment,
    MYSTCRAG_AUTH_ISSUER: "https://login.authing.cn/"
  });
  assert.ok(verifier instanceof OidcAccessTokenVerifier);
});

test("untrusted custom hosts are rejected unless allowlisted", () => {
  assert.throws(
    () =>
      createAccessTokenVerifierFromEnvironment({
        ...productionAuthingEnvironment,
        MYSTCRAG_AUTH_ISSUER: "https://auth.mystcrag.example.com/"
      }),
    /MYSTCRAG_AUTH_ISSUER/
  );
  const verifier = createAccessTokenVerifierFromEnvironment({
    ...productionAuthingEnvironment,
    MYSTCRAG_AUTH_ISSUER: "https://auth.mystcrag.example.com/",
    MYSTCRAG_AUTH_ISSUER_HOST_ALLOWLIST: "auth.mystcrag.example.com"
  });
  assert.ok(verifier instanceof OidcAccessTokenVerifier);
});

test("issuer is passed to the verifier exactly as configured", async () => {
  const withoutSlash = createAccessTokenVerifierFromEnvironment({
    ...productionAuthingEnvironment,
    MYSTCRAG_AUTH_ISSUER: "https://mystcrag-pool.authing.cn/oidc"
  });
  const withSlash = createAccessTokenVerifierFromEnvironment({
    ...productionAuthingEnvironment,
    MYSTCRAG_AUTH_ISSUER: "https://mystcrag-pool.authing.cn/oidc/"
  });
  assert.ok(withoutSlash instanceof OidcAccessTokenVerifier);
  assert.ok(withSlash instanceof OidcAccessTokenVerifier);
});

test("development and test also require an HTTPS authing issuer", () => {
  assert.throws(
    () =>
      createAccessTokenVerifierFromEnvironment({
        ...developmentAuthingEnvironment,
        MYSTCRAG_AUTH_ISSUER: "http://mystcrag-pool.authing.cn/oidc"
      }),
    /MYSTCRAG_AUTH_ISSUER/
  );
  assert.throws(
    () =>
      createAccessTokenVerifierFromEnvironment({
        ...developmentAuthingEnvironment,
        MYSTCRAG_AUTH_ISSUER: "https://localhost/oidc"
      }),
    /MYSTCRAG_AUTH_ISSUER/
  );
  assert.ok(
    createAccessTokenVerifierFromEnvironment(developmentAuthingEnvironment) instanceof
      OidcAccessTokenVerifier
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
