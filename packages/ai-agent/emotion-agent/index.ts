import type { Agent, AgentContext, AgentResult } from "../contracts";
import {
  STANDARD_EMOTION_TAGS,
  type EmotionTag
} from "../src/contracts/recommendation";

export type EmotionAgentInput = {
  readonly emotionGoals: readonly string[];
  readonly freeText?: string;
};

export type EmotionAgentOutput = {
  readonly emotionTags: readonly EmotionTag[];
  readonly confidence: number;
};

const emotionKeywords: Readonly<Record<EmotionTag, readonly string[]>> = {
  calm: ["calm", "quiet", "peace", "relax", "平静", "放松", "安宁"],
  focus: ["focus", "clarity", "concentrate", "专注", "清晰", "集中"],
  confidence: ["confidence", "courage", "bold", "自信", "勇气", "坚定"],
  joy: ["joy", "happy", "bright", "喜悦", "快乐", "明朗"],
  connection: ["connection", "belong", "companionship", "连结", "陪伴", "亲密"],
  renewal: ["renewal", "fresh", "new start", "焕新", "新开始", "生机"]
};

export class RuleBasedEmotionAgent implements Agent<EmotionAgentInput, EmotionAgentOutput> {
  readonly name = "rule-based-emotion-agent";

  async execute(input: EmotionAgentInput, _context: AgentContext): Promise<AgentResult<EmotionAgentOutput>> {
    const text = [...input.emotionGoals, input.freeText ?? ""].join(" ").toLocaleLowerCase();
    const emotionTags = STANDARD_EMOTION_TAGS.filter((tag) =>
      emotionKeywords[tag].some((keyword) => text.includes(keyword))
    );
    const normalizedTags = emotionTags.length > 0 ? emotionTags : ["calm" as const];

    return {
      data: {
        emotionTags: normalizedTags,
        confidence: Math.min(1, 0.55 + normalizedTags.length * 0.15)
      },
      warnings: emotionTags.length === 0 ? ["No explicit emotion goal matched; calm was used as a neutral design tag."] : []
    };
  }
}

export type EmotionAgent = Agent<EmotionAgentInput, EmotionAgentOutput>;
