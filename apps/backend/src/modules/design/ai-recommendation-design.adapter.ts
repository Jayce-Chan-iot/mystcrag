import {
  RuleBasedProvider,
  generateRecommendations,
  type AiBeadLayoutCandidate
} from "@mystcrag/ai-agent";
import type { GenerateDesignRequest } from "@mystcrag/design-contract";

import { DomainApiError } from "../../contracts/api-error.js";
import type {
  CatalogProduct,
  DesignGenerationAdapter
} from "./design-api.service.js";

const COLOR_TAGS: Record<string, readonly string[]> = {
  "mist-blue": ["blue", "white", "clear"],
  "mountain-purple": ["purple", "white", "cool"],
  "tea-amber": ["yellow", "brown", "warm"],
  "ink-neutral": ["black", "gray", "clear"]
};

const STYLE_TAGS: Record<string, string> = {
  eastern: "eastern-contemporary",
  organic: "natural",
  delicate: "romantic"
};

function candidateIndex(request: GenerateDesignRequest): number {
  if (request.styleTags.includes("layered-contrast")) return 1;
  if (request.styleTags.includes("focal-balance")) return 2;
  return 0;
}

function recommendationRequest(request: GenerateDesignRequest) {
  const culturalTags = request.styleTags.filter((tag) =>
    ["landscape", "season", "objects"].includes(tag)
  );
  return {
    answers: {
      emotionGoals: request.emotionTags,
      styleTags: request.styleTags.map((tag) => STYLE_TAGS[tag] ?? tag),
      colorTags: request.colorTags.flatMap((tag) => COLOR_TAGS[tag] ?? [tag]),
      ...(culturalTags.length === 0
        ? {}
        : { freeText: `文化灵感偏好：${culturalTags.join("、")}。仅作为设计参考。` })
    },
    currency: request.currency,
    budgetMinor: request.maxBudgetMinor ?? request.minBudgetMinor ?? 100_000,
    wristCircumferenceMm: request.wristCircumferenceMm,
    excludedBeadProductIds: request.excludedProductIds
  };
}

function adaptCandidate(
  candidate: AiBeadLayoutCandidate,
  catalog: readonly CatalogProduct[],
  optionIndex: number,
  excludedProductIds: readonly string[]
) {
  const excluded = new Set(excludedProductIds);
  const materials = catalog.filter(
    (product) =>
      product.productType === "MATERIAL" &&
      product.active &&
      !excluded.has(product.id)
  );
  if (materials.length === 0) {
    throw new DomainApiError("INVENTORY_CHANGED", "No active material is available.");
  }
  const materialByCrystal = new Map(
    materials.map((product) => [product.crystalId, product] as const)
  );
  const mappedCandidateIds = candidate.components.map((component, position) =>
    (materialByCrystal.get(component.crystalId) ??
      materials[(position + optionIndex) % materials.length]!).id
  );
  const firstPosition = new Map<string, number>();
  const frequency = new Map<string, number>();
  mappedCandidateIds.forEach((productId, position) => {
    if (!firstPosition.has(productId)) firstPosition.set(productId, position);
    frequency.set(productId, (frequency.get(productId) ?? 0) + 1);
  });
  const candidateRankedMaterials = [...materials].sort((left, right) =>
    (frequency.get(right.id) ?? 0) - (frequency.get(left.id) ?? 0) ||
    (firstPosition.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (firstPosition.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id)
  );

  const targetBeadCount = 12;
  let materialProductIds: string[];
  let compositionReason: string;
  if (candidateRankedMaterials.length === 1) {
    materialProductIds = Array.from(
      { length: targetBeadCount },
      () => candidateRankedMaterials[0]!.id
    );
    compositionReason =
      "Only one active, non-excluded material is available, so material diversity is not fabricated.";
  } else if (candidateRankedMaterials.length === 2) {
    const primaryId = candidateRankedMaterials[0]!.id;
    const secondaryId = candidateRankedMaterials[1]!.id;
    if (optionIndex === 0) {
      materialProductIds = Array.from(
        { length: targetBeadCount },
        (_, position) => (position % 2 === 0 ? primaryId : secondaryId)
      );
      compositionReason =
        "Uses an airy alternating rhythm so both eligible materials remain evenly visible.";
    } else if (optionIndex === 1) {
      materialProductIds = Array.from(
        { length: targetBeadCount },
        (_, position) => (Math.floor(position / 3) % 2 === 0 ? primaryId : secondaryId)
      );
      compositionReason =
        "Uses grouped three-bead color fields to create broad, layered contrast rather than a rotated alternating ring.";
    } else {
      materialProductIds = Array.from(
        { length: targetBeadCount },
        (_, position) =>
          position === 0 || position === 1 || position === targetBeadCount - 1
            ? secondaryId
            : primaryId
      );
      compositionReason =
        "Uses a three-bead focal arc with a dominant supporting field, changing both count balance and visual emphasis.";
    }
  } else {
    materialProductIds = Array.from(
      { length: targetBeadCount },
      (_, position) => mappedCandidateIds[position % mappedCandidateIds.length]!
    );
    compositionReason =
      "Preserves the validated AI candidate sequence across the active, non-excluded server catalog.";
  }
  return {
    designName: candidate.designName,
    materialProductIds,
    accessoryProductIds: [],
    designStory: [
      candidate.designStory,
      ...candidate.culturalInspiration.map(
        ({ reference, inspiration }) => `${reference}；${inspiration}`
      )
    ].join(" "),
    recommendationReasons: [...candidate.recommendationReasons, compositionReason],
    culturalInspiration: candidate.culturalInspiration,
    sourceTemplateIds: candidate.sourceTemplateIds,
    providerMetadata: {
      modelProvider: "rule-based",
      modelName: "mystcrag-rule-based-provider",
      promptVersion: "rule-recommendation-v1",
      knowledgeBaseVersion: "ai-fixtures-v1",
      designTemplateVersion: candidate.sourceTemplateIds[0] ?? null
    }
  };
}

export class AiRecommendationDesignAdapter implements DesignGenerationAdapter {
  async generate(
    request: GenerateDesignRequest,
    catalog: readonly CatalogProduct[]
  ): Promise<unknown> {
    const result = await generateRecommendations(
      new RuleBasedProvider(),
      recommendationRequest(request),
      { requestId: request.requestId, locale: request.locale }
    );
    if (result.status !== "READY") {
      const complianceRejected = result.issues.some(
        ({ code }) => code === "COMPLIANCE_REJECTED"
      );
      throw new DomainApiError(
        complianceRejected ? "COMPLIANCE_BLOCKED" : "INTERNAL_ERROR",
        complianceRejected
          ? "Recommendation copy did not pass compliance review."
          : "Recommendation generation failed."
      );
    }
    const optionIndex = candidateIndex(request);
    return adaptCandidate(
      result.candidates[optionIndex]!,
      catalog,
      optionIndex,
      request.excludedProductIds
    );
  }
}
