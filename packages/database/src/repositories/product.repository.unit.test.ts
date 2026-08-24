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
            mineralName: "Quartz",
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
  assert.equal(material.mineralName, "Quartz");
  assert.deepEqual(material.visualTags, ["translucent", "faceted"]);
  assert.deepEqual(material.styleTags, ["minimal", "contemporary-eastern"]);
  assert.deepEqual(material.emotionTags, ["calm-aesthetic"]);
  assert.deepEqual(material.cultureTags, ["design-inspiration-only"]);
});

test("Tarot catalog includes zero stock and reports latest remaining quantity internally", async () => {
  const products = [
    {
      id: "product-zero-stock",
      sku: "ZERO-CNY-8",
      name: "Zero stock bead",
      crystalId: "crystal-zero",
      crystal: {
        nameCn: "零库存珠",
        nameEn: "Zero stock bead",
        mineralName: "Quartz",
        colorTags: ["violet"], visualTags: [], styleTags: [], emotionTags: [], cultureTags: []
      },
      shape: "ROUND", diameterMm: 8, materialKey: "zero-material",
      modelAssetKey: "zero-model", textureAssetKey: "zero-texture",
      currency: "CNY", unitPriceMinor: 300n, active: true
    },
    {
      id: "product-available",
      sku: "LIVE-CNY-8",
      name: "Available bead",
      crystalId: "crystal-live",
      crystal: {
        nameCn: "可用珠",
        nameEn: "Available bead",
        mineralName: "Beryl",
        colorTags: ["blue"], visualTags: [], styleTags: [], emotionTags: [], cultureTags: []
      },
      shape: "ROUND", diameterMm: 8, materialKey: "live-material",
      modelAssetKey: "live-model", textureAssetKey: "live-texture",
      currency: "CNY", unitPriceMinor: 400n, active: true
    }
  ];
  const prisma = {
    materialProduct: {
      async findMany(input: { include?: { crystal?: boolean } }) {
        return input.include?.crystal ? products : products.map(({ crystal: _crystal, ...product }) => product);
      }
    },
    accessoryProduct: { async findMany() { return []; } },
    inventorySnapshot: {
      async findMany() {
        return [
          { productId: "product-zero-stock", availableQuantity: 5, reservedQuantity: 5, capturedAt: new Date("2026-08-22T09:00:00Z") },
          { productId: "product-available", availableQuantity: 12, reservedQuantity: 3, capturedAt: new Date("2026-08-22T09:00:00Z") },
          { productId: "product-available", availableQuantity: 2, reservedQuantity: 0, capturedAt: new Date("2026-08-21T09:00:00Z") }
        ];
      }
    }
  } as unknown as PrismaClient;

  const catalog = await new ProductRepository(prisma).listAvailableCatalogMaterialProducts("CNY");

  assert.deepEqual(catalog.map(({ id, availableQuantity }) => [id, availableQuantity]), [
    ["product-zero-stock", 0],
    ["product-available", 9]
  ]);
});
