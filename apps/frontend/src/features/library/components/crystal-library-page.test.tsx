import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type {
  CatalogMaterialProduct,
  ListCatalogMaterialsResponse,
  PublicDesignV1
} from "@mystcrag/design-contract";

import { FrontendApiError } from "../../../lib/api/frontend-api-error";
import { mockDesignOptions } from "../../design/fixtures/mock-design-options";
import { loadLibraryPageData } from "./crystal-library-page";

function material(crystalId: string): CatalogMaterialProduct {
  return {
    beadProductId: `product-${crystalId}-8`,
    sku: `SKU-${crystalId}`,
    displayName: "测试",
    crystalId,
    crystalNameCn: "测试水晶",
    crystalNameEn: "Test",
    mineralName: "Quartz",
    colorTags: ["clear"],
    visualTags: ["translucent"],
    styleTags: ["minimal"],
    emotionTags: ["calm-aesthetic"],
    cultureTags: ["design-inspiration-only"],
    materialKey: `${crystalId}-material-v1`,
    shape: "ROUND",
    diameterMm: 8,
    modelAssetKey: "sphere-round-8mm-v1",
    textureAssetKey: `${crystalId}-texture-v1`,
    currency: "CNY",
    unitPriceMinor: 500,
    availableQuantity: 100
  } as CatalogMaterialProduct;
}

const CATALOG: ListCatalogMaterialsResponse = {
  materials: [material("crystal-clear-quartz"), material("crystal-amethyst")],
  accessories: []
};

test("fixed design 404 still delivers catalog materials for rendering", async () => {
  const outcome = await loadLibraryPageData({
    get: async () => {
      throw new FrontendApiError("NOT_FOUND", "design-diy-private is absent in a fresh database");
    },
    materials: async () => CATALOG
  });
  assert.equal(outcome.design, null);
  assert.equal(outcome.designNotice, "NOT_FOUND");
  assert.equal(outcome.catalogNotice, null);
  assert.deepEqual(
    outcome.materials.map((item) => item.crystalId),
    ["crystal-clear-quartz", "crystal-amethyst"]
  );
  assert.deepEqual(outcome.accessories, []);
});

test("material request failure surfaces a catalog notice and is never swallowed", async () => {
  const design = mockDesignOptions[0] as PublicDesignV1;
  const outcome = await loadLibraryPageData({
    get: async () => design,
    materials: async () => {
      throw new FrontendApiError("NETWORK_ERROR", "catalog unreachable");
    }
  });
  assert.equal(outcome.catalogNotice, "NETWORK_ERROR");
  assert.deepEqual(outcome.materials, []);
  assert.deepEqual(outcome.accessories, []);
  assert.equal(outcome.design?.designId, design.designId);
});

test("loader settles both failures without rejecting or unhandled rejections", async () => {
  const outcome = await loadLibraryPageData({
    get: async () => {
      throw new FrontendApiError("NOT_FOUND", "design absent");
    },
    materials: async () => {
      throw new FrontendApiError("NETWORK_ERROR", "catalog unreachable");
    }
  });
  assert.equal(outcome.designNotice, "NOT_FOUND");
  assert.equal(outcome.catalogNotice, "NETWORK_ERROR");
  assert.deepEqual(outcome.materials, []);
});

test("successful loads keep design and catalog pass-through behavior unchanged", async () => {
  const design = mockDesignOptions[0] as PublicDesignV1;
  const outcome = await loadLibraryPageData({
    get: async () => design,
    materials: async () => CATALOG
  });
  assert.equal(outcome.design, design);
  assert.equal(outcome.designNotice, null);
  assert.equal(outcome.catalogNotice, null);
  assert.equal(outcome.materials.length, 2);
});

test("crystal library page no longer couples catalog rendering to the fixed design request", () => {
  const source = readFileSync(new URL("./crystal-library-page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Promise\.all\(\[\s*designApi\.get/);
  assert.equal((source.match(/loadLibraryPageData\(designApi\)/g) ?? []).length, 2);
  // The error gate must key on catalog failure, not on design absence.
  assert.doesNotMatch(source, /if \(!design\) \{\s*return \(/);
  assert.match(source, /data-library-design-panel="unavailable"/);
});
