import assert from "node:assert/strict";
import test from "node:test";

import { GenerateDesignRequestSchema } from "@mystcrag/design-contract";

import { AiRecommendationDesignAdapter } from "./ai-recommendation-design.adapter.js";
import type { CatalogProduct } from "./design-api.service.js";

const catalog: CatalogProduct[] = [
  ["product-aquamarine-round-8", "crystal-aquamarine", 1_200],
  ["product-moonstone-round-6", "crystal-moonstone", 800],
  ["product-quartz-round-10", "crystal-clear-quartz", 1_000]
].map(([id, crystalId, unitPriceMinor], index) => ({
  id: String(id),
  productType: "MATERIAL" as const,
  sku: `SKU-${index}`,
  name: String(crystalId),
  currency: "CNY" as const,
  unitPriceMinor: Number(unitPriceMinor),
  active: true,
  crystalId: String(crystalId),
  shape: "ROUND",
  diameterMm: 8,
  materialKey: String(crystalId),
  modelAssetKey: `model-${index}`,
  textureAssetKey: `texture-${index}`
}));

function request(direction: string) {
  return GenerateDesignRequestSchema.parse({
    requestId: `backend-ai-${direction}`,
    locale: "zh-CN",
    currency: "CNY",
    wristCircumferenceMm: 155,
    emotionTags: ["quiet"],
    styleTags: ["minimal", "landscape", direction],
    colorTags: ["mist-blue"],
    minBudgetMinor: 29_900,
    maxBudgetMinor: 49_900,
    excludedProductIds: [],
    personalizationConsent: false
  });
}

test("AI composition returns three differentiated, production-mappable candidates", async () => {
  const adapter = new AiRecommendationDesignAdapter();
  const candidates = await Promise.all([
    adapter.generate(request("airy-rhythm"), catalog),
    adapter.generate(request("layered-contrast"), catalog),
    adapter.generate(request("focal-balance"), catalog)
  ]) as Array<{ designName: string; materialProductIds: string[]; designStory: string; recommendationReasons: string[] }>;

  assert.equal(new Set(candidates.map(({ designName }) => designName)).size, 3);
  assert.equal(new Set(candidates.map(({ materialProductIds }) => materialProductIds.join("|"))).size, 3);
  assert.ok(candidates.every(({ materialProductIds }) => materialProductIds.length === 12));
  assert.ok(candidates.every(({ designStory }) => designStory.includes("文化参考")));
  assert.ok(candidates.every(({ recommendationReasons }) => recommendationReasons.length >= 3));
  assert.ok(candidates.flatMap(({ materialProductIds }) => materialProductIds).every((id) => catalog.some((product) => product.id === id)));
});
