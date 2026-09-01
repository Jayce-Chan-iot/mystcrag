import assert from "node:assert/strict";
import test from "node:test";

import { RuleComplianceAgent } from "../compliance-agent/index";
import { RuleBasedCrystalAgent } from "../crystal-agent/index";
import { scoreDesignTemplates } from "../design-agent/index";
import { RuleBasedEmotionAgent } from "../emotion-agent/index";
import { PricingContextAgent } from "../pricing-agent/index";
import { aiBeadLayoutCandidateToDesignV1 } from "../src/adapters/index";
import type { AgentContext } from "../src/contracts/agent";
import { crystalFixtures } from "../src/fixtures/crystals";
import { designDnaFixtures } from "../src/fixtures/design-dna";
import { MockProvider, RuleBasedProvider } from "../src/providers/index";
import { generateRecommendations } from "../src/recommendation/index";
import { AiBeadLayoutCandidateSchema } from "../src/schemas/ai-bead-layout-candidate.schema";
import { RecommendationProviderOutputSchema } from "../src/schemas/recommendation-output.schema";

const context: AgentContext = { requestId: "request-ai-phase-3", locale: "zh-CN" };

const request = {
  answers: {
    emotionGoals: ["平静", "焕新"],
    styleTags: ["minimal", "eastern-contemporary"],
    colorTags: ["blue", "white", "clear"],
    freeText: "希望有雨后天空般的安宁感。"
  },
  currency: "CNY" as const,
  budgetMinor: 12_000,
  wristCircumferenceMm: 155,
  excludedBeadProductIds: []
};

async function readyCandidates() {
  const result = await generateRecommendations(new RuleBasedProvider(), request, context);
  assert.equal(result.status, "READY");
  if (result.status !== "READY") {
    assert.fail("expected rule-based recommendations");
  }
  return result.candidates;
}

test("fixtures provide 20 crystals, 12 templates, six styles, six emotion goals, and inventory edge cases", () => {
  assert.equal(crystalFixtures.length, 20);
  assert.equal(designDnaFixtures.length, 12);
  assert.equal(new Set(designDnaFixtures.flatMap((template) => template.styleTags)).size, 6);
  assert.equal(new Set(designDnaFixtures.flatMap((template) => template.emotionTags)).size, 6);
  assert.ok(crystalFixtures.some((crystal) => crystal.inventoryQuantity === 0));
  assert.ok(crystalFixtures.some((crystal) => crystal.productStatus === "DISABLED"));
  assert.ok(crystalFixtures.every((crystal) => crystal.nonScientificEffect));
});

test("Emotion Agent maps questionnaire language to standard tags without diagnosis", async () => {
  const result = await new RuleBasedEmotionAgent().execute(
    { emotionGoals: ["想要平静、专注和新开始"] },
    context
  );
  assert.deepEqual(result.data.emotionTags, ["calm", "focus", "renewal"]);
  assert.equal(JSON.stringify(result).includes("诊断结果"), false);
});

test("style and color matching select a relevant Design DNA template", async () => {
  const romanticRequest = {
    ...request,
    answers: {
      emotionGoals: ["喜悦", "陪伴"],
      styleTags: ["romantic", "natural"],
      colorTags: ["pink", "white", "green"]
    }
  };
  const result = await generateRecommendations(new RuleBasedProvider(), romanticRequest, context);
  assert.equal(result.status, "READY");
  if (result.status !== "READY") assert.fail("expected candidates");
  assert.equal(result.candidates[0].sourceTemplateIds[0], "template-spring-blossom");
  assert.ok(result.candidates[0].styleTags.includes("romantic"));
  assert.ok(result.candidates[0].colorPalette.includes("pink"));
});

test("Crystal Agent filters by budget before design generation", async () => {
  const result = await new RuleBasedCrystalAgent().execute(
    {
      emotionTags: ["calm"],
      styleTags: ["minimal"],
      colorTags: ["clear"],
      currency: "CNY",
      budgetMinor: 4_800,
      excludedBeadProductIds: [],
      expectedBeadCount: 12
    },
    context
  );
  assert.ok(result.data.length >= 3);
  assert.ok(result.data.every(({ crystal }) => crystal.catalogPriceMinor.CNY <= 400));
});

