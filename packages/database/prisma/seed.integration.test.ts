import assert from "node:assert/strict";
import test from "node:test";

import { createPrismaClient } from "../src/client/prisma-client.js";
import { parseDesignSnapshot } from "../src/mappers/snapshot.mapper.js";

const databaseUrl = process.env.DATABASE_URL;

test("repeated seed preserves the expected PostgreSQL fixture set", { skip: !databaseUrl }, async () => {
  const prisma = createPrismaClient(databaseUrl);
  await prisma.$connect();
  try {
    const seededDesignIds = ["design-ai-published", "design-diy-private", "design-rejected"];
    const counts = {
      users: await prisma.user.count({ where: { id: "user-phase-2c-demo" } }),
      crystals: await prisma.crystal.count(),
      materialProducts: await prisma.materialProduct.count(),
      accessoryProducts: await prisma.accessoryProduct.count(),
      pricingRules: await prisma.pricingRule.count(),
      inventorySnapshots: await prisma.inventorySnapshot.count({
        where: { sourceVersion: "seed-2026-08-v2" }
      }),
      designs: await prisma.design.count({ where: { id: { in: seededDesignIds } } }),
      designRevisions: await prisma.designRevision.count({
        where: {
          id: {
            in: ["revision-ai-1", "revision-ai-2", "revision-diy-1", "revision-rejected-1"]
          }
        }
      }),
      publications: await prisma.designPublication.count({
        where: { id: "publication-ai-revision-1" }
      }),
      orders: await prisma.order.count({ where: { id: "order-seed-1" } }),
      orderSnapshots: await prisma.orderDesignSnapshot.count({
        where: { id: "order-snapshot-seed-1" }
      })
    };
    assert.deepEqual(counts, {
      users: 1,
      crystals: 20,
      materialProducts: 96,
      accessoryProducts: 4,
      pricingRules: 2,
      inventorySnapshots: 100,
      designs: 3,
      designRevisions: 4,
      publications: 1,
      orders: 1,
      orderSnapshots: 1
    });

    // Product V2 backfill: every seeded material product carries string length,
    // hole diameter, grade, and a taxonomy-validated visual profile.
    const products = await prisma.materialProduct.findMany();
    assert.equal(products.length, 96);
    for (const product of products) {
      assert.ok(product.lengthAlongStringMm !== null && product.lengthAlongStringMm > 0);
      assert.ok(product.holeDiameterMm !== null && product.holeDiameterMm > 0);
      assert.ok(product.grade !== null && product.grade.length > 0);
      assert.ok(product.visualProfile !== null);
    }

    // Partial out-of-stock and low-stock SKUs exist (E2E-3 pre-condition).
    const latestInventory = await prisma.inventorySnapshot.findMany({
      where: { sourceVersion: "seed-2026-08-v2" }
    });
    const outOfStock = latestInventory.filter((row) => row.availableQuantity === 0);
    const lowStock = latestInventory.filter((row) => row.availableQuantity === 5);
    assert.equal(outOfStock.length, 9);
    const outOfStockIds = new Set(outOfStock.map((row) => row.productId));
    assert.equal(outOfStockIds.has("product-moonstone-round-10"), true);
    assert.equal(outOfStockIds.has("product-garnet-faceted-8"), true);
    assert.equal(outOfStockIds.has("product-pendant-drop-silver-8"), true);
    assert.equal(lowStock.length, 2);

    const designs = await prisma.design.findMany({ orderBy: { id: "asc" } });
    for (const design of designs) {
      const snapshot = parseDesignSnapshot(design.currentSnapshot);
      assert.equal(snapshot.designId, design.id);
      assert.equal(snapshot.revision, design.currentRevision);
    }

    const publication = await prisma.designPublication.findUniqueOrThrow({
      where: { id: "publication-ai-revision-1" },
      include: { design: true, designRevision: true }
    });
    assert.equal(publication.design.currentRevision, 2);
    assert.equal(publication.designRevision.revisionNumber, 1);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: "order-seed-1" },
      include: { designSnapshot: true }
    });
    assert.equal(typeof order.totalAmountMinor, "bigint");
    assert.equal(order.totalAmountMinor, 5_500n);
    assert.ok(order.designSnapshot);

    console.log(`SEED_VERIFICATION_SUMMARY ${JSON.stringify(counts)}`);
  } finally {
    await prisma.$disconnect();
  }
});
