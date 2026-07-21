import type { Agent } from "../contracts";

export type EmotionAgentInput = {
  readonly text: string;
};

export type EmotionAgentOutput = {
  readonly emotionTags: readonly string[];
  readonly confidence: number;
};

export type EmotionAgent = Agent<EmotionAgentInput, EmotionAgentOutput>;
