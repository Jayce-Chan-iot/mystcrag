import assert from "node:assert/strict";
import test from "node:test";

import Fastify, { type FastifyInstance } from "fastify";
import { createPrismaClient, ExternalIdentityRepository } from "@mystcrag/database";

import { AuthenticatedActorProvider } from "./authenticated-actor-provider.js";
import { actorIdFromVerifiedContext, createAuthenticationPreHandler, type AccessTokenVerifier } from "./auth-provider.js";
import { SignedTestTokenAuthProvider, signTestAccessToken } from "./signed-test-auth-provider.js";
import { DomainApiError, toApiErrorEnvelope } from "../contracts/api-error.js";

const databaseUrl = process.env.DATABASE_URL;

const AUTH_SECRET = "mystcrag-auth004-integration-secret-2026";
const ISSUER_A = "https://tenant-a.auth0.example.com/";
const ISSUER_B = "https://tenant-b.auth0.example.com/";
const AUDIENCE = "mystcrag-backend";

function tokenFor(provider: SignedTestTokenAuthProvider, subject: string): string {
  return signTestAccessToken(
    {
      subject,
      issuer: provider === verifierA ? ISSUER_A : ISSUER_B,
      audience: AUDIENCE,
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 900
    },
    AUTH_SECRET
  );
}

const verifierA = new SignedTestTokenAuthProvider({
  secret: AUTH_SECRET,
  issuer: ISSUER_A,
  audience: AUDIENCE
});
const verifierB = new SignedTestTokenAuthProvider({
  secret: AUTH_SECRET,
  issuer: ISSUER_B,
  audience: AUDIENCE
});

type OwnerScopedHarness = {
  app: FastifyInstance;
  owners: Map<string, string>;
};

function ownerScopedApp(provider: AuthenticatedActorProvider): OwnerScopedHarness {
  const app = Fastify({ logger: false });
  const owners = new Map<string, string>();
  const authenticate = createAuthenticationPreHandler(provider);

  app.post<{ Params: { id: string } }>(
    "/owned/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const actorId = actorIdFromVerifiedContext(request);
      const { id } = request.params;
      if (owners.has(id)) {
        const error = new DomainApiError("CONFLICT", "Resource already exists.");
        return reply.status(error.statusCode).send(toApiErrorEnvelope(error, request.id));
      }
      owners.set(id, actorId);
      return { owner: actorId };
    }
  );

  app.get<{ Params: { id: string } }>(
    "/owned/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const actorId = actorIdFromVerifiedContext(request);
      const owner = owners.get(request.params.id);
      if (owner !== actorId) {
        const error = new DomainApiError(
          "FORBIDDEN",
          "You do not have access to this resource."
        );
        return reply.status(error.statusCode).send(toApiErrorEnvelope(error, request.id));
      }
      return { owner: actorId };
    }
  );

  return { app, owners };
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

test(
  "authenticated actor mapping and owner isolation against a real database",
  { skip: !databaseUrl },
  async () => {
    const prisma = createPrismaClient(databaseUrl);
    const identities = new ExternalIdentityRepository(prisma);
    const run = Date.now();
    const subjectA = `auth0|matrix-a-${run}`;
    const subjectB = `auth0|matrix-b-${run}`;
    const sharedSubject = `auth0|shared-${run}`;

    await prisma.$connect();
    try {
      const harness = ownerScopedApp(
        new AuthenticatedActorProvider({ provider: verifierA, identities })
      );
      const tokenA = tokenFor(verifierA, subjectA);
      const tokenB = tokenFor(verifierA, subjectB);

      const created = await harness.app.inject({
        method: "POST",
        url: "/owned/design-alpha",
        headers: bearer(tokenA)
      });
      assert.equal(created.statusCode, 200);
      const actorA = created.json().owner as string;
      assert.notEqual(actorA, subjectA, "actorId must be the internal User.id, not the subject");
      const userA = await prisma.user.findUnique({ where: { id: actorA } });
      assert.ok(userA, "actorId must reference a persisted internal user row");
      const identityA = await prisma.externalIdentity.findUnique({
        where: { issuer_subject: { issuer: ISSUER_A, subject: subjectA } }
      });
      assert.ok(identityA);
      assert.equal(identityA.userId, actorA);

      const reread = await harness.app.inject({
        method: "GET",
        url: "/owned/design-alpha",
        headers: bearer(tokenA)
      });
      assert.equal(reread.statusCode, 200);
      assert.equal(reread.json().owner, actorA, "the same identity maps to the same actor");

      const foreignRead = await harness.app.inject({
        method: "GET",
        url: "/owned/design-alpha",
        headers: bearer(tokenB)
      });
      assert.equal(foreignRead.statusCode, 403);
      assert.equal(foreignRead.json().error.code, "FORBIDDEN");
      assert.equal(
        foreignRead.json().error.message,
        "You do not have access to this resource.",
        "the rejection must not reveal whether the resource exists"
      );

      const createdB = await harness.app.inject({
        method: "POST",
        url: "/owned/design-beta",
        headers: bearer(tokenB)
      });
      assert.equal(createdB.statusCode, 200);
      const actorB = createdB.json().owner as string;
      assert.notEqual(actorB, actorA, "two subjects must map to two distinct internal actors");
      const reverseRead = await harness.app.inject({
        method: "GET",
        url: "/owned/design-beta",
        headers: bearer(tokenA)
      });
      assert.equal(reverseRead.statusCode, 403);

      const noToken = await harness.app.inject({ method: "GET", url: "/owned/design-alpha" });
      assert.equal(noToken.statusCode, 401);
      assert.equal(noToken.json().error.code, "UNAUTHORIZED");
      const invalidToken = await harness.app.inject({
        method: "GET",
        url: "/owned/design-alpha",
        headers: bearer(signTestAccessToken(
          {
            subject: subjectA,
            issuer: ISSUER_A,
            audience: AUDIENCE,
            expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 900
          },
          "wrong-secret-mystcrag-auth004-integration"
        ))
      });
      assert.equal(invalidToken.statusCode, 401);
      assert.equal(invalidToken.json().error.code, "UNAUTHORIZED");
      await harness.app.close();

      const multiIssuerVerifier: AccessTokenVerifier = {
        async verifyAccessToken(token) {
          try {
            return await verifierA.verifyAccessToken(token);
          } catch {
            return verifierB.verifyAccessToken(token);
          }
        }
      };
      const harnessB = ownerScopedApp(
        new AuthenticatedActorProvider({ provider: multiIssuerVerifier, identities })
      );
      const fromA = await harnessB.app.inject({
        method: "POST",
        url: `/owned/shared-${run}`,
        headers: bearer(tokenFor(verifierA, sharedSubject))
      });
      assert.equal(fromA.statusCode, 200);
      const fromB = await harnessB.app.inject({
        method: "GET",
        url: `/owned/shared-${run}`,
        headers: bearer(tokenFor(verifierB, sharedSubject))
      });
      assert.equal(fromB.statusCode, 403, "the same subject under a second issuer must not merge");
      const sharedRows = await prisma.externalIdentity.findMany({
        where: { subject: sharedSubject }
      });
      assert.equal(sharedRows.length, 2);
      assert.notEqual(sharedRows[0]!.userId, sharedRows[1]!.userId);
      await harnessB.app.close();
    } finally {
      await prisma.$disconnect();
    }
  }
);
