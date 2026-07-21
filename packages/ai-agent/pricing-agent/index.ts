import type { Agent, AgentContext, AgentResult } from "../contracts";
import type { RecommendationRequest, PricingContext } from "../src/contracts/recommendation";
import type { CrystalRecommendation } from "../crystal-agent/index";

export type PricingAgentInput = {
  readonly request: RecommendationRequest;
  readonly crystalRecommendations: readonly CrystalRecommendation[];
};

export type PricingAgentOutput = PricingContext;

export class PricingContextAgent implements Agent<PricingAgentInput, PricingAgentOutput> {
  readonly name = "pricing-context-agent";

  async execute(input: PricingAgentInput, _context: AgentContext): Promise<AgentResult<PricingAgentOutput>> {
    const entryCeiling = input.request.currency === "CNY" ? 8_000 : 4_000;
    const coreCeiling = input.request.currency === "CNY" ? 18_000 : 9_000;
    const budgetBand = input.request.budgetMinor <= entryCeiling
      ? "ENTRY"
      : input.request.budgetMinor <= coreCeiling
        ? "CORE"
        : "PREMIUM";

    return {
      data: {
        currency: input.request.currency,
        budgetBand,
        eligibleProductIds: input.crystalRecommendations.map(({ crystal }) => crystal.beadProductId)
      },
      warnings: []
    };
  }
}

export type PricingAgent = Agent<PricingAgentInput, PricingAgentOutput>;
