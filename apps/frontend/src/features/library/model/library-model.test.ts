import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogAccessoryProduct, CatalogMaterialProduct } from "@mystcrag/design-contract";

import {
  accessoryDisplayNames,
  crystalCategoryOf,
  DEFAULT_LIBRARY_FILTER,
  filterAccessories,
  filterCrystalGroups,
  groupMaterialsByCrystal,
  sortAccessories,
  sortCrystalGroups
} from "./library-model";

function material(overrides: Partial<CatalogMaterialProduct> & { crystalId: string }): CatalogMaterialProduct {
  return {
    beadProductId: `product-${overrides.crystalId}-${overrides.diameterMm ?? 8}`,
    sku: `SKU-${overrides.crystalId}`,
    displayName: "测试",
    crystalNameCn: overrides.crystalNameCn ?? "测试水晶",
    crystalNameEn: overrides.crystalNameEn ?? "Test",
    mineralName: overrides.mineralName ?? "Quartz",
    colorTags: overrides.colorTags ?? ["clear"],
    visualTags: overrides.visualTags ?? ["translucent"],
    styleTags: ["minimal"],
    emotionTags: ["calm-aesthetic"],
    cultureTags: ["design-inspiration-only"],
    materialKey: `${overrides.crystalId}-material-v1`,
    shape: overrides.shape ?? "ROUND",
    diameterMm: overrides.diameterMm ?? 8,
    modelAssetKey: "sphere-round-8mm-v1",
    textureAssetKey: `${overrides.crystalId}-texture-v1`,
    currency: "CNY",
    unitPriceMinor: overrides.unitPriceMinor ?? 500,
    availableQuantity: overrides.availableQuantity ?? 100,
    ...overrides
  } as CatalogMaterialProduct;
}

const MATERIALS = [
  material({ crystalId: "crystal-clear-quartz", crystalNameCn: "白水晶", diameterMm: 6, unitPriceMinor: 700, colorTags: ["clear", "white"], visualTags: ["translucent", "cool"] }),
  material({ crystalId: "crystal-clear-quartz", crystalNameCn: "白水晶", diameterMm: 10, unitPriceMinor: 1000, availableQuantity: 0 }),
  material({ crystalId: "crystal-amethyst", crystalNameCn: "紫水晶", mineralName: "Quartz", diameterMm: 8, unitPriceMinor: 680, colorTags: ["purple"], visualTags: ["deep"] }),
  material({ crystalId: "crystal-moonstone", crystalNameCn: "月光石", mineralName: "Feldspar", diameterMm: 8, unitPriceMinor: 800, colorTags: ["white", "blue"], visualTags: ["iridescent"], availableQuantity: 0 }),
  material({ crystalId: "crystal-garnet", crystalNameCn: "石榴石", mineralName: "Garnet", shape: "FACETED", diameterMm: 8, unitPriceMinor: 700, colorTags: ["red", "wine"], visualTags: ["deep"] })
];

test("groups materials by crystal with diameter-sorted variants", () => {
  const groups = groupMaterialsByCrystal(MATERIALS);
  assert.equal(groups.length, 4);
  const clearQuartz = groups.find((group) => group.crystalId === "crystal-clear-quartz");
  assert.ok(clearQuartz);
  assert.deepEqual(clearQuartz.variants.map((variant) => variant.diameterMm), [6, 10]);
});

test("quartz minerals classify as crystal and others as natural stone", () => {
  const groups = groupMaterialsByCrystal(MATERIALS);
  const byId = new Map(groups.map((group) => [group.crystalId, group]));
  assert.equal(crystalCategoryOf(byId.get("crystal-clear-quartz")!), "CRYSTAL");
  assert.equal(crystalCategoryOf(byId.get("crystal-amethyst")!), "CRYSTAL");
  assert.equal(crystalCategoryOf(byId.get("crystal-moonstone")!), "NATURAL_STONE");
  assert.equal(crystalCategoryOf(byId.get("crystal-garnet")!), "NATURAL_STONE");
});

test("default in-stock filter hides zero-quantity variants and empty groups", () => {
  const groups = groupMaterialsByCrystal(MATERIALS);
  const filtered = filterCrystalGroups(groups, { ...DEFAULT_LIBRARY_FILTER, productType: "NATURAL_STONE" });
  assert.deepEqual(filtered.map((group) => group.crystalId), ["crystal-garnet"]);
});

