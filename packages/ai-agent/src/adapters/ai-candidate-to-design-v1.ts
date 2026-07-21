import {
  DesignV1Schema,
  type BeadV1,
  type DesignMode,
  type DesignV1,
  type DisclaimerKey,
  type PricingAdjustment,
  type SupportedCurrency
} from "@mystcrag/design-contract";

import { AiDesignCandidateSchema, type AiDesignCandidate } from "../schemas/ai-design-candidate.schema";

export type CatalogBeadEnrichment = {
  readonly crystalId: string;
  readonly materialKey: string;
  readonly modelAssetKey: string;
  readonly textureAssetKey: string;
  readonly unitPriceMinor: number;
};

export type AiDesignServerEnrichment = {
  readonly designId: string;
  readonly componentIds: readonly string[];
  readonly designMode: Extract<DesignMode, "AI_GENERATED" | "AI_ASSISTED">;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly locale: string;
  readonly currency: SupportedCurrency;
  readonly bracelet: {
    readonly wristCircumferenceMm: number;
    readonly targetInnerCircumferenceMm: number;
    readonly elasticAllowanceMm: number;
    readonly beadGapMm: number;
  };
  readonly catalogByProductId: Readonly<Record<string, CatalogBeadEnrichment>>;
  readonly pricing: {
    readonly laborFeeMinor: number;
    readonly designFeeMinor: number;
    readonly packagingFeeMinor: number;
    readonly platformFeeEstimateMinor: number;
    readonly logisticsFeeEstimateMinor: number;
    readonly discountMinor: number;
    readonly adjustments?: readonly PricingAdjustment[];
    readonly pricingVersion: string;
    readonly priceCalculatedAt: string;
  };
  readonly provenance: {
    readonly modelProvider: string;
    readonly modelName: string;
    readonly promptVersion: string;
    readonly knowledgeBaseVersion: string;
    readonly designTemplateVersion: string | null;
  };
  readonly disclaimerKeys?: readonly DisclaimerKey[];
};

export type AiCandidateConversionIssue = {
  readonly code:
    | "INVALID_CANDIDATE"
    | "CATALOG_PRODUCT_NOT_FOUND"
    | "CATALOG_CRYSTAL_MISMATCH"
    | "SERVER_ENRICHMENT_INVALID"
    | "COMPLIANCE_REJECTED";
  readonly message: string;
  readonly fieldPath?: string;
};

export type AiCandidateConversionResult =
  | { readonly status: "READY"; readonly design: DesignV1; readonly issues: readonly [] }
  | { readonly status: "REJECTED"; readonly issues: readonly AiCandidateConversionIssue[] };

const restrictedCopyRules = [
  {
    pattern: /(?:cure|diagnos|treat\s+(?:anxiety|depression)|治愈|治疗|诊断)/iu,
    category: "medical or diagnostic"
  },
  {
    pattern: /(?:guarantee(?:d|s)?\s+(?:wealth|fortune)|保证招财|保证改运)/iu,
    category: "guaranteed-effect"
  },
  {
    pattern: /(?:certain\s+destiny|deterministic\s+fortune|确定性命运)/iu,
    category: "deterministic-fortune"
  }
] as const;

function findRestrictedCopy(candidate: AiDesignCandidate): AiCandidateConversionIssue[] {
  const fields = [
    { fieldPath: "designStory", value: candidate.designStory },
    ...candidate.recommendationReasons.map((value, index) => ({
      fieldPath: `recommendationReasons.${index}`,
      value
    })),
    ...candidate.culturalInspiration.map((entry, index) => ({
      fieldPath: `culturalInspiration.${index}.inspiration`,
      value: entry.inspiration
    }))
  ];

  return fields.flatMap(({ fieldPath, value }) =>
    restrictedCopyRules
      .filter((rule) => rule.pattern.test(value))
      .map((rule) => ({
        code: "COMPLIANCE_REJECTED" as const,
        message: `AI candidate contains ${rule.category} wording.`,
        fieldPath
      }))
  );
}

