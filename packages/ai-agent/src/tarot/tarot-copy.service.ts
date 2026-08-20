import {
  TarotCopyInputSchema,
  TarotCopyResultSchema,
  TarotInterpretationSchema,
  type TarotCopyInput,
  type TarotCopyResult,
  type TarotInterpretation
} from "./tarot-copy.schema";

export const TAROT_COPY_POLICY_VERSION = "tarot-copy-policy-v2";
export const TAROT_FALLBACK_PROVIDER_ID = "mystcrag-deterministic-tarot-copy";
export const TAROT_FALLBACK_PROVIDER_VERSION = "1.0.0";

const EN_DISCLAIMER =
  "For reflection and design inspiration only; not deterministic advice and not a claim of crystal efficacy.";
const ZH_DISCLAIMER =
  "仅供自我反思与设计灵感，不构成确定性建议，也不声称水晶具有任何功效。";

const QUESTION_BLOCK_LEXICON = {
  death: ["die", "death", "dying", "pass away", "dead", "死亡", "死期", "去世", "会死"],
  predictive: ["will", "shall", "going to", "when am", "when will", "whether", "destined", "predict", "会不会", "会", "将", "什么时候", "是否", "注定", "预测"],
  temporal: ["tomorrow", "next week", "next month", "next year", "this week", "this month", "this year", "soon", "in the future", "明天", "下周", "下个月", "明年", "今年", "未来", "很快"],
  outcomeAction: ["get", "become", "meet", "end", "happen", "accepted", "hired", "married", "divorced", "reconcile", "succeed", "fail", "win", "lose", "pass away", "pregnant", "得到", "成为", "遇到", "结束", "发生", "录用", "结婚", "离婚", "复合", "成功", "失败", "去世", "怀孕"]
} as const;

const HIDDEN_CONTENT_DESCRIPTORS = [
  "private", "hidden", "internal", "confidential", "system", "developer", "initial", "initialized",
  "私密", "私有", "隐藏", "内部", "保密", "系统", "开发者", "初始", "初始化"
] as const;
const HIDDEN_CONTENT_OBJECTS = [
  "instruction", "directive", "rule", "prompt", "reasoning", "message", "thought",
  "指令", "规则", "提示词", "推理", "消息", "思维"
] as const;
const HIDDEN_CONTENT_DIRECT = ["chain of thought", "思维链"] as const;

function normalizeRiskText(value: string): { normalized: string; tokens: ReadonlySet<string> } {
  const normalized = value.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019]/gu, "'")
    .replace(/[^\p{Letter}\p{Number}%]+/gu, " ").trim().replace(/\s+/gu, " ");
  const tokens = new Set<string>();
  for (const token of normalized.match(/[a-z0-9]+/gu) ?? []) {
    tokens.add(token);
    if (token.endsWith("ies") && token.length > 4) tokens.add(`${token.slice(0, -3)}y`);
    if (token.endsWith("ing") && token.length > 5) tokens.add(token.slice(0, -3));
    if (token.endsWith("ed") && token.length > 4) tokens.add(token.slice(0, -2));
    if (token.endsWith("s") && token.length > 3) tokens.add(token.slice(0, -1));
  }
  return { normalized, tokens };
}

function hasLexiconSignal(
  source: ReturnType<typeof normalizeRiskText>,
  lexicon: readonly string[]
): boolean {
  return lexicon.some((entry) => {
    const normalizedEntry = entry.normalize("NFKC").toLowerCase();
    return /^[a-z0-9]+$/u.test(normalizedEntry)
      ? source.tokens.has(normalizedEntry)
      : source.normalized.includes(normalizedEntry);
  });
}

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

const hasAnyTerm = (source: ReturnType<typeof normalizeRiskText>, terms: readonly string[]): boolean =>
  hasLexiconSignal(source, terms);

const normalizeApprovedCopy = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ");

function approvedTemplateMatch(
  interpretation: TarotInterpretation,
  approved: TarotInterpretation
): TarotInterpretation | undefined {
  const matches =
    normalizeApprovedCopy(interpretation.headline) === normalizeApprovedCopy(approved.headline) &&
    normalizeApprovedCopy(interpretation.summary) === normalizeApprovedCopy(approved.summary) &&
    normalizeApprovedCopy(interpretation.designRationale) ===
      normalizeApprovedCopy(approved.designRationale) &&
    interpretation.cardReflections.length === approved.cardReflections.length &&
    interpretation.cardReflections.every((reflection, index) => {
      const approvedReflection = approved.cardReflections[index];
      return approvedReflection !== undefined &&
        reflection.slot === approvedReflection.slot &&
        normalizeApprovedCopy(reflection.reflection) ===
          normalizeApprovedCopy(approvedReflection.reflection);
    });
  return matches ? approved : undefined;
}

