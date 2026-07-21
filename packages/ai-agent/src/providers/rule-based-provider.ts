import { RuleBasedCrystalAgent } from "../../crystal-agent/index";
import { RuleBasedDesignAgent } from "../../design-agent/index";
import { RuleBasedEmotionAgent } from "../../emotion-agent/index";
import { PricingContextAgent } from "../../pricing-agent/index";
import type { AgentContext } from "../contracts/agent";
import {
  RecommendationRequestSchema,
  STANDARD_STYLE_TAGS,
  type RecommendationRequest,
  type StyleTag
} from "../contracts/recommendation";
import type { LLMProvider } from "./llm-provider";

function normalizeStyles(values: readonly string[]): readonly StyleTag[] {
  const lowerValues = new Set(values.map((value) => value.trim().toLocaleLowerCase()));
  const matched = STANDARD_STYLE_TAGS.filter((style) => lowerValues.has(style));
  return matched.length > 0 ? matched : ["minimal"];
}

export class RuleBasedProvider implements LLMProvider {
  readonly providerId = "rule-based-provider";
  readonly providerVersion = "1.0.0";

  private readonly emotionAgent = new RuleBasedEmotionAgent();
  private readonly crystalAgent = new RuleBasedCrystalAgent();
  private readonly pricingAgent = new PricingContextAgent();
  private readonly designAgent = new RuleBasedDesignAgent();

  async generate(requestInput: RecommendationRequest, context: AgentContext): Promise<unknown> {
    const request = RecommendationRequestSchema.parse(requestInput);
    const emotionResult = await this.emotionAgent.execute(
      { emotionGoals: request.answers.emotionGoals, freeText: request.answers.freeText },
      context
    );
    const styleTags = normalizeStyles(request.answers.styleTags);
    const crystalResult = await this.crystalAgent.execute(
      {
        emotionTags: emotionResult.data.emotionTags,
        styleTags,
        colorTags: request.answers.colorTags,
        currency: request.currency,
        budgetMinor: request.budgetMinor,
        excludedBeadProductIds: request.excludedBeadProductIds,
        expectedBeadCount: 12
      },
      context
    );
    const pricingResult = await this.pricingAgent.execute(
      { request, crystalRecommendations: crystalResult.data },
      context
    );
    const designResult = await this.designAgent.execute(
      {
        request,
        emotionTags: emotionResult.data.emotionTags,
        styleTags,
        crystalRecommendations: crystalResult.data,
        pricingContext: pricingResult.data
      },
      context
    );

    return { candidates: designResult.data };
  }
}
