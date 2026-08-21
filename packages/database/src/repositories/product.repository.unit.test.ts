import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "../../generated/client/client.js";

import { ProductRepository } from "./product.repository.js";

test("catalog materials carry authoritative Crystal scoring metadata", async () => {
  const prisma = {
    materialProduct: {
      async findMany() {
        return [{
          id: "product-amethyst-faceted-8",
          productType: "MATERIAL",
          sku: "AM-CNY-8",
          name: "Amethyst faceted bead",
          crystalId: "crystal-amethyst",
          crystal: {
            nameCn: "紫水晶",
            nameEn: "Amethyst",
            colorTags: ["violet"],
            visualTags: ["translucent", "faceted"],
            styleTags: ["minimal", "contemporary-eastern"],
            emotionTags: ["calm-aesthetic"],
            cultureTags: ["design-inspiration-only"]
          },
          shape: "FACETED",
          diameterMm: 8,
          materialKey: "crystal-amethyst-material-v1",
          modelAssetKey: "sphere-faceted-8mm-v1",
          textureAssetKey: "crystal-amethyst-texture-v1",
          currency: "CNY",
          unitPriceMinor: 680n,
          active: true
        }];
      }
    },
    accessoryProduct: {
      async findMany() {
        return [];
      }
    }
  } as unknown as PrismaClient;

  const [material] = await new ProductRepository(prisma).getCatalogProducts([
    "product-amethyst-faceted-8"
  ]);

  assert.ok(material?.productType === "MATERIAL");
  assert.deepEqual(material.visualTags, ["translucent", "faceted"]);
  assert.deepEqual(material.styleTags, ["minimal", "contemporary-eastern"]);
  assert.deepEqual(material.emotionTags, ["calm-aesthetic"]);
  assert.deepEqual(material.cultureTags, ["design-inspiration-only"]);
});
