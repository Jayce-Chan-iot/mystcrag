import type { ContractFixture } from "../types/index";
import { standardAiDesignFixture } from "./base-design";

const cloneStandardDesign = () => structuredClone(standardAiDesignFixture);

const diyDesign = cloneStandardDesign();
diyDesign.designId = "design-diy-standard";
diyDesign.designName = "Quiet Orbit";
diyDesign.designMode = "DIY_CREATED";
diyDesign.provenance = {
  generatedBy: "USER",
  modelProvider: null,
  modelName: null,
  promptVersion: null,
  knowledgeBaseVersion: null,
  designTemplateVersion: null,
  pricingRuleVersion: diyDesign.pricing.pricingVersion,
  sourceDesignId: null
};

const aiAssistedDesign = cloneStandardDesign();
aiAssistedDesign.designId = "design-ai-assisted";
aiAssistedDesign.designMode = "AI_ASSISTED";
aiAssistedDesign.revision = 2;
aiAssistedDesign.provenance.generatedBy = "AI_AND_USER";
aiAssistedDesign.provenance.sourceDesignId = standardAiDesignFixture.designId;

const mixedSizeDesign = cloneStandardDesign();
mixedSizeDesign.designId = "design-mixed-sizes";
mixedSizeDesign.designName = "Mixed Crystal Rhythm";

const accessoryDesign = cloneStandardDesign();
accessoryDesign.designId = "design-inline-and-anchored";
accessoryDesign.designName = "Silver Drop Rhythm";

const flaggedDesign = cloneStandardDesign();
flaggedDesign.designId = "design-flagged-claim";
flaggedDesign.story.designStory = "Invalid test copy: this bracelet guarantees wealth.";
flaggedDesign.compliance = {
  complianceStatus: "FLAGGED",
  restrictedClaims: [
    {
      code: "CLAIM_GUARANTEED_WEALTH",
      category: "GUARANTEED_WEALTH",
      fieldPath: "story.designStory",
      severity: "HIGH",
      userVisibleMessage: "Remove the guaranteed-effect wording before publication."
    }
  ],
  disclaimerKeys: ["CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT"],
  reviewRequired: true
};

const unauthorizedPublicDesign = cloneStandardDesign() as unknown as Record<string, unknown>;
unauthorizedPublicDesign.community = {
  visibility: "PUBLIC",
  publishConsent: false,
  allowRemix: true,
  creatorDisplayMode: "ANONYMOUS"
};

export const aiGeneratedStandardFixture = {
  category: "valid",
  description: "A standard AI-generated DesignV1.",
  data: standardAiDesignFixture
} satisfies ContractFixture;

export const diyCreatedFixture = {
  category: "valid",
  description: "A design created entirely by a user.",
  data: diyDesign
} satisfies ContractFixture;

export const aiAssistedFixture = {
  category: "valid",
  description: "An AI-generated design modified by a user.",
  data: aiAssistedDesign
} satisfies ContractFixture;

export const mixedBeadSizesFixture = {
  category: "valid",
  description: "A design mixing 6mm, 8mm, and 10mm beads.",
  data: mixedSizeDesign
} satisfies ContractFixture;

export const inlineAndAnchoredAccessoryFixture = {
  category: "valid",
  description: "A design with an INLINE spacer and an ANCHORED pendant.",
  data: accessoryDesign
} satisfies ContractFixture;

export const overBudgetFixture = {
  category: "invalid",
  description: "A valid design that exceeds the request budget and must be handled as a workflow warning.",
  data: {
    maxBudgetMinor: 5_000,
    design: cloneStandardDesign(),
    expectedWarningCode: "BUDGET_EXCEEDED"
  }
} satisfies ContractFixture;

export const unavailableMaterialFixture = {
  category: "invalid",
  description: "A valid design referencing an unavailable product.",
  data: {
    design: cloneStandardDesign(),
    unavailableProductIds: ["product-moonstone-round-6"],
    expectedWarningCode: "MATERIAL_UNAVAILABLE"
  }
} satisfies ContractFixture;

export const restrictedClaimFixture = {
  category: "flagged",
  description: "A design containing prohibited guaranteed-effect test copy and a structured claim.",
  data: flaggedDesign
} satisfies ContractFixture;

export const unauthorizedPublicFixture = {
  category: "invalid",
  description: "A design requesting public visibility without publication consent.",
  data: unauthorizedPublicDesign
} satisfies ContractFixture;

export const legacyMigrationFixture = {
  category: "migration",
  description: "The grouped initialization shape whose original physical order cannot be recovered.",
  data: {
    schemaVersion: "legacy-initial",
    designId: "legacy-design-1",
    designName: "Legacy Blue",
    story: "A historical grouped design used only for migration testing.",
    style: "minimal",
    beads: [
      { crystalId: "crystal-aquamarine", sizeMm: 8, count: 2 },
      { crystalId: "crystal-moonstone", sizeMm: 6, count: 1 }
    ],
    wristCircumferenceMm: 155,
    createdAt: "2026-07-21T05:00:00.000Z",
    updatedAt: "2026-07-21T05:10:00.000Z",
    locale: "zh-CN",
    currency: "CNY"
  }
} satisfies ContractFixture;

export { standardAiDesignFixture } from "./base-design";

export const designContractFixtures = {
  aiGeneratedStandard: aiGeneratedStandardFixture,
  diyCreated: diyCreatedFixture,
  aiAssisted: aiAssistedFixture,
  mixedBeadSizes: mixedBeadSizesFixture,
  inlineAndAnchoredAccessory: inlineAndAnchoredAccessoryFixture,
  overBudget: overBudgetFixture,
  unavailableMaterial: unavailableMaterialFixture,
  restrictedClaim: restrictedClaimFixture,
  unauthorizedPublic: unauthorizedPublicFixture,
  legacyMigration: legacyMigrationFixture
} as const;
