import assert from "node:assert/strict";
import test from "node:test";

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
});

test("production fails safely when authentication is not configured", () => {
  assert.throws(
    () => createAuthProviderFromEnvironment({ NODE_ENV: "production" }),
    /not configured/
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
