import {
  RuleBasedProvider,
  generateRecommendations,
  type AiDesignCandidate
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
  candidate: AiDesignCandidate,
  catalog: readonly CatalogProduct[],
  optionIndex: number
) {
  const materials = catalog.filter(
    (product) => product.productType === "MATERIAL" && product.active
  );
  if (materials.length === 0) {
    throw new DomainApiError("INVENTORY_CHANGED", "No active material is available.");
  }
  const materialByCrystal = new Map(
    materials.map((product) => [product.crystalId, product] as const)
  );
  const materialProductIds = candidate.components.map((component, position) =>
    (materialByCrystal.get(component.crystalId) ??
      materials[(position + optionIndex) % materials.length]!).id
  );
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
    recommendationReasons: candidate.recommendationReasons,
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
    return adaptCandidate(result.candidates[optionIndex]!, catalog, optionIndex);
  }
}
