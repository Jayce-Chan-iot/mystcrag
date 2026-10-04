import assert from "node:assert/strict";
import test from "node:test";

import { DesignV1Schema, type DesignV1 } from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { createPrismaClient } from "../client/prisma-client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import { DesignRepository } from "./design.repository.js";

const databaseUrl = process.env.DATABASE_URL;

function oneBeadDesign(designId: string): DesignV1 {
  const fixture = structuredClone(standardAiDesignFixture);
  const bead = fixture.beads[0];
  if (!bead) throw new Error("The standard fixture must contain at least one bead");
  const materialSubtotalMinor = bead.unitPriceMinor;
  return DesignV1Schema.parse({
    ...fixture,
    designId,
    designName: "First bead",
    designMode: "DIY_CREATED",
    revision: 1,
    beads: [{ ...bead, positionIndex: 0 }],
    accessories: [],
    bracelet: { ...fixture.bracelet, totalBeadCount: 1 },
    pricing: {
      ...fixture.pricing,
      materialSubtotalMinor,
      accessorySubtotalMinor: 0,
      totalPriceMinor:
        materialSubtotalMinor +
        fixture.pricing.laborFeeMinor +
        fixture.pricing.designFeeMinor +
        fixture.pricing.packagingFeeMinor +
        fixture.pricing.platformFeeEstimateMinor +
        fixture.pricing.logisticsFeeEstimateMinor -
        fixture.pricing.discountMinor
    },
    production: {
      ...fixture.production,
      billOfMaterials: [
        {
          productId: bead.beadProductId,
          specification: `${bead.shape} ${bead.diameterMm}mm`,
          quantity: 1,
          sourceComponentIds: [bead.componentId]
        }
      ],
      componentSequence: [bead.componentId],
      anchoredComponents: []
    },
    provenance: {
      ...fixture.provenance,
      generatedBy: "USER",
      modelProvider: null,
      modelName: null,
      promptVersion: null,
      knowledgeBaseVersion: null,
      designTemplateVersion: null,
      sourceDesignId: null
    }
  });
}

