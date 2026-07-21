import type { SupportedCurrency } from "@mystcrag/design-contract";

import type { Agent, AgentContext, AgentResult } from "../contracts";
import type { EmotionTag, StyleTag } from "../src/contracts/recommendation";
import { crystalFixtures, type CrystalFixture } from "../src/fixtures/crystals";

export type CrystalAgentInput = {
  readonly emotionTags: readonly EmotionTag[];
  readonly styleTags: readonly StyleTag[];
  readonly colorTags: readonly string[];
  readonly currency: SupportedCurrency;
  readonly budgetMinor: number;
  readonly excludedBeadProductIds: readonly string[];
  readonly expectedBeadCount?: number;
};

export type CrystalRecommendation = {
  readonly crystal: CrystalFixture;
  readonly score: number;
  readonly reasons: readonly string[];
};

function overlap(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

export class RuleBasedCrystalAgent implements Agent<CrystalAgentInput, readonly CrystalRecommendation[]> {
  readonly name = "rule-based-crystal-agent";

  async execute(input: CrystalAgentInput, _context: AgentContext): Promise<AgentResult<readonly CrystalRecommendation[]>> {
    const expectedBeadCount = input.expectedBeadCount ?? 12;
    const unitBudgetCeiling = Math.floor(input.budgetMinor / expectedBeadCount);
    const excluded = new Set(input.excludedBeadProductIds);

    const recommendations = crystalFixtures
      .filter((crystal) => crystal.productStatus === "ACTIVE")
      .filter((crystal) => crystal.inventoryQuantity >= expectedBeadCount)
      .filter((crystal) => !excluded.has(crystal.beadProductId))
      .filter((crystal) => crystal.catalogPriceMinor[input.currency] <= unitBudgetCeiling)
      .map((crystal) => {
        const emotionMatches = overlap(crystal.emotionTags, input.emotionTags);
        const styleMatches = overlap(crystal.styleTags, input.styleTags);
        const colorMatches = overlap(crystal.colorTags, input.colorTags);
        return {
          crystal,
          score: emotionMatches * 5 + styleMatches * 4 + colorMatches * 6 + crystal.popularityScore / 100,
          reasons: [
            ...(emotionMatches > 0 ? ["emotion-tag match"] : []),
            ...(styleMatches > 0 ? ["style-tag match"] : []),
            ...(colorMatches > 0 ? ["color-tag match"] : []),
            "available catalog product within the per-bead budget context"
          ]
        } satisfies CrystalRecommendation;
      })
      .sort((left, right) => right.score - left.score || left.crystal.beadProductId.localeCompare(right.crystal.beadProductId));

    return {
      data: recommendations,
      warnings: recommendations.length < 3 ? ["Fewer than three eligible crystal products remain after budget and inventory filters."] : []
    };
  }
}

export type CrystalAgent = Agent<CrystalAgentInput, readonly CrystalRecommendation[]>;
