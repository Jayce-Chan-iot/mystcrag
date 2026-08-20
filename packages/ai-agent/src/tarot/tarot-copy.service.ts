import {
  TarotCopyInputSchema,
  TarotCopyResultSchema,
  TarotInterpretationSchema,
  type TarotCopyInput,
  type TarotCopyResult,
  type TarotInterpretation
} from "./tarot-copy.schema";

export const TAROT_COPY_POLICY_VERSION = "tarot-copy-policy-v1";
export const TAROT_FALLBACK_PROVIDER_ID = "mystcrag-deterministic-tarot-copy";
export const TAROT_FALLBACK_PROVIDER_VERSION = "1.0.0";

const EN_DISCLAIMER =
  "For reflection and design inspiration only; not deterministic advice and not a claim of crystal efficacy.";
const ZH_DISCLAIMER =
  "仅供自我反思与设计灵感，不构成确定性建议，也不声称水晶具有任何功效。";

const BLOCKED_QUESTION_RULES = [
  /(?:chain[ -]of[ -]thought|hidden reasoning|system prompt|developer message|internal prompt)/iu,
  /(?:思维链|隐藏推理|系统提示词|开发者消息)/u,
  /(?:when (?:will|am) i die|you (?:will|are going to) die|death is certain)/iu,
  /(?:我什么时候会死|你会死|死亡已确定)/u
] as const;

const UNSAFE_COPY_RULES = [
  /\b(?:cure|heal(?:ing)?|treat(?:ment)?|prevent disease|medical efficacy|diagnos(?:e|is))\b/iu,
  /(?:治愈|治疗|疗效|治病|诊断|医学功效)/u,
  /(?:you (?:are|have) (?:depressed|depression|anxious|anxiety)|你有抑郁|你有焦虑)/iu,
  /(?:crystal|bracelet).{0,48}(?:will|can|guarantees?|proven|efficacy|cures?|heals?)/iu,
  /(?:水晶|手串).{0,32}(?:会|能|可以|保证|必定).{0,24}(?:疗效|治愈|改运|招财|能量|功效)/u,
  /(?:will definitely|is destined to|are destined to|certain destiny|future is certain|cards? (?:prove|guarantee).{0,36}\bwill\b)/iu,
  /(?:必定|一定会|命中注定|未来已确定|确定性命运)/u,
  /(?:you (?:will|are going to) die|death is certain|when you will die)/iu,
  /(?:你会死|死亡已确定|死期)/u,
  /(?:guarantee(?:d|s)? .{0,24}(?:financial returns?|profit|wealth)|risk[- ]free profit|get rich for certain)/iu,
  /(?:保证|必定|一定).{0,24}(?:收益|赚钱|招财|致富)|(?:稳赚|保本收益)/u
] as const;

export interface TarotCopyProvider {
  readonly providerId: string;
  readonly providerVersion: string;
  generate(input: TarotCopyInput): Promise<unknown>;
}

export class TarotCopyComplianceError extends Error {
  readonly code = "COMPLIANCE_BLOCKED" as const;

  constructor() {
    super("This question cannot be used for Tarot interpretation.");
    this.name = "TarotCopyComplianceError";
  }
}

const isChineseLocale = (locale: string): boolean =>
  locale.toLowerCase().startsWith("zh");

const boundedText = (value: string, maximum: number): string =>
  value.slice(0, maximum).trim();

function deterministicFallback(input: TarotCopyInput): TarotInterpretation {
  const chinese = isChineseLocale(input.locale);
  return TarotInterpretationSchema.parse({
    headline: chinese ? "从牌面意象出发的三种灵感" : "Three directions for reflection",
    summary: chinese
      ? "将已揭示的图像作为温和的反思提示，再比较平衡、对比与中性主导的视觉方向。"
      : "Use the revealed imagery as a gentle prompt while comparing balanced, contrasting, and neutral-led visual directions.",
    cardReflections: input.cards.map((card) => ({
      slot: card.slot,
      reflection: boundedText(chinese
        ? `留意「${card.nameZh}」中哪些色彩与形态最能引发你当下的联想。`
        : `Notice which colors and forms in ${card.nameEn} invite reflection for you today.`, 160)
    })),
    designRationale: boundedText(chinese
      ? `以${input.palette.primary}、${input.palette.support}与${input.palette.accent}建立层次，通过珠子节奏与视觉焦点呈现三种设计方向。`
      : `${input.palette.primary}, ${input.palette.support}, and ${input.palette.accent} create three design directions through varied bead rhythm and visual focus.`, 240),
    disclaimer: chinese ? ZH_DISCLAIMER : EN_DISCLAIMER
  });
}

function containsRestrictedCopy(interpretation: TarotInterpretation): boolean {
  const copy = [
    interpretation.headline,
    interpretation.summary,
    ...interpretation.cardReflections.map(({ reflection }) => reflection),
    interpretation.designRationale
  ].join("\n");
  return UNSAFE_COPY_RULES.some((rule) => rule.test(copy));
}

const questionIsBlocked = (question: string): boolean =>
  BLOCKED_QUESTION_RULES.some((rule) => rule.test(question));

const questionRequiresFallback = (question: string): boolean =>
  UNSAFE_COPY_RULES.some((rule) => rule.test(question));

function fallbackResult(input: TarotCopyInput): TarotCopyResult {
  return TarotCopyResultSchema.parse({
    interpretation: deterministicFallback(input),
    source: {
      mode: "DETERMINISTIC_FALLBACK",
      providerId: TAROT_FALLBACK_PROVIDER_ID,
      providerVersion: TAROT_FALLBACK_PROVIDER_VERSION,
      policyVersion: TAROT_COPY_POLICY_VERSION
    }
  });
}

export class TarotCopyService {
  constructor(private readonly dependencies: { readonly provider?: TarotCopyProvider } = {}) {}

  async createInterpretation(inputValue: TarotCopyInput): Promise<TarotCopyResult> {
    const input = TarotCopyInputSchema.parse(inputValue);
    if (input.question && questionIsBlocked(input.question)) {
      throw new TarotCopyComplianceError();
    }
    if (input.question && questionRequiresFallback(input.question)) {
      return fallbackResult(input);
    }

    const provider = this.dependencies.provider;
    if (!provider) return fallbackResult(input);

    let providerOutput: unknown;
    try {
      providerOutput = await provider.generate(input);
    } catch {
      return fallbackResult(input);
    }
    try {
      const parsed = TarotInterpretationSchema.safeParse(providerOutput);
      if (!parsed.success) return fallbackResult(input);
      if (
        parsed.data.cardReflections.length !== input.cards.length ||
        parsed.data.cardReflections.some(
          (reflection, index) => reflection.slot !== input.cards[index]?.slot
        ) ||
        containsRestrictedCopy(parsed.data)
      ) {
        return fallbackResult(input);
      }
      const providerId = provider.providerId;
      const providerVersion = provider.providerVersion;
      if (
        typeof providerId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(providerId) ||
        typeof providerVersion !== "string" ||
        providerVersion.trim().length === 0 ||
        providerVersion.length > 80
      ) {
        return fallbackResult(input);
      }

      return TarotCopyResultSchema.parse({
        interpretation: {
          ...parsed.data,
          disclaimer: isChineseLocale(input.locale) ? ZH_DISCLAIMER : EN_DISCLAIMER
        },
        source: {
          mode: "PROVIDER",
          providerId,
          providerVersion,
          policyVersion: TAROT_COPY_POLICY_VERSION
        }
      });
    } catch {
      return fallbackResult(input);
    }
  }
}
