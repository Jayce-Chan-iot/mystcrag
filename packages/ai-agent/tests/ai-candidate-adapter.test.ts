import assert from "node:assert/strict";
import test from "node:test";

import { DesignV1Schema } from "@mystcrag/design-contract";

import {
  aiCandidateToDesignV1,
  designV1ToAgentOutput,
  legacyDesignToAiCandidate,
  type AiDesignServerEnrichment
} from "../src/adapters/index";

const validCandidate = () => ({
  designName: "Blue Orbit",
  emotionTags: ["calm"],
  styleTags: ["minimal"],
  colorPalette: ["blue", "white"],
  culturalInspiration: [],
  designStory: "A translucent blue rhythm inspired by rainfall.",
  recommendationReasons: ["Matches the selected palette."],
  components: [
    {
      componentType: "BEAD",
      positionIndex: 0,
      crystalId: "crystal-aquamarine",
      beadProductId: "product-aquamarine-8",
      shape: "ROUND",
      diameterMm: 8,
      role: "MAIN"
    },
    {
      componentType: "BEAD",
      positionIndex: 1,
      crystalId: "crystal-moonstone",
      beadProductId: "product-moonstone-6",
      shape: "ROUND",
      diameterMm: 6,
      role: "ACCENT"
    }
  ]
});

const validEnrichment = (): AiDesignServerEnrichment => ({
  designId: "design-server-1",
  componentIds: ["component-server-1", "component-server-2"],
  designMode: "AI_GENERATED",
  revision: 1,
  createdAt: "2026-07-21T08:00:00.000Z",
  updatedAt: "2026-07-21T08:00:00.000Z",
  locale: "zh-CN",
  currency: "CNY",
  bracelet: {
    wristCircumferenceMm: 155,
    targetInnerCircumferenceMm: 162,
    elasticAllowanceMm: 7,
    beadGapMm: 0.4
  },
  catalogByProductId: {
    "product-aquamarine-8": {
      crystalId: "crystal-aquamarine",
      materialKey: "aquamarine-clear-v1",
      modelAssetKey: "round-8-v1",
      textureAssetKey: "aquamarine-v1",
      unitPriceMinor: 1200
    },
    "product-moonstone-6": {
      crystalId: "crystal-moonstone",
      materialKey: "moonstone-soft-v1",
      modelAssetKey: "round-6-v1",
      textureAssetKey: "moonstone-v1",
      unitPriceMinor: 800
    }
  },
  pricing: {
    laborFeeMinor: 500,
    designFeeMinor: 300,
    packagingFeeMinor: 200,
    platformFeeEstimateMinor: 100,
    logisticsFeeEstimateMinor: 600,
    discountMinor: 0,
    pricingVersion: "cny-retail-2026-07-v1",
    priceCalculatedAt: "2026-07-21T08:00:00.000Z"
  },
  provenance: {
    modelProvider: "provider-key",
    modelName: "model-key",
    promptVersion: "prompt-v1",
    knowledgeBaseVersion: "kb-v1",
    designTemplateVersion: null
  }
});

test("valid AI candidate converts with server-owned enrichment", () => {
  const result = aiCandidateToDesignV1(validCandidate(), validEnrichment());
  assert.equal(result.status, "READY");
  if (result.status !== "READY") {
    assert.fail("expected a READY conversion result");
  }
  assert.equal(result.design.designId, "design-server-1");
  assert.equal(result.design.beads[0]?.unitPriceMinor, 1200);
  assert.equal(result.design.community.visibility, "PRIVATE");
});

test("missing AI candidate fields are rejected", () => {
  const candidate = validCandidate() as Partial<ReturnType<typeof validCandidate>>;
  delete candidate.designName;
  assert.equal(aiCandidateToDesignV1(candidate, validEnrichment()).status, "REJECTED");
});

test("unknown or mismatched product IDs are rejected", () => {
  const unknownProduct = validCandidate();
  unknownProduct.components[0]!.beadProductId = "product-missing";
  const unknownResult = aiCandidateToDesignV1(unknownProduct, validEnrichment());
  assert.equal(unknownResult.status, "REJECTED");
  assert.equal(unknownResult.issues[0]?.code, "CATALOG_PRODUCT_NOT_FOUND");

  const baseEnrichment = validEnrichment();
  const mismatchEnrichment = {
    ...baseEnrichment,
    catalogByProductId: {
      ...baseEnrichment.catalogByProductId,
      "product-aquamarine-8": {
        ...baseEnrichment.catalogByProductId["product-aquamarine-8"]!,
        crystalId: "crystal-other"
      }
    }
  };
  const mismatchResult = aiCandidateToDesignV1(validCandidate(), mismatchEnrichment);
  assert.equal(mismatchResult.status, "REJECTED");
  assert.equal(mismatchResult.issues[0]?.code, "CATALOG_CRYSTAL_MISMATCH");
});

test("AI candidate cannot provide price or cost fields", () => {
  const priceAttempt = { ...validCandidate(), unitPriceMinor: 1 };
  assert.equal(aiCandidateToDesignV1(priceAttempt, validEnrichment()).status, "REJECTED");

  const costAttempt = { ...validCandidate(), unitCostMinor: 1 };
  assert.equal(aiCandidateToDesignV1(costAttempt, validEnrichment()).status, "REJECTED");
});

test("restricted effect copy is rejected during compliance normalization", () => {
  const candidate = validCandidate();
  candidate.designStory = "This invalid test copy guarantees wealth.";
  const result = aiCandidateToDesignV1(candidate, validEnrichment());
  assert.equal(result.status, "REJECTED");
  assert.equal(result.issues[0]?.code, "COMPLIANCE_REJECTED");
});

test("AI candidate cannot set PUBLIC visibility", () => {
  const candidate = { ...validCandidate(), visibility: "PUBLIC" };
  assert.equal(aiCandidateToDesignV1(candidate, validEnrichment()).status, "REJECTED");
});

test("non-contiguous candidate positions are rejected", () => {
  const candidate = validCandidate();
  candidate.components[1]!.positionIndex = 3;
  assert.equal(aiCandidateToDesignV1(candidate, validEnrichment()).status, "REJECTED");
});

test("provider non-object values are rejected", () => {
  assert.equal(aiCandidateToDesignV1("not-json", validEnrichment()).status, "REJECTED");
});

test("provider extra unknown fields are rejected", () => {
  const candidate = { ...validCandidate(), serverGeneratedId: "attempted-id" };
  assert.equal(aiCandidateToDesignV1(candidate, validEnrichment()).status, "REJECTED");
});

test("conversion result and public agent output pass shared schemas", () => {
  const result = aiCandidateToDesignV1(validCandidate(), validEnrichment());
  assert.equal(result.status, "READY");
  if (result.status !== "READY") {
    assert.fail("expected a READY conversion result");
  }
  assert.equal(DesignV1Schema.safeParse(result.design).success, true);
  assert.deepEqual(designV1ToAgentOutput(result.design).warnings, []);
});

test("legacy grouped output has an isolated compatibility adapter", () => {
  const candidate = legacyDesignToAiCandidate(
    {
      designName: "Legacy",
      story: "Compatibility-only grouped design.",
      style: "minimal",
      beads: [{ crystalId: "crystal-aquamarine", sizeMm: 8, count: 2 }]
    },
    { "crystal-aquamarine": "product-aquamarine-8" }
  );
  assert.deepEqual(
    candidate.components.map((component) => component.positionIndex),
    [0, 1]
  );
});