test("restock filter keeps only zero-stock variants", () => {
  const groups = groupMaterialsByCrystal(MATERIALS);
  const filtered = filterCrystalGroups(groups, { ...DEFAULT_LIBRARY_FILTER, productType: "CRYSTAL", stock: "RESTOCK" });
  assert.deepEqual(filtered.map((group) => group.crystalId), ["crystal-clear-quartz"]);
  assert.deepEqual(filtered[0]!.variants.map((variant) => variant.diameterMm), [10]);
});

test("diameter and color filters narrow variants", () => {
  const groups = groupMaterialsByCrystal(MATERIALS);
  const byDiameter = filterCrystalGroups(groups, { ...DEFAULT_LIBRARY_FILTER, productType: "CRYSTAL", stock: "ALL", diameterMm: 8 });
  assert.deepEqual(byDiameter.map((group) => group.crystalId), ["crystal-amethyst"]);
  const byColor = filterCrystalGroups(groups, { ...DEFAULT_LIBRARY_FILTER, productType: "CRYSTAL", stock: "ALL", colorTag: "purple" });
  assert.deepEqual(byColor.map((group) => group.crystalId), ["crystal-amethyst"]);
});

test("search matches chinese english and mineral names", () => {
  const groups = groupMaterialsByCrystal(MATERIALS);
  const byChinese = filterCrystalGroups(groups, { ...DEFAULT_LIBRARY_FILTER, productType: "NATURAL_STONE", stock: "ALL", query: "月光" });
  assert.deepEqual(byChinese.map((group) => group.crystalId), ["crystal-moonstone"]);
  const byMineral = filterCrystalGroups(groups, { ...DEFAULT_LIBRARY_FILTER, productType: "NATURAL_STONE", stock: "ALL", query: "feldspar" });
  assert.deepEqual(byMineral.map((group) => group.crystalId), ["crystal-moonstone"]);
  const byEnglish = filterCrystalGroups(groups, { ...DEFAULT_LIBRARY_FILTER, stock: "ALL", query: "amethyst" });
  assert.deepEqual(byEnglish.map((group) => group.crystalId), ["crystal-amethyst"]);
});

test("sorting orders groups by lowest variant price or name", () => {
  const groups = groupMaterialsByCrystal(MATERIALS);
  const ascending = sortCrystalGroups(groups, "PRICE_ASC");
  assert.deepEqual(ascending.map((group) => group.nameCn), ["紫水晶", "白水晶", "石榴石", "月光石"]);
  const descending = sortCrystalGroups(groups, "PRICE_DESC");
  assert.equal(descending[0]!.nameCn, "月光石");
});

const ACCESSORIES: CatalogAccessoryProduct[] = [
  {
    accessoryProductId: "product-spacer-silver-3",
    sku: "SP-CNY-SILVER-3",
    displayName: "STERLING_SILVER SPACER",
    accessoryType: "SPACER",
    material: "STERLING_SILVER",
    finish: "POLISHED",
    currency: "CNY",
    unitPriceMinor: 300,
    availableQuantity: 100
  },
  {
    accessoryProductId: "product-pendant-drop-silver-8",
    sku: "PD-CNY-SILVER-8",
    displayName: "STERLING_SILVER PENDANT",
    accessoryType: "PENDANT",
    material: "STERLING_SILVER",
    finish: "POLISHED",
    currency: "CNY",
    unitPriceMinor: 500,
    availableQuantity: 0
  }
];

test("accessory category filters by stock and query", () => {
  const inStock = filterAccessories(ACCESSORIES, { ...DEFAULT_LIBRARY_FILTER, productType: "ACCESSORY" });
  assert.deepEqual(inStock.map((item) => item.accessoryProductId), ["product-spacer-silver-3"]);
  const all = filterAccessories(ACCESSORIES, { ...DEFAULT_LIBRARY_FILTER, productType: "ACCESSORY", stock: "ALL" });
  assert.equal(all.length, 2);
  const sorted = sortAccessories(all, "PRICE_DESC");
  assert.equal(sorted[0]!.accessoryProductId, "product-pendant-drop-silver-8");
});

test("accessory display names localize type and material", () => {
  const { nameCn, nameEn } = accessoryDisplayNames(ACCESSORIES[0]!);
  assert.equal(nameCn, "925银隔珠");
  assert.equal(nameEn, "925 Silver Spacer");
});