function containsHiddenContentReference(value: string): boolean {
  const source = normalizeRiskText(value);
  return hasAnyTerm(source, HIDDEN_CONTENT_DIRECT) ||
    (hasAnyTerm(source, HIDDEN_CONTENT_DESCRIPTORS) && hasAnyTerm(source, HIDDEN_CONTENT_OBJECTS));
}

function containsLifespanLanguage(value: string): boolean {
  const normalized = normalizeRiskText(value).normalized;
  return /\bhow long (?:will|do|can) (?:i|you|they) live\b/u.test(normalized) ||
    /\b(?:will|can|may) (?:i|you|they) live (?:through|for|until)\b/u.test(normalized) ||
    /\b(?:i|you|they) (?:will|can|may) live (?:through|for|until)\b/u.test(normalized) ||
    /\b(?:will|can|may) (?:i|you|they) survive\b/u.test(normalized) ||
    /\b(?:i|you|they) will survive\b/u.test(normalized) ||
    /\b(?:i|you|they) (?:are )?going to live\b/u.test(normalized) ||
    /\b(?:lifespan|life expectancy)\b/u.test(normalized) ||
    /(?:还能活多久|能活到|寿命|余命|会长寿|将长寿)/u.test(normalized);
}

const questionIsBlocked = (question: string): boolean => {
  const source = normalizeRiskText(question);
  const death = hasAnyTerm(source, QUESTION_BLOCK_LEXICON.death);
  const predictive = hasAnyTerm(source, QUESTION_BLOCK_LEXICON.predictive);
  const temporal = hasAnyTerm(source, QUESTION_BLOCK_LEXICON.temporal);
  const outcomeAction = hasAnyTerm(source, QUESTION_BLOCK_LEXICON.outcomeAction);
  return containsHiddenContentReference(question) || containsLifespanLanguage(question) ||
    (death && (predictive || temporal || outcomeAction));
};

function fallbackResult(interpretation: TarotInterpretation): TarotCopyResult {
  return TarotCopyResultSchema.parse({
    interpretation,
    source: {
      mode: "DETERMINISTIC_FALLBACK",
      providerId: TAROT_FALLBACK_PROVIDER_ID,
      providerVersion: TAROT_FALLBACK_PROVIDER_VERSION,
      policyVersion: TAROT_COPY_POLICY_VERSION
    }
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const property of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export class TarotCopyService {
  constructor(private readonly dependencies: { readonly provider?: TarotCopyProvider } = {}) {}

  async createInterpretation(inputValue: TarotCopyInput): Promise<TarotCopyResult> {
    const authoritativeInput = TarotCopyInputSchema.parse(inputValue);
    const approvedInterpretation = deterministicFallback(authoritativeInput);
    if (authoritativeInput.question && questionIsBlocked(authoritativeInput.question)) {
      throw new TarotCopyComplianceError();
    }
    if (authoritativeInput.question) {
      return fallbackResult(approvedInterpretation);
    }

    const provider = this.dependencies.provider;
    if (!provider) return fallbackResult(approvedInterpretation);

    const providerInput = deepFreeze(TarotCopyInputSchema.parse(authoritativeInput));

    let providerOutput: unknown;
    try {
      providerOutput = await provider.generate(providerInput);
    } catch {
      return fallbackResult(approvedInterpretation);
    }
    try {
      const parsed = TarotInterpretationSchema.safeParse(providerOutput);
      if (!parsed.success) return fallbackResult(approvedInterpretation);
      const approvedProviderInterpretation = approvedTemplateMatch(
        parsed.data,
        approvedInterpretation
      );
      if (
        parsed.data.cardReflections.length !== authoritativeInput.cards.length ||
        parsed.data.cardReflections.some(
          (reflection, index) => reflection.slot !== authoritativeInput.cards[index]?.slot
        ) ||
        !approvedProviderInterpretation
      ) {
        return fallbackResult(approvedInterpretation);
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
        return fallbackResult(approvedInterpretation);
      }

      return TarotCopyResultSchema.parse({
        interpretation: approvedProviderInterpretation,
        source: {
          mode: "PROVIDER",
          providerId,
          providerVersion,
          policyVersion: TAROT_COPY_POLICY_VERSION
        }
      });
    } catch {
      return fallbackResult(approvedInterpretation);
    }
  }
}
