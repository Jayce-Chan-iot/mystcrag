import assert from "node:assert/strict";
import test from "node:test";

import { createPrismaClient } from "../client/prisma-client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import { ExternalIdentityRepository } from "./identity.repository.js";

const databaseUrl = process.env.DATABASE_URL;

const ISSUER_A = "https://tenant-a.auth0.example.com/";
const ISSUER_B = "https://tenant-b.auth0.example.com/";
const CONCURRENCY = 20;

test("external identity persistence matrix", { skip: !databaseUrl }, async (t) => {
  const prisma = createPrismaClient(databaseUrl);
  const repository = new ExternalIdentityRepository(prisma);
  const prefix = `auth003-${Date.now()}`;
  const keyOf = (label: string) => `${prefix}-${label}`;
  const matrixStartedAt = new Date().toISOString();

  await prisma.$connect();
  try {
    await t.test("1. same issuer + subject always returns the same actor", async () => {
      const subject = keyOf("stable-subject");
      const first = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject,
        email: "first@example.test",
        emailVerified: true,
        displayName: "First"
      });
      assert.equal(first.created, true);
      const second = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject
      });
      assert.equal(second.created, false);
      assert.equal(second.identityId, first.identityId);
      assert.equal(second.actorId, first.actorId);
      const third = await repository.findOrProvisionExternalIdentity({
        issuer: `  ${ISSUER_A}  `,
        subject: `  ${subject}  `
      });
      assert.equal(third.actorId, first.actorId);
      assert.equal(third.created, false);
    });

    await t.test("2. same subject under a different issuer is a distinct identity and user", async () => {
      const subject = keyOf("shared-subject");
      const fromA = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject
      });
      const fromB = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_B,
        subject
      });
      assert.notEqual(fromA.identityId, fromB.identityId);
      assert.notEqual(fromA.actorId, fromB.actorId);
      const rows = await prisma.externalIdentity.findMany({
        where: { subject, issuer: { in: [ISSUER_A, ISSUER_B] } }
      });
      assert.equal(rows.length, 2);
    });

    await t.test("3. shared email never merges accounts", async () => {
      const sharedEmail = `${prefix}-shared@example.test`;
      const left = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject: keyOf("email-left"),
        email: sharedEmail,
        emailVerified: true
      });
      const right = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_B,
        subject: keyOf("email-right"),
        email: sharedEmail.toUpperCase(),
        emailVerified: true
      });
      assert.notEqual(left.actorId, right.actorId);
      const identities = await prisma.externalIdentity.findMany({
        where: { email: sharedEmail }
      });
      assert.equal(identities.length, 2);
      assert.notEqual(identities[0]!.userId, identities[1]!.userId);
    });

    await t.test("4. email changes update the hint without changing actorId", async () => {
      const subject = keyOf("email-change");
      const initial = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject,
        email: "before@example.test"
      });
      const updated = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject,
        email: "after@example.test"
      });
      assert.equal(updated.actorId, initial.actorId);
      assert.equal(updated.identityId, initial.identityId);
      assert.equal(updated.email, "after@example.test");
    });

    await t.test("5. displayName changes update the hint without changing actorId", async () => {
      const subject = keyOf("name-change");
      const initial = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject,
        displayName: "Before"
      });
      const updated = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject,
        displayName: "After"
      });
      assert.equal(updated.actorId, initial.actorId);
      assert.equal(updated.displayName, "After");
    });

    await t.test("6. emailVerified changes update the hint without changing actorId", async () => {
      const subject = keyOf("verified-change");
      const initial = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject,
        emailVerified: false
      });
      const updated = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject,
        emailVerified: true
      });
      assert.equal(updated.actorId, initial.actorId);
      assert.equal(updated.emailVerified, true);
    });

    await t.test("7. omitted hints keep the persisted values", async () => {
      const subject = keyOf("omit-hints");
      const initial = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject,
        email: "kept@example.test",
        emailVerified: true,
        displayName: "Kept"
      });
      const omitted = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject
      });
      assert.equal(omitted.email, "kept@example.test");
      assert.equal(omitted.emailVerified, true);
      assert.equal(omitted.displayName, "Kept");
      assert.equal(omitted.actorId, initial.actorId);
    });

    await t.test("8. provider email is never copied into users.email", async () => {
      const subject = keyOf("no-user-email");
      const result = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject,
        email: "hint-only@example.test"
      });
      const user = await prisma.user.findUnique({ where: { id: result.actorId } });
      assert.ok(user);
      assert.equal(user.email, null);
    });

    await t.test(`9. ${CONCURRENCY} concurrent first logins yield one identity, one user, one actorId`, async () => {
      const issuer = `https://race-${prefix}.auth0.example.com/`;
      const subject = keyOf("race-subject");
      const usersBefore = await prisma.user.count();
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, index) =>
          repository.findOrProvisionExternalIdentity({
            issuer,
            subject,
            email: "race@example.test",
            emailVerified: index % 2 === 0,
            displayName: `Racer ${index}`
          })
        )
      );
      const actorIds = new Set(results.map(({ actorId }) => actorId));
      const identityIds = new Set(results.map(({ identityId }) => identityId));
      assert.equal(actorIds.size, 1);
      assert.equal(identityIds.size, 1);
      const createdCount = results.filter(({ created }) => created).length;
      assert.equal(createdCount, 1);
      const identities = await prisma.externalIdentity.findMany({ where: { issuer, subject } });
      assert.equal(identities.length, 1);
      const usersAfter = await prisma.user.count();
      assert.equal(usersAfter - usersBefore, 1);
      const mappedUsers = await prisma.user.findMany({
        where: { externalIdentities: { some: { issuer, subject } } }
      });
      assert.equal(mappedUsers.length, 1);
      assert.equal(mappedUsers[0]!.id, [...actorIds][0]);
    });

    await t.test("10. an existing mapping cannot be silently remapped", async () => {
      const issuer = `https://remap-${prefix}.auth0.example.com/`;
      const subject = keyOf("remap-subject");
      const original = await repository.findOrProvisionExternalIdentity({
        issuer,
        subject
      });
      const rival = await prisma.user.create({ data: {} });
      await assert.rejects(
        prisma.externalIdentity.create({
          data: { issuer, subject, userId: rival.id }
        }),
        (error: unknown) => {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? String((error as { code?: unknown }).code)
              : undefined;
          assert.equal(code, "P2002");
          return true;
        }
      );
      const reread = await repository.findOrProvisionExternalIdentity({ issuer, subject });
      assert.equal(reread.actorId, original.actorId);
      await prisma.user.delete({ where: { id: rival.id } });
    });

    await t.test("11. invalid issuer or subject fails deterministically", async () => {
      for (const input of [
        { issuer: "", subject: keyOf("invalid-key") },
        { issuer: ISSUER_A, subject: "" },
        { issuer: "   ", subject: keyOf("invalid-key") },
        { issuer: ISSUER_A, subject: "x".repeat(513) }
      ]) {
        await assert.rejects(
          repository.findOrProvisionExternalIdentity(input),
          (error: unknown) => {
            assert.ok(error instanceof PersistenceError);
            assert.equal(error.code, "VALIDATION_ERROR");
            return true;
          }
        );
      }
    });

    await t.test("12. external identity foreign key is RESTRICT on delete", async () => {
      const constraints = await prisma.$queryRawUnsafe<
        Array<{ confdeltype: string; fknname: string }>
      >(
        `SELECT conname AS "fknname", confdeltype::text AS "confdeltype"
           FROM pg_constraint
          WHERE conrelid = '"external_identities"'::regclass
            AND contype = 'f'`
      );
      const userForeignKey = constraints.find(({ fknname }) =>
        fknname.startsWith("external_identities_user_id")
      );
      assert.ok(userForeignKey, "user_id foreign key must exist");
      assert.equal(userForeignKey.confdeltype, "r");

      const subject = keyOf("restrict-check");
      const mapping = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject
      });
      await assert.rejects(
        prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, mapping.actorId),
        (error: unknown) => {
          assert.match(String((error as Error).message), /foreign key/i);
          return true;
        }
      );
    });

    await t.test("13. provisioned actorId is a business-resource owner id", async () => {
      const subject = keyOf("business-owner");
      const mapping = await repository.findOrProvisionExternalIdentity({
        issuer: ISSUER_A,
        subject,
        email: "owner@example.test"
      });
      const designId = `${prefix}-design`;
      await prisma.design.create({
        data: {
          id: designId,
          ownerId: mapping.actorId,
          name: "AUTH-003 verification design",
          mode: "AI_GENERATED",
          schemaVersion: "1.0.0",
          locale: "zh-CN",
          currency: "CNY",
          currentSnapshot: { verification: prefix },
          complianceStatus: "PASSED"
        }
      });
      const owner = await prisma.design.findUnique({ where: { id: designId } });
      assert.equal(owner?.ownerId, mapping.actorId);
      assert.notEqual(owner?.ownerId, subject);
    });

    await t.test("14. no orphan users are left behind by the matrix", async () => {
      const orphans = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count
           FROM users u
          WHERE u.created_at >= '${matrixStartedAt}'::timestamptz
            AND NOT EXISTS (SELECT 1 FROM external_identities ei WHERE ei.user_id = u.id)`
      );
      assert.equal(orphans[0]?.count ?? "0", "0");
    });
  } finally {
    await prisma.$disconnect();
  }
});
