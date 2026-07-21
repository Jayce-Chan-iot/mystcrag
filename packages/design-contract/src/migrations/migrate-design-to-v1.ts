import { z } from "zod";

import { DESIGN_SCHEMA_VERSION } from "../constants/versions";
import { DesignV1Schema, type DesignV1 } from "../schemas/design.schema";
import { LegacyInitialDesignSchema, type LegacyInitialDesign } from "./legacy-initial.schema";

export const MigrationWarningSchema = z.strictObject({
  code: z.enum([
    "LEGACY_ORDER_NOT_RECOVERABLE",
    "LEGACY_CATALOG_DATA_SYNTHESIZED",
    "UNKNOWN_SCHEMA_VERSION",
    "INVALID_INPUT"
  ]),
  message: z.string().trim().min(1),
  fieldPath: z.string().trim().min(1).optional()
});

export type MigrationWarning = z.infer<typeof MigrationWarningSchema>;

export type MigrationResult =
  | { status: "MIGRATED"; design: DesignV1; warnings: MigrationWarning[] }
  | { status: "REQUIRES_REVIEW"; design: DesignV1; warnings: MigrationWarning[] }
  | { status: "REJECTED"; design?: undefined; warnings: MigrationWarning[] };

function buildLegacyCandidate(legacy: LegacyInitialDesign): DesignV1 {
  const beads = legacy.beads.flatMap((group, groupIndex) =>
    Array.from({ length: group.count }, (_, beadIndex) => {
      const componentId = `legacy-bead-${groupIndex + 1}-${beadIndex + 1}`;
      return {
        componentId,
        positionIndex: 0,
        beadProductId: `legacy-product-${groupIndex + 1}`,
        crystalId: group.crystalId,
        materialKey: `legacy-material-${groupIndex + 1}`,
        shape: "ROUND" as const,
        diameterMm: group.sizeMm,
        quantity: 1 as const,
        role: "MAIN" as const,
        modelAssetKey: `legacy-round-${group.sizeMm}mm`,
        textureAssetKey: `legacy-texture-${groupIndex + 1}`,
        unitPriceMinor: 0
      };
    })
  );

  beads.forEach((bead, positionIndex) => {
    bead.positionIndex = positionIndex;
  });

  const billOfMaterials = legacy.beads.map((group, groupIndex) => ({
    productId: `legacy-product-${groupIndex + 1}`,
    specification: `ROUND ${group.sizeMm}mm`,
    quantity: group.count,
    sourceComponentIds: beads
      .filter((bead) => bead.beadProductId === `legacy-product-${groupIndex + 1}`)
      .map((bead) => bead.componentId)
  }));

  const pricingVersion = `${legacy.currency.toLowerCase()}-legacy-unpriced`;
  return DesignV1Schema.parse({
    schemaVersion: DESIGN_SCHEMA_VERSION,
    designId: legacy.designId,
    designName: legacy.designName,
    designMode: "AI_GENERATED",
    revision: 1,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    locale: legacy.locale,
    currency: legacy.currency,
    bracelet: {
      wristCircumferenceMm: legacy.wristCircumferenceMm,
      targetInnerCircumferenceMm: legacy.wristCircumferenceMm + 7,
      elasticAllowanceMm: 7,
      braceletLayout: "CIRCLE",
      beadGapMm: 0,
      totalBeadCount: beads.length
    },
    beads,
    accessories: [],
    story: {
      emotionTags: [],
      styleTags: [legacy.style],
      colorPalette: [],
      culturalInspiration: [],
      designStory: legacy.story,
      recommendationReasons: [],
      sourceTemplateIds: []
    },
    pricing: {
      materialSubtotalMinor: 0,
      accessorySubtotalMinor: 0,
      laborFeeMinor: 0,
      designFeeMinor: 0,
      packagingFeeMinor: 0,
      platformFeeEstimateMinor: 0,
      logisticsFeeEstimateMinor: 0,
      discountMinor: 0,
      adjustments: [],
      totalPriceMinor: 0,
      pricingVersion,
      priceCalculatedAt: legacy.updatedAt
    },
    production: {
      wristCircumferenceMm: legacy.wristCircumferenceMm,
      billOfMaterials,
      componentSequence: beads.map((bead) => bead.componentId),
      anchoredComponents: [],
      productionNotes: ["Legacy candidate requires catalog and sequence review."],
      substitutionRules: []
    },
    compliance: {
      complianceStatus: "PENDING",
      restrictedClaims: [],
      disclaimerKeys: [],
      reviewRequired: true
    },
    provenance: {
      generatedBy: "AI",
      modelProvider: null,
      modelName: null,
      promptVersion: null,
      knowledgeBaseVersion: null,
      designTemplateVersion: null,
      pricingRuleVersion: pricingVersion,
      sourceDesignId: null
    },
    community: {
      visibility: "PRIVATE",
      publishConsent: false,
      allowRemix: false,
      creatorDisplayMode: "ANONYMOUS"
    }
  });
}

export function migrateDesignToV1(input: unknown): MigrationResult {
  const currentResult = DesignV1Schema.safeParse(input);
  if (currentResult.success) {
    return { status: "MIGRATED", design: currentResult.data, warnings: [] };
  }

  const legacyResult = LegacyInitialDesignSchema.safeParse(input);
  if (legacyResult.success) {
    return {
      status: "REQUIRES_REVIEW",
      design: buildLegacyCandidate(legacyResult.data),
      warnings: [
        {
          code: "LEGACY_ORDER_NOT_RECOVERABLE",
          message: "Grouped legacy bead counts cannot recover the original physical order.",
          fieldPath: "beads"
        },
        {
          code: "LEGACY_CATALOG_DATA_SYNTHESIZED",
          message: "Product, material, asset, and price fields are deterministic placeholders.",
          fieldPath: "beads"
        }
      ]
    };
  }

  const schemaVersion =
    typeof input === "object" && input !== null && "schemaVersion" in input
      ? (input as { schemaVersion?: unknown }).schemaVersion
      : undefined;

  if (typeof schemaVersion === "string" && schemaVersion !== DESIGN_SCHEMA_VERSION) {
    return {
      status: "REJECTED",
      warnings: [
        {
          code: "UNKNOWN_SCHEMA_VERSION",
          message: `Unsupported design schema version: ${schemaVersion}`,
          fieldPath: "schemaVersion"
        }
      ]
    };
  }

  return {
    status: "REJECTED",
    warnings: [
      {
        code: "INVALID_INPUT",
        message: "Input is neither a valid DesignV1 nor a supported legacy design."
      }
    ]
  };
}
