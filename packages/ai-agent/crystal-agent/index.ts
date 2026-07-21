import type { Agent } from "../contracts";

export type CrystalAgentInput = {
  readonly emotionTags: readonly string[];
  readonly styleTags: readonly string[];
  readonly colorTags: readonly string[];
};

export type CrystalRecommendation = {
  readonly crystalId: string;
  readonly rationale: string;
};

export type CrystalAgent = Agent<CrystalAgentInput, readonly CrystalRecommendation[]>;
