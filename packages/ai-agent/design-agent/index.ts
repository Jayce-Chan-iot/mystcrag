import type { Agent, AgentContext, AgentResult } from "../contracts";
import type { CrystalRecommendation } from "../crystal-agent/index";
import type { AiBeadLayoutCandidate } from "../src/schemas/ai-bead-layout-candidate.schema";
import type { EmotionTag, PricingContext, RecommendationRequest, StyleTag } from "../src/contracts/recommendation";
import { designDnaFixtures, type DesignDnaFixture, type TemplateSlot } from "../src/fixtures/design-dna";

export type DesignAgentInput = {
  readonly request: RecommendationRequest;
  readonly emotionTags: readonly EmotionTag[];
  readonly styleTags: readonly StyleTag[];
  readonly crystalRecommendations: readonly CrystalRecommendation[];
  readonly pricingContext: PricingContext;
};

export type TemplateScore = {
  readonly template: DesignDnaFixture;
  readonly score: number;
  readonly matchedEmotionCount: number;
  readonly matchedStyleCount: number;
  readonly matchedColorCount: number;
};

function overlap(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

export function scoreDesignTemplates(input: DesignAgentInput): readonly TemplateScore[] {
  return designDnaFixtures
    .map((template) => {
      const matchedEmotionCount = overlap(template.emotionTags, input.emotionTags);
      const matchedStyleCount = overlap(template.styleTags, input.styleTags);
      const matchedColorCount = overlap(template.colorPalette, input.request.answers.colorTags);
      return {
        template,
        matchedEmotionCount,
        matchedStyleCount,
        matchedColorCount,
        score:
          matchedEmotionCount * 7 +
          matchedStyleCount * 6 +
          matchedColorCount * 8 +
          template.popularityScore / 100
      };
    })
    .sort((left, right) => right.score - left.score || left.template.designId.localeCompare(right.template.designId));
}

function pickCrystal(
  recommendations: readonly CrystalRecommendation[],
  slot: TemplateSlot,
  variantIndex: number
): CrystalRecommendation {
  if (recommendations.length === 0) {
    throw new Error("No eligible crystal products are available for design generation.");
  }
  const offset = slot === "PRIMARY" ? 0 : slot === "SECONDARY" ? 1 : 2;
  return recommendations[(variantIndex + offset) % recommendations.length]!;
}

function roleForSlot(slot: TemplateSlot): "MAIN" | "ACCENT" | "FOCAL" {
  return slot === "PRIMARY" ? "MAIN" : slot === "SECONDARY" ? "ACCENT" : "FOCAL";
}

function createCandidate(
  templateScore: TemplateScore,
  input: DesignAgentInput,
  variantIndex: number
): AiBeadLayoutCandidate {
  const { template } = templateScore;
  const components = template.sequence.map((slot, positionIndex) => {
    const { crystal } = pickCrystal(input.crystalRecommendations, slot, variantIndex);
    return {
      componentType: "BEAD" as const,
      positionIndex,
      crystalId: crystal.crystalId,
      beadProductId: crystal.beadProductId,
      shape: crystal.shape,
      diameterMm: crystal.diameterMm,
      role: roleForSlot(slot)
    };
  });

  return {
    designName: template.name,
    emotionTags: [...input.emotionTags],
    styleTags: [...template.styleTags],
    colorPalette: [...template.colorPalette],
    culturalInspiration: [
      {
        reference: `文化参考：${template.culturalReference}`,
        inspiration: `设计灵感：${template.designInspiration}；非科学功效。`,
        disclaimerKey: "CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT"
      }
    ],
    designStory: `${template.name} uses ${template.designInspiration} as a visual composition.`,
    recommendationReasons: [
      `Matched ${templateScore.matchedEmotionCount} emotion, ${templateScore.matchedStyleCount} style, and ${templateScore.matchedColorCount} color tags.`,
      `Uses only active, in-stock products eligible for the ${input.pricingContext.budgetBand.toLowerCase()} budget context.`,
      "The sequence lists every physical bead in its final ring order."
    ],
    sourceTemplateIds: [template.designId],
    components
  };
}

export class RuleBasedDesignAgent implements Agent<DesignAgentInput, readonly [AiBeadLayoutCandidate, AiBeadLayoutCandidate, AiBeadLayoutCandidate]> {
  readonly name = "rule-based-design-agent";

  async execute(input: DesignAgentInput, _context: AgentContext): Promise<AgentResult<readonly [AiBeadLayoutCandidate, AiBeadLayoutCandidate, AiBeadLayoutCandidate]>> {
    const templateScores = scoreDesignTemplates(input);
    const selected = templateScores.slice(0, 3);
    if (selected.length !== 3) {
      throw new Error("At least three Design DNA templates are required.");
    }
    const candidates = selected.map((template, index) => createCandidate(template, input, index));
    return {
      data: [candidates[0]!, candidates[1]!, candidates[2]!],
      warnings: []
    };
  }
}

export type DesignAgent = Agent<DesignAgentInput, readonly [AiBeadLayoutCandidate, AiBeadLayoutCandidate, AiBeadLayoutCandidate]>;