test("live first-bead idempotent creation matrix", { skip: !databaseUrl }, async (t) => {
  const prisma = createPrismaClient(databaseUrl);
  const repository = new DesignRepository(prisma);
  const prefix = `diy-first-bead-${Date.now()}`;
  const fingerprint = "fingerprint-a";
  const key = (label: string) => `${prefix}-${label}`;

  await prisma.$connect();
  const userA = await prisma.user.create({ data: {} });
  const userB = await prisma.user.create({ data: {} });
  try {
    await t.test("1. sequential replay returns the original revision-1 design", async () => {
      const design = oneBeadDesign(`${prefix}-seq`);
      const first = await repository.createFirstBeadIdempotently(
        userA.id,
        key("seq"),
        fingerprint,
        design
      );
      const second = await repository.createFirstBeadIdempotently(
        userA.id,
        key("seq"),
        fingerprint,
        design
      );

      assert.equal(second.id, first.id);
      const rows = await prisma.design.findMany({
        where: { ownerId: userA.id, creationRequestId: key("seq") }
      });
      assert.equal(rows.length, 1);
      const revisions = await prisma.designRevision.findMany({ where: { designId: first.id } });
      assert.equal(revisions.length, 1);
      assert.equal(revisions[0]!.revisionNumber, 1);

      const replay = await repository.findFirstBeadByRequest(userA.id, key("seq"), fingerprint);
      assert.equal(replay?.id, first.id);
      assert.deepEqual(replay?.snapshot, design);
    });

    await t.test("2. concurrent creation collapses to one design and one revision", async () => {
      const design = oneBeadDesign(`${prefix}-race`);
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          repository.createFirstBeadIdempotently(userA.id, key("race"), fingerprint, design)
        )
      );

      const ids = new Set(results.map(({ id }) => id));
      assert.equal(ids.size, 1);
      const rows = await prisma.design.findMany({
        where: { ownerId: userA.id, creationRequestId: key("race") }
      });
      assert.equal(rows.length, 1);
      const revisions = await prisma.designRevision.findMany({
        where: { designId: [...ids][0]! }
      });
      assert.equal(revisions.length, 1);
    });

    await t.test("3. same key with a different fingerprint conflicts without a second design", async () => {
      const design = oneBeadDesign(`${prefix}-conflict`);
      await repository.createFirstBeadIdempotently(userA.id, key("conflict"), fingerprint, design);

      await assert.rejects(
        repository.createFirstBeadIdempotently(
          userA.id,
          key("conflict"),
          "different-fingerprint",
          oneBeadDesign(`${prefix}-conflict-other`)
        ),
        (error: unknown) => {
          assert.ok(error instanceof PersistenceError);
          assert.equal(error.code, "CONFLICT");
          return true;
        }
      );

      const rows = await prisma.design.findMany({
        where: { ownerId: userA.id, creationRequestId: key("conflict") }
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.id, design.designId);
    });

    await t.test("4. different actors never share a design for the same key", async () => {
      const designA = oneBeadDesign(`${prefix}-user-a`);
      const designB = oneBeadDesign(`${prefix}-user-b`);
      const fromA = await repository.createFirstBeadIdempotently(
        userA.id,
        key("shared"),
        fingerprint,
        designA
      );
      const fromB = await repository.createFirstBeadIdempotently(
        userB.id,
        key("shared"),
        fingerprint,
        designB
      );

      assert.notEqual(fromA.id, fromB.id);
      const rows = await prisma.design.findMany({ where: { creationRequestId: key("shared") } });
      assert.equal(rows.length, 2);
      assert.deepEqual(
        new Set(rows.map(({ ownerId }) => ownerId)),
        new Set([userA.id, userB.id])
      );
    });

    await t.test("5. owner-scoped lookup never returns another actor's design", async () => {
      const design = oneBeadDesign(`${prefix}-scoped`);
      await repository.createFirstBeadIdempotently(userA.id, key("scoped"), fingerprint, design);

      const forB = await repository.findFirstBeadByRequest(userB.id, key("scoped"), fingerprint);
      assert.equal(forB, null);
    });

    await t.test("6. legacy rows without a creation request stay readable", async () => {
      const legacyOne = oneBeadDesign(`${prefix}-legacy-1`);
      const legacyTwo = oneBeadDesign(`${prefix}-legacy-2`);
      await repository.createDesign(userA.id, legacyOne);
      await repository.createDesign(userA.id, legacyTwo);

      const legacyRows = await prisma.design.findMany({
        where: { ownerId: userA.id, creationRequestId: null }
      });
      assert.ok(legacyRows.length >= 2);
      const read = await repository.getDesign(userA.id, legacyOne.designId);
      assert.equal(read.id, legacyOne.designId);
    });

    await t.test("7. a zero-bead snapshot is rejected and never persisted", async () => {
      const zeroBead = { ...oneBeadDesign(`${prefix}-zero`), beads: [] };
      await assert.rejects(
        repository.createFirstBeadIdempotently(
          userA.id,
          key("zero"),
          fingerprint,
          zeroBead as unknown as DesignV1
        ),
        (error: unknown) => {
          assert.ok(error instanceof PersistenceError);
          assert.equal(error.code, "VALIDATION_ERROR");
          return true;
        }
      );

      const rows = await prisma.design.findMany({
        where: { ownerId: userA.id, creationRequestId: key("zero") }
      });
      assert.equal(rows.length, 0);
    });

    await t.test("8. the database enforces one design per owner and request key", async () => {
      const design = oneBeadDesign(`${prefix}-db-unique`);
      await repository.createFirstBeadIdempotently(
        userA.id,
        key("db-unique"),
        fingerprint,
        design
      );

      await assert.rejects(
        prisma.design.create({
          data: {
            id: `${prefix}-db-unique-rival`,
            ownerId: userA.id,
            name: "Rival",
            mode: "DIY_CREATED",
            schemaVersion: design.schemaVersion,
            currentRevision: 1,
            locale: design.locale,
            currency: design.currency,
            currentSnapshot: {},
            complianceStatus: design.compliance.complianceStatus,
            creationRequestId: key("db-unique"),
            creationRequestFingerprint: "rival-fingerprint"
          }
        }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "P2002");
          return true;
        }
      );
    });
  } finally {
    await prisma.$disconnect();
  }
});
