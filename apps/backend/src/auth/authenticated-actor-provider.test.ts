import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import {
  CredentialRejectedError,
  IdentityMappingFailedError,
  ProviderUnavailableError
} from "./auth-errors.js";
import {
  AuthenticatedActorProvider,
  type ExternalIdentityMappingPort
} from "./authenticated-actor-provider.js";
import {
  createAuthenticationPreHandler,
  type AccessTokenVerifier,
  type ActorContext,
  type AuthProvider,
  type VerifiedAuthClaims
} from "./auth-provider.js";

type ScriptedVerifier = AccessTokenVerifier & {
  script: (token: string) => Promise<VerifiedAuthClaims>;
};

function scriptedVerifier(script: ScriptedVerifier["script"]): ScriptedVerifier {
  return { verifyAccessToken: script, script };
}

type ScriptedIdentities = ExternalIdentityMappingPort & {
  readonly calls: Array<{
    issuer: string;
    subject: string;
    email?: string;
    emailVerified?: boolean;
    displayName?: string;
  }>;
};

function scriptedIdentities(
  resolve: (input: ScriptedIdentities["calls"][number]) => Promise<{ actorId: string }>
): ScriptedIdentities {
  const calls: ScriptedIdentities["calls"] = [];
  return {
    calls,
    async findOrProvisionExternalIdentity(input) {
      calls.push(input);
      return resolve(input);
    }
  };
}

const BASE_CLAIMS: VerifiedAuthClaims = {
  subject: "auth0|shared-subject",
  issuer: "https://tenant-a.auth0.example.com/",
  audience: ["https://api.mystcrag.example.com"],
  expiresAtEpochSeconds: 1_700_000_900
};

test("a verified token is mapped to an internal actor before use", async () => {
  const identities = scriptedIdentities(async () => ({ actorId: "user-internal-1" }));
  const provider = new AuthenticatedActorProvider({
    provider: scriptedVerifier(async () => ({
      ...BASE_CLAIMS,
      email: "ada@mystcrag.example.com",
      emailVerified: true,
      displayName: "Ada"
    })),
    identities
  });

  const actorContext = await provider.authenticateAccessToken("token-1");

  assert.equal(actorContext.actorId, "user-internal-1");
  assert.notEqual(actorContext.actorId, BASE_CLAIMS.subject);
  assert.equal(actorContext.claims.subject, BASE_CLAIMS.subject);
  assert.equal(identities.calls.length, 1);
  assert.equal(identities.calls[0]?.issuer, BASE_CLAIMS.issuer);
  assert.equal(identities.calls[0]?.subject, BASE_CLAIMS.subject);
  assert.equal(identities.calls[0]?.email, "ada@mystcrag.example.com");
  assert.equal(identities.calls[0]?.emailVerified, true);
  assert.equal(identities.calls[0]?.displayName, "Ada");
});

test("profile hints are not forwarded when the token carries none", async () => {
  const identities = scriptedIdentities(async () => ({ actorId: "user-internal-2" }));
  const provider = new AuthenticatedActorProvider({
    provider: scriptedVerifier(async () => ({ ...BASE_CLAIMS })),
    identities
  });

  await provider.authenticateAccessToken("token-2");

  assert.deepEqual(Object.keys(identities.calls[0]!).sort(), ["issuer", "subject"]);
});

test("an invalid token never reaches the identity mapping", async () => {
  const identities = scriptedIdentities(async () => ({ actorId: "user-internal-3" }));
  const provider = new AuthenticatedActorProvider({
    provider: scriptedVerifier(() =>
      Promise.reject(new CredentialRejectedError("signature", "kid-a"))
    ),
    identities
  });

  await assert.rejects(
    provider.authenticateAccessToken("forged"),
    CredentialRejectedError
  );
  assert.equal(identities.calls.length, 0);
});

test("provider unavailability never reaches the identity mapping", async () => {
  const identities = scriptedIdentities(async () => ({ actorId: "user-internal-4" }));
  const provider = new AuthenticatedActorProvider({
    provider: scriptedVerifier(() =>
      Promise.reject(new ProviderUnavailableError("jwks outage"))
    ),
    identities
  });

  await assert.rejects(provider.authenticateAccessToken("token"), ProviderUnavailableError);
  assert.equal(identities.calls.length, 0);
});

test("identity mapping failure is classified as an internal error", async () => {
  const identities = scriptedIdentities(async () => {
    throw new Error("database unavailable");
  });
  const provider = new AuthenticatedActorProvider({
    provider: scriptedVerifier(async () => ({ ...BASE_CLAIMS })),
    identities
  });

  await assert.rejects(
    provider.authenticateAccessToken("token"),
    IdentityMappingFailedError
  );
});

test("the same subject under a second issuer is a separate mapping input", async () => {
  const identities = scriptedIdentities(async (input) => ({
    actorId: input.issuer === BASE_CLAIMS.issuer ? "user-internal-a" : "user-internal-b"
  }));
  const issuerB = "https://tenant-b.auth0.example.com/";
  const provider = new AuthenticatedActorProvider({
    provider: scriptedVerifier(async (token) =>
      token === "tenant-a" ? { ...BASE_CLAIMS } : { ...BASE_CLAIMS, issuer: issuerB }
    ),
    identities
  });

  const fromA = await provider.authenticateAccessToken("tenant-a");
  const fromB = await provider.authenticateAccessToken("tenant-b");

  assert.equal(identities.calls.length, 2);
  assert.equal(identities.calls[0]?.issuer, BASE_CLAIMS.issuer);
  assert.equal(identities.calls[1]?.issuer, issuerB);
  assert.equal(identities.calls[0]?.subject, BASE_CLAIMS.subject);
  assert.equal(identities.calls[1]?.subject, BASE_CLAIMS.subject);
  assert.notEqual(fromA.actorId, fromB.actorId);
});

