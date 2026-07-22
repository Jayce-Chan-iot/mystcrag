import assert from "node:assert/strict";
import test from "node:test";

import { createPrismaClient } from "../src/client/prisma-client.js";
import { parseDesignSnapshot } from "../src/mappers/snapshot.mapper.js";

const databaseUrl = process.env.DATABASE_URL;

test("repeated seed preserves the expected PostgreSQL fixture set", { skip: !databaseUrl }, async () => {
  const prisma = createPrismaClient(databaseUrl);
  await prisma.$connect();
  try {
    const counts = {
      users: await prisma.user.count(),
      crystals: await prisma.crystal.count(),
      materialProducts: await prisma.materialProduct.count(),
      accessoryProducts: await prisma.accessoryProduct.count(),
      pricingRules: await prisma.pricingRule.count(),
      inventorySnapshots: await prisma.inventorySnapshot.count(),
      designs: await prisma.design.count(),
      designRevisions: await prisma.designRevision.count(),
      publications: await prisma.designPublication.count(),
      orders: await prisma.order.count(),
      orderSnapshots: await prisma.orderDesignSnapshot.count()
    };
    assert.deepEqual(counts, {
      users: 1,
      crystals: 3,
      materialProducts: 6,
      accessoryProducts: 2,
      pricingRules: 2,
      inventorySnapshots: 8,
      designs: 3,
      designRevisions: 4,
      publications: 1,
      orders: 1,
      orderSnapshots: 1
    });

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
