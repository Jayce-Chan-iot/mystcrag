import assert from "node:assert/strict";
import test from "node:test";

import { DesignV1Schema, type DesignV1 } from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { createPrismaClient } from "../client/prisma-client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import { DesignRepository } from "./design.repository.js";
import { OrderRepository } from "./order.repository.js";
import { ProductRepository } from "./product.repository.js";
import { PublicationRepository } from "./publication.repository.js";

const databaseUrl = process.env.DATABASE_URL;
const migrationName = "20260721140000_init_mystcrag_persistence_v1";

function nextRevision(
  input: DesignV1,
  revision: number,
  changes: Partial<DesignV1> = {}
): DesignV1 {
  return DesignV1Schema.parse({
    ...structuredClone(input),
    ...changes,
    revision,
    updatedAt: `2026-07-21T${String(6 + revision).padStart(2, "0")}:00:00.000Z`
  });
}

test("live PostgreSQL 17 persistence verification matrix", { skip: !databaseUrl }, async (t) => {
  const prisma = createPrismaClient(databaseUrl);
  const actorId = "postgres-verification-user";
  const designs = new DesignRepository(prisma);
  const publications = new PublicationRepository(prisma);
  const orders = new OrderRepository(prisma);
  const products = new ProductRepository(prisma);

  await prisma.$connect();
  try {
    await t.test("1. PostgreSQL 17 and the reviewed baseline migration are active", async () => {
      const versionRows = await prisma.$queryRawUnsafe<
        Array<{ server_version: string }>
      >("SHOW server_version");
      const serverVersion = versionRows[0]?.server_version;
      assert.ok(serverVersion);
      assert.match(serverVersion, /^17\./);
      const migrations = await prisma.$queryRawUnsafe<
        Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
      >(
        'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at'
      );
      assert.deepEqual(migrations.map(({ migration_name }) => migration_name), [migrationName]);
      assert.ok(migrations[0]?.finished_at);
      assert.equal(migrations[0]?.rolled_back_at, null);
      console.log(
        `POSTGRES_VERIFICATION_ENV version=${serverVersion} migration=${migrationName}`
      );
    });

    await prisma.user.create({
      data: { id: actorId, email: "postgres-verification@mystcrag.example" }
    });
    for (const crystal of [
      ["crystal-aquamarine", "海蓝宝", "Aquamarine", "Beryl"],
      ["crystal-moonstone", "月光石", "Moonstone", "Feldspar"],
      ["crystal-clear-quartz", "白水晶", "Clear Quartz", "Quartz"]
    ] as const) {
      await prisma.crystal.create({
        data: {
          id: crystal[0],
          nameCn: crystal[1],
          nameEn: crystal[2],
          mineralName: crystal[3],
          gemologicalInfo: { source: "postgres-verification" },
          colorTags: ["neutral"],
          visualTags: ["translucent"],
          styleTags: ["minimal"],
          emotionTags: ["calm-aesthetic"],
          cultureTags: ["design-reference"],
          priceLevel: 2,
          complianceNote: "Design reference only."
        }
      });
    }
    for (const product of [
      ["product-aquamarine-round-8", "AQ-8", "crystal-aquamarine", 1_200n, 8],
      ["product-moonstone-round-6", "MO-6", "crystal-moonstone", 800n, 6],
      ["product-quartz-round-10", "QU-10", "crystal-clear-quartz", 1_000n, 10]
    ] as const) {
      await prisma.materialProduct.create({
        data: {
          id: product[0],
          sku: product[1],
          crystalId: product[2],
          name: product[1],
          shape: "ROUND",
          diameterMm: product[4],
          materialKey: `${product[0]}-material`,
          currency: "CNY",
          unitPriceMinor: product[3],
          unitCostMinor: 100n
        }
      });
    }
    await prisma.accessoryProduct.createMany({
      data: [
        {
          id: "product-spacer-silver-3",
          sku: "SP-3",
          accessoryType: "SPACER",
          material: "STERLING_SILVER",
          finish: "POLISHED",
          dimensions: { diameterMm: 3 },
          currency: "CNY",
          unitPriceMinor: 300n,
          unitCostMinor: 100n
        },
        {
          id: "product-pendant-drop-silver-8",
          sku: "PD-8",
          accessoryType: "PENDANT",
          material: "STERLING_SILVER",
          finish: "POLISHED",
          dimensions: { heightMm: 8 },
          currency: "CNY",
          unitPriceMinor: 500n,
          unitCostMinor: 100n
        }
      ]
    });
    await prisma.pricingRule.create({
      data: {
        version: "cny-retail-2026-07-v1",
        currency: "CNY",
        rulePayload: { kind: "catalog" }
      }
    });
    const productIds = [
      "product-aquamarine-round-8",
      "product-moonstone-round-6",
      "product-quartz-round-10",
      "product-spacer-silver-3",
      "product-pendant-drop-silver-8"
    ];
    await prisma.inventorySnapshot.createMany({
      data: productIds.map((productId) => ({
        productType:
          productId.includes("spacer") || productId.includes("pendant")
            ? "ACCESSORY"
            : "MATERIAL",
        productId,
        availableQuantity: 20,
        sourceVersion: "postgres-verification-v1"
      }))
    });

    const revision1 = DesignV1Schema.parse({
      ...structuredClone(standardAiDesignFixture),
      designId: "postgres-verification-design"
    });

    await t.test("2. design creation atomically stores revision 1", async () => {
      const created = await designs.createDesign(actorId, revision1);
      assert.equal(created.currentRevision, 1);
      const revisions = await designs.listDesignRevisions(actorId, created.id);
      assert.equal(revisions.length, 1);
      assert.equal(revisions[0]?.snapshot.revision, 1);
    });

    let currentRevision2 = revision1;
    await t.test("3. concurrent optimistic updates allow one winner and one conflict", async () => {
      const candidates = [
        nextRevision(revision1, 2, { designName: "Concurrent candidate A" }),
        nextRevision(revision1, 2, { designName: "Concurrent candidate B" })
      ];
      const results = await Promise.allSettled(
        candidates.map((candidate) =>
          designs.updateDesign(actorId, revision1.designId, 1, candidate, "concurrent update")
        )
      );
      assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
      const rejection = results.find(({ status }) => status === "rejected");
      assert.ok(rejection?.status === "rejected");
      assert.ok(rejection.reason instanceof PersistenceError);
      assert.equal(rejection.reason.code, "CONFLICT");
      const current = await designs.getDesign(actorId, revision1.designId);
      assert.equal(current.currentRevision, 2);
      assert.equal((await designs.listDesignRevisions(actorId, revision1.designId)).length, 2);
      currentRevision2 = current.snapshot;
    });

    await t.test("4. a failed revision insert rolls back the current-design update", async () => {
      const rollbackRevision1 = DesignV1Schema.parse({
        ...structuredClone(revision1),
        designId: "postgres-rollback-design"
      });
      await designs.createDesign(actorId, rollbackRevision1);
      const rollbackRevision2 = nextRevision(rollbackRevision1, 2, {
        designName: "Must roll back"
      });
      await prisma.designRevision.create({
        data: {
          designId: rollbackRevision1.designId,
          revisionNumber: 2,
          schemaVersion: rollbackRevision2.schemaVersion,
          snapshot: rollbackRevision2,
          changeType: "UPDATED",
          changeReason: "Deliberate uniqueness conflict",
          createdBy: actorId
        }
      });
      await assert.rejects(
        () =>
          designs.updateDesign(
            actorId,
            rollbackRevision1.designId,
            1,
            rollbackRevision2,
            "must roll back"
          ),
        (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
      );
      const persisted = await designs.getDesign(actorId, rollbackRevision1.designId);
      assert.equal(persisted.currentRevision, 1);
      assert.equal(persisted.snapshot.designName, rollbackRevision1.designName);
    });

    await t.test("5. Design revision rows reject update and delete through triggers", async () => {
      const row = await prisma.designRevision.findFirstOrThrow({
        where: { designId: revision1.designId, revisionNumber: 1 }
      });
      await assert.rejects(() =>
        prisma.designRevision.update({
          where: { id: row.id },
          data: { changeReason: "forbidden" }
        })
      );
      await assert.rejects(() => prisma.designRevision.delete({ where: { id: row.id } }));
    });

    let publicationId = "";
    let publishedRevision3: DesignV1 = currentRevision2;
    await t.test("6. publication remains fixed to its selected immutable revision", async () => {
      publishedRevision3 = nextRevision(currentRevision2, 3, {
        community: {
          visibility: "PUBLIC",
          publishConsent: true,
          allowRemix: true,
          creatorDisplayMode: "DISPLAY_NAME"
        }
      });
      await designs.updateDesign(
        actorId,
        revision1.designId,
        2,
        publishedRevision3,
        "publishable revision"
      );
      const publication = await publications.publishDesign(actorId, revision1.designId, 3);
      publicationId = publication.id;
      const revision4 = nextRevision(publishedRevision3, 4, {
        designName: "Current design moved on",
        community: {
          visibility: "PRIVATE",
          publishConsent: false,
          allowRemix: false,
          creatorDisplayMode: "ANONYMOUS"
        }
      });
      await designs.updateDesign(actorId, revision1.designId, 3, revision4, "continue editing");
      const fixed = await publications.getPublication(publicationId);
      assert.equal(fixed.design.revision, 3);
      assert.equal(fixed.design.designName, publishedRevision3.designName);
      assert.deepEqual(fixed.design.production.productionNotes, []);
    });

    let orderId = "";
    await t.test("7. order creation captures the current revision as an immutable snapshot", async () => {
      const order = await orders.createOrderFromDesign(
        actorId,
        revision1.designId,
        4,
        5_500,
        "cny-retail-2026-07-v1"
      );
      orderId = order.id;
      assert.equal(order.totalAmountMinor, 5_500);
      assert.equal(order.designSnapshot.revision, 4);
      assert.equal(order.pricingSnapshot.totalPriceMinor, 5_500);
    });

    await t.test("8. order snapshots reject update/delete and orders reject physical delete", async () => {
      const snapshot = await prisma.orderDesignSnapshot.findUniqueOrThrow({
        where: { orderId }
      });
      await assert.rejects(() =>
        prisma.orderDesignSnapshot.update({
          where: { id: snapshot.id },
          data: { pricingRuleVersion: "forbidden" }
        })
      );
      await assert.rejects(() =>
        prisma.orderDesignSnapshot.delete({ where: { id: snapshot.id } })
      );
      await assert.rejects(() => prisma.order.delete({ where: { id: orderId } }));
    });

    await t.test("9. failed order validation leaves order and snapshot counts unchanged", async () => {
      await prisma.inventorySnapshot.create({
        data: {
          productType: "MATERIAL",
          productId: "product-aquamarine-round-8",
          availableQuantity: 0,
          sourceVersion: "postgres-verification-out-of-stock"
        }
      });
      const before = {
        orders: await prisma.order.count(),
        snapshots: await prisma.orderDesignSnapshot.count()
      };
      await assert.rejects(
        () =>
          orders.createOrderFromDesign(
            actorId,
            revision1.designId,
            4,
            5_500,
            "cny-retail-2026-07-v1"
          ),
        (error: unknown) =>
          error instanceof PersistenceError && error.code === "INVENTORY_CHANGED"
      );
      assert.deepEqual(
        {
          orders: await prisma.order.count(),
          snapshots: await prisma.orderDesignSnapshot.count()
        },
        before
      );
    });

    await t.test("10. BIGINT minor-unit values round-trip and unsafe values are rejected", async () => {
      const safeMaximum = BigInt(Number.MAX_SAFE_INTEGER);
      await prisma.materialProduct.update({
        where: { id: "product-aquamarine-round-8" },
        data: { unitPriceMinor: safeMaximum }
      });
      const [safeProduct] = await products.getProducts(["product-aquamarine-round-8"]);
      assert.equal(safeProduct?.unitPriceMinor, Number.MAX_SAFE_INTEGER);
      await prisma.materialProduct.update({
        where: { id: "product-aquamarine-round-8" },
        data: { unitPriceMinor: safeMaximum + 1n }
      });
      await assert.rejects(
        () => products.getProducts(["product-aquamarine-round-8"]),
        (error: unknown) =>
          error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
      );
    });

    await t.test("11. persisted JSON is schema-validated on write and read", async () => {
      await assert.rejects(
        () => designs.createDesign(actorId, { ...structuredClone(revision1), ownerId: "forged" }),
        (error: unknown) =>
          error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
      );
      await prisma.$executeRawUnsafe(
        'UPDATE "designs" SET "current_snapshot" = $1::jsonb WHERE "id" = $2',
        JSON.stringify({ schemaVersion: "2.0.0" }),
        "postgres-rollback-design"
      );
      await assert.rejects(
        () => designs.getDesign(actorId, "postgres-rollback-design"),
        (error: unknown) =>
          error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
      );
    });

    await t.test("12. foreign-key delete policies are RESTRICT in live PostgreSQL", async () => {
      await assert.rejects(() => prisma.user.delete({ where: { id: actorId } }));
      await assert.rejects(() =>
        prisma.design.delete({ where: { id: revision1.designId } })
      );
      await assert.rejects(() =>
        prisma.crystal.delete({ where: { id: "crystal-aquamarine" } })
      );
    });

    console.log(
      "POSTGRES_VERIFICATION_SUMMARY passed=12 failed=0 transaction=passed triggers=passed"
    );
  } finally {
    await prisma.$disconnect();
  }
});