test("Crystal Agent excludes out-of-stock, disabled, and explicitly excluded products", async () => {
  const result = await new RuleBasedCrystalAgent().execute(
    {
      emotionTags: ["focus"],
      styleTags: ["modern"],
      colorTags: ["black", "blue"],
      currency: "CNY",
      budgetMinor: 30_000,
      excludedBeadProductIds: ["bead-black-onyx-8"]
    },
    context
  );
  const productIds = result.data.map(({ crystal }) => crystal.beadProductId);
  assert.equal(productIds.includes("bead-blue-lace-agate-8"), false);
  assert.equal(productIds.includes("bead-obsidian-8"), false);
  assert.equal(productIds.includes("bead-black-onyx-8"), false);
});

test("template scoring is deterministic and weights matching tags", async () => {
  const crystalResult = await new RuleBasedCrystalAgent().execute(
    {
      emotionTags: ["calm", "renewal"],
      styleTags: ["minimal", "eastern-contemporary"],
      colorTags: ["blue", "white", "clear"],
      currency: "CNY",
      budgetMinor: 12_000,
      excludedBeadProductIds: []
    },
    context
  );
  const pricingContext = await new PricingContextAgent().execute(
    { request, crystalRecommendations: crystalResult.data },
    context
  );
  const scores = scoreDesignTemplates({
    request,
    emotionTags: ["calm", "renewal"],
    styleTags: ["minimal", "eastern-contemporary"],
    crystalRecommendations: crystalResult.data,
    pricingContext: pricingContext.data
  });
  assert.equal(scores[0]?.template.designId, "template-rain-after-blue");
  assert.ok((scores[0]?.score ?? 0) > (scores[3]?.score ?? 0));
});

test("Design Agent returns three differentiated candidates with actual ordered bead sequences", async () => {
  const candidates = await readyCandidates();
  assert.equal(new Set(candidates.map((candidate) => candidate.sourceTemplateIds[0])).size, 3);
  assert.equal(new Set(candidates.map((candidate) => candidate.components.map((component) => component.beadProductId).join("|"))).size, 3);
  for (const candidate of candidates) {
    assert.equal(candidate.components.length, 12);
    assert.deepEqual(candidate.components.map((component) => component.positionIndex), [...Array(12).keys()]);
    assert.equal("count" in candidate.components[0]!, false);
  }
});

test("Compliance Agent detects all five restricted claim categories", async () => {
  const [base] = await readyCandidates();
  const cases = [
    ["This bracelet can cure illness.", "MEDICAL_EFFECT"],
    ["You have depression, according to this design.", "PSYCHOLOGICAL_DIAGNOSIS"],
    ["This design guarantees wealth.", "GUARANTEED_WEALTH"],
    ["这个手串保证改运。", "GUARANTEED_FORTUNE_CHANGE"],
    ["Your certain destiny will definitely happen.", "DETERMINISTIC_FORTUNE_PREDICTION"]
  ] as const;
  const agent = new RuleComplianceAgent();
  for (const [designStory, category] of cases) {
    const result = await agent.execute({ candidate: { ...base, designStory } }, context);
    assert.equal(result.data.status, "REJECTED");
    if (result.data.status !== "REJECTED") assert.fail("expected compliance rejection");
    assert.ok(result.data.issues.some((issue) => issue.category === category));
  }
});

test("invalid, non-object, and extra-field Provider outputs are rejected", async () => {
  const invalid = await generateRecommendations(new MockProvider("not-json"), request, context);
  assert.equal(invalid.status, "REJECTED");
  const candidates = await readyCandidates();
  const extra = await generateRecommendations(
    new MockProvider({ candidates, ownerId: "provider-attempt" }),
    request,
    context
  );
  assert.equal(extra.status, "REJECTED");
  if (extra.status !== "REJECTED") assert.fail("expected strict output rejection");
  assert.equal(extra.issues[0]?.code, "INVALID_PROVIDER_OUTPUT");
});