function actorEchoApp(
  provider: AuthProvider,
  handler?: (actorContext: ActorContext) => unknown
) {
  const app = Fastify({ logger: false });
  app.get("/me", { preHandler: createAuthenticationPreHandler(provider) }, async (request) =>
    handler
      ? handler(request.actorContext!)
      : { actorId: request.actorContext?.actorId }
  );
  return app;
}

async function statusAndBody(response: { statusCode: number; body: string }) {
  return { status: response.statusCode, body: JSON.parse(response.body) as Record<string, unknown> };
}

test("the pre-handler sets the internal actor id on the request", async () => {
  const identities = scriptedIdentities(async () => ({ actorId: "user-internal-10" }));
  const provider = new AuthenticatedActorProvider({
    provider: scriptedVerifier(async () => ({ ...BASE_CLAIMS })),
    identities
  });
  const app = actorEchoApp(provider);

  const response = await statusAndBody(
    await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer valid" } })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { actorId: "user-internal-10" });
  assert.notEqual(
    (response.body as { actorId: string }).actorId,
    BASE_CLAIMS.subject,
    "the provider subject must never surface as the actor id"
  );
  assert.equal(identities.calls.length, 1);
  await app.close();
});

test("the pre-handler rejects invalid credentials with the generic envelope", async () => {
  const identities = scriptedIdentities(async () => ({ actorId: "user-internal-11" }));
  const provider = new AuthenticatedActorProvider({
    provider: scriptedVerifier(() =>
      Promise.reject(new CredentialRejectedError("expired", "kid-a"))
    ),
    identities
  });
  const app = actorEchoApp(provider);

  const response = await statusAndBody(
    await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer expired" } })
  );

  assert.equal(response.status, 401);
  assert.equal((response.body.error as { code: string }).code, "UNAUTHORIZED");
  assert.equal(
    (response.body.error as { message: string }).message,
    "Authentication is required."
  );
  assert.equal(identities.calls.length, 0);
  await app.close();
});

test("the pre-handler rejects missing or malformed bearer credentials", async () => {
  const identities = scriptedIdentities(async () => ({ actorId: "user-internal-12" }));
  const provider = new AuthenticatedActorProvider({
    provider: scriptedVerifier(async () => ({ ...BASE_CLAIMS })),
    identities
  });
  const app = actorEchoApp(provider);

  for (const authorization of [undefined, "Token abc", "Bearer", "Bearer  two"]) {
    const response = await statusAndBody(
      await app.inject({
        method: "GET",
        url: "/me",
        ...(authorization === undefined ? {} : { headers: { authorization } })
      })
    );
    assert.equal(response.status, 401, `authorization=${authorization}`);
    assert.equal((response.body.error as { code: string }).code, "UNAUTHORIZED");
  }

  assert.equal(identities.calls.length, 0);
  await app.close();
});

test("the pre-handler maps jwks unavailability to the internal error envelope", async () => {
  const identities = scriptedIdentities(async () => ({ actorId: "user-internal-13" }));
  const provider = new AuthenticatedActorProvider({
    provider: scriptedVerifier(() =>
      Promise.reject(new ProviderUnavailableError("jwks outage"))
    ),
    identities
  });
  const app = actorEchoApp(provider);

  const response = await statusAndBody(
    await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer t" } })
  );

  assert.equal(response.status, 500);
  assert.equal((response.body.error as { code: string }).code, "INTERNAL_ERROR");
  assert.equal(identities.calls.length, 0);
  await app.close();
});

test("the pre-handler maps identity mapping failure to the internal error envelope", async () => {
  const identities = scriptedIdentities(async () => {
    throw new Error("database unavailable");
  });
  const provider = new AuthenticatedActorProvider({
    provider: scriptedVerifier(async () => ({ ...BASE_CLAIMS })),
    identities
  });
  const app = actorEchoApp(provider);

  const response = await statusAndBody(
    await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer t" } })
  );

  assert.equal(response.status, 500);
  assert.equal((response.body.error as { code: string }).code, "INTERNAL_ERROR");
  await app.close();
});

test("a bare verifier without actor composition fails closed", async () => {
  const bareVerifier = scriptedVerifier(async () => ({ ...BASE_CLAIMS }));
  const app = actorEchoApp(bareVerifier as unknown as AuthProvider);

  const response = await statusAndBody(
    await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer legacy" } })
  );

  assert.equal(response.status, 500);
  assert.equal((response.body.error as { code: string }).code, "INTERNAL_ERROR");
  assert.deepEqual(response.body, {
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal error occurred.",
      requestId: (response.body.error as { requestId: string }).requestId
    }
  });
  await app.close();
});

test("an unrecognized internal failure fails closed as an internal error", async () => {
  const provider: AuthProvider = {
    async authenticateAccessToken() {
      throw new Error("unexpected internal state");
    }
  };
  const app = actorEchoApp(provider);

  const response = await statusAndBody(
    await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer t" } })
  );

  assert.equal(response.status, 500);
  assert.equal((response.body.error as { code: string }).code, "INTERNAL_ERROR");
  await app.close();
});
