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

function request(direction: string, excludedProductIds: readonly string[] = []) {
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
    excludedProductIds,
    personalizationConsent: false
  });
}

type AdaptedCandidate = {
  designName: string;
  materialProductIds: string[];
  designStory: string;
  recommendationReasons: string[];
  sourceTemplateIds: string[];
  providerMetadata: {
    modelProvider: string;
    modelName: string;
    designTemplateVersion: string | null;
  };
};

function canonicalRingSignature(sequence: readonly string[]): string {
  const rotations = (values: readonly string[]) =>
    values.map((_, index) => [...values.slice(index), ...values.slice(0, index)].join("|"));
  return [...rotations(sequence), ...rotations([...sequence].reverse())].sort()[0]!;
}

async function generateOptions(
  adapter: AiRecommendationDesignAdapter,
  availableCatalog: readonly CatalogProduct[],
  excludedProductIds: readonly string[] = []
): Promise<AdaptedCandidate[]> {
  return Promise.all([
    adapter.generate(request("airy-rhythm", excludedProductIds), availableCatalog),
    adapter.generate(request("layered-contrast", excludedProductIds), availableCatalog),
    adapter.generate(request("focal-balance", excludedProductIds), availableCatalog)
  ]) as Promise<AdaptedCandidate[]>;
}

test("AI composition returns three differentiated, production-mappable candidates", async () => {
  const adapter = new AiRecommendationDesignAdapter();
  const candidates = await generateOptions(adapter, catalog);

  assert.equal(new Set(candidates.map(({ designName }) => designName)).size, 3);
  assert.equal(new Set(candidates.map(({ materialProductIds }) => materialProductIds.join("|"))).size, 3);
  assert.ok(candidates.every(({ materialProductIds }) => materialProductIds.length === 12));
  assert.ok(candidates.every(({ designStory }) => designStory.includes("文化参考")));
  assert.ok(candidates.every(({ recommendationReasons }) => recommendationReasons.length >= 3));
  assert.ok(candidates.flatMap(({ materialProductIds }) => materialProductIds).every((id) => catalog.some((product) => product.id === id)));
});

test("aquamarine exclusion keeps three two-material options visually distinct", async () => {
  const adapter = new AiRecommendationDesignAdapter();
  const excludedId = "product-aquamarine-round-8";
  const candidates = await generateOptions(adapter, catalog, [excludedId]);
  const sequences = candidates.map(({ materialProductIds }) => materialProductIds);

  assert.equal(new Set(sequences.map((sequence) => sequence.join("|"))).size, 3);
  assert.equal(new Set(sequences.map(canonicalRingSignature)).size, 3);
  assert.ok(sequences.every((sequence) => sequence.length === 12));
  assert.ok(sequences.every((sequence) => !sequence.includes(excludedId)));
  assert.ok(sequences.flat().every((id) => catalog.some((product) => product.id === id && product.active)));

  const countSignatures = sequences.map((sequence) =>
    [...new Map(sequence.map((id) => [id, sequence.filter((value) => value === id).length])).entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, count]) => `${id}:${count}`)
      .join("|")
  );
  assert.ok(new Set(countSignatures).size >= 2, "at least one option must change material balance, not only ring rotation");
  assert.equal(new Set(candidates.map(({ designName }) => designName)).size, 3);
  assert.ok(candidates.every(({ designStory }) => designStory.includes("文化参考")));
  assert.ok(candidates.every(({ recommendationReasons }) => recommendationReasons.length >= 4));
  assert.ok(candidates.every(({ sourceTemplateIds }) => sourceTemplateIds.length === 1));
  assert.ok(candidates.every(({ providerMetadata }) =>
    providerMetadata.modelProvider === "rule-based" &&
    providerMetadata.modelName === "mystcrag-rule-based-provider" &&
    providerMetadata.designTemplateVersion !== null
  ));
});

test("one eligible material is repeated honestly without inventing catalog IDs", async () => {
  const adapter = new AiRecommendationDesignAdapter();
  const onlyMoonstone = catalog.filter(({ id }) => id === "product-moonstone-round-6");
  const candidates = await generateOptions(adapter, onlyMoonstone);

  assert.ok(candidates.every(({ materialProductIds }) =>
    materialProductIds.length === 12 &&
    materialProductIds.every((id) => id === "product-moonstone-round-6")
  ));
  assert.ok(candidates.every(({ recommendationReasons }) =>
    recommendationReasons.some((reason) => reason.includes("Only one active, non-excluded material"))
  ));
});
