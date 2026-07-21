import assert from "node:assert/strict";
import test from "node:test";

import { DesignV1Schema } from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { createPrismaClient } from "../client/prisma-client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import { minorToBigInt } from "../mappers/money.mapper.js";
import { DesignRepository } from "./design.repository.js";
import { OrderRepository } from "./order.repository.js";
import { PublicationRepository } from "./publication.repository.js";

const databaseUrl = process.env.DATABASE_URL;

test(
  "PostgreSQL repositories preserve revisions, publications, prices, inventory, and immutable snapshots",
  { skip: !databaseUrl },
  async () => {
    const prisma = createPrismaClient(databaseUrl);
    const actorId = "integration-user";
    await prisma.$connect();
    try {
      await prisma.user.create({ data: { id: actorId, email: "integration@mystcrag.example" } });
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
            gemologicalInfo: { source: "integration-test" },
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
        ["product-aquamarine-round-8", "AQ-8", "crystal-aquamarine", 1200n, 8],
        ["product-moonstone-round-6", "MO-6", "crystal-moonstone", 800n, 6],
        ["product-quartz-round-10", "QU-10", "crystal-clear-quartz", 1000n, 10]
      ] as const) {
        await prisma.materialProduct.create({
          data: {
            id: product[0], sku: product[1], crystalId: product[2], name: product[1],
            shape: "ROUND", diameterMm: product[4], materialKey: `${product[0]}-material`,
            currency: "CNY", unitPriceMinor: product[3], unitCostMinor: 100n
          }
        });
      }
      await prisma.accessoryProduct.createMany({
        data: [
          { id: "product-spacer-silver-3", sku: "SP-3", accessoryType: "SPACER", material: "STERLING_SILVER", finish: "POLISHED", dimensions: { diameterMm: 3 }, currency: "CNY", unitPriceMinor: 300n, unitCostMinor: 100n },
          { id: "product-pendant-drop-silver-8", sku: "PD-8", accessoryType: "PENDANT", material: "STERLING_SILVER", finish: "POLISHED", dimensions: { heightMm: 8 }, currency: "CNY", unitPriceMinor: 500n, unitCostMinor: 100n }
        ]
      });
      await prisma.pricingRule.create({
        data: { version: "cny-retail-2026-07-v1", currency: "CNY", rulePayload: { kind: "catalog" } }
      });
      const productIds = [
        "product-aquamarine-round-8", "product-moonstone-round-6", "product-quartz-round-10",
        "product-spacer-silver-3", "product-pendant-drop-silver-8"
      ];
      await prisma.inventorySnapshot.createMany({
        data: productIds.map((productId) => ({
          productType: productId.includes("spacer") || productId.includes("pendant") ? "ACCESSORY" : "MATERIAL",
          productId, availableQuantity: 20, sourceVersion: "integration-v1"
        }))
      });

      const designs = new DesignRepository(prisma);
      const publications = new PublicationRepository(prisma);
      const orders = new OrderRepository(prisma);
      const revision1 = DesignV1Schema.parse({
        ...structuredClone(standardAiDesignFixture),
        designId: "integration-design"
      });
      const created = await designs.createDesign(actorId, revision1);
      assert.equal(created.currentRevision, 1);
      assert.equal((await designs.listDesignRevisions(actorId, created.id)).length, 1);

      await assert.rejects(
        () => designs.createDesign(actorId, { ...revision1, ownerId: "forged-owner" }),
        (error: unknown) => error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
      );
      await assert.rejects(
        () => designs.updateDesign(actorId, created.id, 1, { ...revision1, schemaVersion: "2.0.0", revision: 2 }, "invalid major"),
        (error: unknown) => error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
      );

      const revision2 = DesignV1Schema.parse({
        ...structuredClone(revision1), revision: 2, updatedAt: "2026-07-21T07:00:00.000Z",
        community: { visibility: "PUBLIC", publishConsent: true, allowRemix: true, creatorDisplayMode: "DISPLAY_NAME" }
      });
      const updated = await designs.updateDesign(actorId, created.id, 1, revision2, "publishable revision");
      assert.equal(updated.currentRevision, 2);
      await assert.rejects(
        () => designs.updateDesign(actorId, created.id, 1, revision2, "stale update"),
        (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
      );
      const revisionRows = await prisma.designRevision.findMany({ where: { designId: created.id } });
      assert.equal(revisionRows.length, 2);
      await assert.rejects(() => prisma.designRevision.update({ where: { id: revisionRows[0]!.id }, data: { changeReason: "forbidden" } }));

      const publication = await publications.publishDesign(actorId, created.id, 2);
      assert.equal(publication.design.revision, 2);
      assert.deepEqual(publication.design.production.productionNotes, []);
      const revision3 = DesignV1Schema.parse({
        ...structuredClone(revision2), revision: 3, designName: "Current draft changed",
        updatedAt: "2026-07-21T08:00:00.000Z",
        community: { visibility: "PRIVATE", publishConsent: false, allowRemix: false, creatorDisplayMode: "ANONYMOUS" }
      });
      await designs.updateDesign(actorId, created.id, 2, revision3, "continue editing");
      assert.equal((await publications.getPublication(publication.id)).design.revision, 2);

      const order = await orders.createOrderFromDesign(actorId, created.id, 2, 5_500, "cny-retail-2026-07-v1");
      assert.equal(order.totalAmountMinor, 5_500);
      assert.equal(order.designSnapshot.revision, 2);
      await assert.rejects(() => prisma.orderDesignSnapshot.update({ where: { orderId: order.id }, data: { pricingRuleVersion: "forbidden" } }));

      await prisma.materialProduct.update({
        where: { id: "product-aquamarine-round-8" },
        data: { unitPriceMinor: minorToBigInt(1_300, "unitPriceMinor") }
      });
      await assert.rejects(
        () => orders.createOrderFromDesign(actorId, created.id, 2, 5_500, "cny-retail-2026-07-v1"),
        (error: unknown) => error instanceof PersistenceError && error.code === "PRICE_CHANGED"
      );
      assert.equal((await orders.getOrder(actorId, order.id)).totalAmountMinor, 5_500);
      await prisma.materialProduct.update({ where: { id: "product-aquamarine-round-8" }, data: { unitPriceMinor: 1200n } });
      await prisma.inventorySnapshot.create({
        data: { productType: "MATERIAL", productId: "product-aquamarine-round-8", availableQuantity: 0, sourceVersion: "integration-v2" }
      });
      const orderCount = await prisma.order.count();
      await assert.rejects(
        () => orders.createOrderFromDesign(actorId, created.id, 2, 5_500, "cny-retail-2026-07-v1"),
        (error: unknown) => error instanceof PersistenceError && error.code === "INVENTORY_CHANGED"
      );
      assert.equal(await prisma.order.count(), orderCount);

      await designs.softDeleteDesign(actorId, created.id);
      const revision4 = { ...structuredClone(revision3), revision: 4, updatedAt: "2026-07-21T09:00:00.000Z" };
      await assert.rejects(
        () => designs.updateDesign(actorId, created.id, 3, revision4, "cannot edit deleted"),
        (error: unknown) => error instanceof PersistenceError && error.code === "NOT_FOUND"
      );
    } finally {
      await prisma.$disconnect();
    }
  }
);