test("RuleBasedProvider results are deterministic", async () => {
  const first = await generateRecommendations(new RuleBasedProvider(), request, context);
  const second = await generateRecommendations(new RuleBasedProvider(), request, context);
  assert.deepEqual(second, first);
});

test("all provider candidates pass the strict Candidate Schema", async () => {
  const candidates = await readyCandidates();
  assert.equal(RecommendationProviderOutputSchema.safeParse({ candidates }).success, true);
  assert.ok(candidates.every((candidate) => AiBeadLayoutCandidateSchema.safeParse(candidate).success));
});

test("a generated AI Candidate can enter the server-owned DesignV1 adapter", async () => {
  const [candidate] = await readyCandidates();
  const catalogByProductId = Object.fromEntries(
    crystalFixtures.map((crystal) => [
      crystal.beadProductId,
      {
        crystalId: crystal.crystalId,
        materialKey: `${crystal.crystalId}-material-v1`,
        modelAssetKey: `round-${crystal.diameterMm}-v1`,
        textureAssetKey: `${crystal.crystalId}-texture-v1`,
        unitPriceMinor: crystal.catalogPriceMinor.CNY
      }
    ])
  );
  const result = aiBeadLayoutCandidateToDesignV1(candidate, {
    designId: "design-from-rule-provider",
    componentIds: candidate.components.map((_, index) => `component-${index}`),
    designMode: "AI_GENERATED",
    revision: 1,
    createdAt: "2026-07-21T10:00:00.000Z",
    updatedAt: "2026-07-21T10:00:00.000Z",
    locale: "zh-CN",
    currency: "CNY",
    bracelet: {
      wristCircumferenceMm: request.wristCircumferenceMm,
      targetInnerCircumferenceMm: 162,
      elasticAllowanceMm: 7,
      beadGapMm: 0.4
    },
    catalogByProductId,
    pricing: {
      laborFeeMinor: 0,
      designFeeMinor: 0,
      packagingFeeMinor: 0,
      platformFeeEstimateMinor: 0,
      logisticsFeeEstimateMinor: 0,
      discountMinor: 0,
      pricingVersion: "cny-test-v1",
      priceCalculatedAt: "2026-07-21T10:00:00.000Z"
    },
    provenance: {
      modelProvider: "rule-based-provider",
      modelName: "expert-rules-v1",
      promptVersion: "none",
      knowledgeBaseVersion: "ai-fixtures-v1",
      designTemplateVersion: candidate.sourceTemplateIds[0] ?? null
    },
    disclaimerKeys: ["CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT"]
  });
  assert.equal(result.status, "READY");
  if (result.status !== "READY") assert.fail("expected a DesignV1-ready candidate");
  assert.deepEqual(result.design.story.sourceTemplateIds, candidate.sourceTemplateIds);
  assert.equal(result.design.community.visibility, "PRIVATE");
});

test("CNY and TWD use independent budget contexts without exposing trusted prices", async () => {
  const provider = new RuleBasedProvider();
  const cny = await generateRecommendations(provider, request, context);
  const twd = await generateRecommendations(
    provider,
    { ...request, currency: "TWD", budgetMinor: 6_000 },
    context
  );
  assert.equal(cny.status, "READY");
  assert.equal(twd.status, "READY");
  if (cny.status !== "READY" || twd.status !== "READY") assert.fail("expected both currency groups");
  assert.equal(JSON.stringify(cny.candidates).includes("unitPriceMinor"), false);
  assert.equal(JSON.stringify(twd.candidates).includes("totalPriceMinor"), false);
});

test("AI cannot set price, cost, inventory, or publication state", async () => {
  const candidates = await readyCandidates();
  for (const forbidden of [
    { unitPriceMinor: 1 },
    { unitCostMinor: 1 },
    { totalPriceMinor: 1 },
    { inventoryQuantity: 999 },
    { visibility: "PUBLIC" },
    { publishConsent: true }
  ]) {
    const attempted = { ...candidates[0], ...forbidden };
    assert.equal(AiBeadLayoutCandidateSchema.safeParse(attempted).success, false);
  }
});