export function aiCandidateToDesignV1(
  providerOutput: unknown,
  enrichment: AiDesignServerEnrichment
): AiCandidateConversionResult {
  const candidateResult = AiDesignCandidateSchema.safeParse(providerOutput);
  if (!candidateResult.success) {
    return {
      status: "REJECTED",
      issues: candidateResult.error.issues.map((issue) => ({
        code: "INVALID_CANDIDATE",
        message: issue.message,
        fieldPath: issue.path.join(".") || undefined
      }))
    };
  }

  const candidate = candidateResult.data;
  const complianceIssues = findRestrictedCopy(candidate);
  if (complianceIssues.length > 0) {
    return { status: "REJECTED", issues: complianceIssues };
  }

  if (enrichment.componentIds.length !== candidate.components.length) {
    return {
      status: "REJECTED",
      issues: [
        {
          code: "SERVER_ENRICHMENT_INVALID",
          message: "Server component IDs must match the candidate component count.",
          fieldPath: "componentIds"
        }
      ]
    };
  }

  const sortedComponents = [...candidate.components].sort(
    (left, right) => left.positionIndex - right.positionIndex
  );
  const beads: BeadV1[] = [];
  const catalogIssues: AiCandidateConversionIssue[] = [];

  for (const [index, component] of sortedComponents.entries()) {
    const catalogItem = enrichment.catalogByProductId[component.beadProductId];
    if (catalogItem === undefined) {
      catalogIssues.push({
        code: "CATALOG_PRODUCT_NOT_FOUND",
        message: `Unknown bead product: ${component.beadProductId}`,
        fieldPath: `components.${index}.beadProductId`
      });
      continue;
    }
    if (catalogItem.crystalId !== component.crystalId) {
      catalogIssues.push({
        code: "CATALOG_CRYSTAL_MISMATCH",
        message: `Product ${component.beadProductId} does not match the suggested crystal.`,
        fieldPath: `components.${index}.crystalId`
      });
      continue;
    }

    beads.push({
      componentId: enrichment.componentIds[index]!,
      positionIndex: component.positionIndex,
      beadProductId: component.beadProductId,
      crystalId: component.crystalId,
      materialKey: catalogItem.materialKey,
      shape: component.shape,
      diameterMm: component.diameterMm,
      quantity: 1 as const,
      role: component.role,
      modelAssetKey: catalogItem.modelAssetKey,
      textureAssetKey: catalogItem.textureAssetKey,
      unitPriceMinor: catalogItem.unitPriceMinor
    });
  }

  if (catalogIssues.length > 0) {
    return { status: "REJECTED", issues: catalogIssues };
  }

  const materialSubtotalMinor = beads.reduce((sum, bead) => sum + bead.unitPriceMinor, 0);
  const adjustments = [...(enrichment.pricing.adjustments ?? [])];
  const adjustmentTotal = adjustments.reduce((sum, adjustment) => sum + adjustment.amountMinor, 0);
  const totalPriceMinor =
    materialSubtotalMinor +
    enrichment.pricing.laborFeeMinor +
    enrichment.pricing.designFeeMinor +
    enrichment.pricing.packagingFeeMinor +
    enrichment.pricing.platformFeeEstimateMinor +
    enrichment.pricing.logisticsFeeEstimateMinor -
    enrichment.pricing.discountMinor +
    adjustmentTotal;

  const candidateDesign = {
    schemaVersion: "1.0.0",
    designId: enrichment.designId,
    designName: candidate.designName,
    designMode: enrichment.designMode,
    revision: enrichment.revision,
    createdAt: enrichment.createdAt,
    updatedAt: enrichment.updatedAt,
    locale: enrichment.locale,
    currency: enrichment.currency,
    bracelet: {
      ...enrichment.bracelet,
      braceletLayout: "CIRCLE",
      totalBeadCount: beads.length
    },
    beads,
    accessories: [],
    story: {
      emotionTags: candidate.emotionTags,
      styleTags: candidate.styleTags,
      colorPalette: candidate.colorPalette,
      culturalInspiration: candidate.culturalInspiration,
      designStory: candidate.designStory,
      recommendationReasons: candidate.recommendationReasons,
      sourceTemplateIds: enrichment.provenance.designTemplateVersion
        ? [enrichment.provenance.designTemplateVersion]
        : []
    },
    pricing: {
      materialSubtotalMinor,
      accessorySubtotalMinor: 0,
      laborFeeMinor: enrichment.pricing.laborFeeMinor,
      designFeeMinor: enrichment.pricing.designFeeMinor,
      packagingFeeMinor: enrichment.pricing.packagingFeeMinor,
      platformFeeEstimateMinor: enrichment.pricing.platformFeeEstimateMinor,
      logisticsFeeEstimateMinor: enrichment.pricing.logisticsFeeEstimateMinor,
      discountMinor: enrichment.pricing.discountMinor,
      adjustments,
      totalPriceMinor,
      pricingVersion: enrichment.pricing.pricingVersion,
      priceCalculatedAt: enrichment.pricing.priceCalculatedAt
    },
    production: {
      wristCircumferenceMm: enrichment.bracelet.wristCircumferenceMm,
      billOfMaterials: beads.map((bead) => ({
        productId: bead.beadProductId,
        specification: `${bead.shape} ${bead.diameterMm}mm`,
        quantity: 1,
        sourceComponentIds: [bead.componentId]
      })),
      componentSequence: beads.map((bead) => bead.componentId),
      anchoredComponents: [],
      productionNotes: [],
      substitutionRules: []
    },
    compliance: {
      complianceStatus: "PASSED",
      restrictedClaims: [],
      disclaimerKeys: [...(enrichment.disclaimerKeys ?? [])],
      reviewRequired: false
    },
    provenance: {
      generatedBy: enrichment.designMode === "AI_ASSISTED" ? "AI_AND_USER" : "AI",
      modelProvider: enrichment.provenance.modelProvider,
      modelName: enrichment.provenance.modelName,
      promptVersion: enrichment.provenance.promptVersion,
      knowledgeBaseVersion: enrichment.provenance.knowledgeBaseVersion,
      designTemplateVersion: enrichment.provenance.designTemplateVersion,
      pricingRuleVersion: enrichment.pricing.pricingVersion,
      sourceDesignId: null
    },
    community: {
      visibility: "PRIVATE",
      publishConsent: false,
      allowRemix: false,
      creatorDisplayMode: "ANONYMOUS"
    }
  };

  const designResult = DesignV1Schema.safeParse(candidateDesign);
  if (!designResult.success) {
    return {
      status: "REJECTED",
      issues: designResult.error.issues.map((issue) => ({
        code: "SERVER_ENRICHMENT_INVALID",
        message: issue.message,
        fieldPath: issue.path.join(".") || undefined
      }))
    };
  }

  return { status: "READY", design: designResult.data, issues: [] };
}
