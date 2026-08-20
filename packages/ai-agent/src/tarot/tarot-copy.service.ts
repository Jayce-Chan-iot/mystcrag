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

type RiskSignals = Readonly<{
  hidden: boolean;
  death: boolean;
  health: boolean;
  finance: boolean;
  relationship: boolean;
  lifeOutcome: boolean;
  material: boolean;
  efficacy: boolean;
  predictive: boolean;
  temporal: boolean;
  certain: boolean;
  diagnostic: boolean;
  outcomeAction: boolean;
}>;

const RISK_LEXICON = {
  death: ["die", "death", "dying", "pass away", "dead", "死亡", "死期", "去世", "会死"],
  health: ["cancer", "blood pressure", "glucose", "diabetes", "pregnant", "pregnancy", "disease", "illness", "condition", "disorder", "symptom", "anxiety", "anxious", "depression", "depressed", "panic", "pain", "insomnia", "medical", "癌症", "血压", "血糖", "糖尿病", "怀孕", "疾病", "病症", "症状", "焦虑", "抑郁", "恐慌", "疼痛", "失眠", "医学"],
  finance: ["wealth", "wealthy", "money", "rich", "financial", "investment", "savings", "profit", "return", "gain", "fortune", "财富", "金钱", "发财", "致富", "投资", "收益", "回报", "赚钱", "招财"],
  relationship: ["soulmate", "relationship", "marriage", "married", "divorce", "partner", "reconcile", "romance", "灵魂伴侣", "感情", "关系", "婚姻", "结婚", "离婚", "伴侣", "复合"],
  lifeOutcome: ["job", "career", "application", "accepted", "hired", "success", "succeed", "fail", "future", "outcome", "工作", "职业", "申请", "录用", "成功", "失败", "未来", "结果"],
  material: ["crystal", "bracelet", "gemstone", "quartz", "amethyst", "citrine", "jade", "bead", "水晶", "手串", "石英", "紫水晶", "黄水晶", "珠子", "宝石"],
  efficacy: ["cure", "heal", "treat", "prevent", "relieve", "reduce", "lower", "ease", "normalize", "attract", "bring", "ensure", "guarantee", "promise", "help with", "proven efficacy", "治愈", "治疗", "预防", "缓解", "降低", "改善", "正常化", "吸引", "招来", "保证", "确保", "功效", "疗效"],
  predictive: ["will", "shall", "going to", "when am", "when will", "whether", "destined", "predict", "会不会", "会", "将", "什么时候", "是否", "注定", "预测"],
  temporal: ["tomorrow", "next week", "next month", "next year", "this week", "this month", "this year", "soon", "in the future", "明天", "下周", "下个月", "明年", "今年", "未来", "很快"],
  certain: ["definitely", "certain", "certainly", "guaranteed", "inevitable", "destined", "prove", "risk free", "必定", "一定", "肯定", "无法避免", "注定", "稳赚", "保本"],
  diagnostic: ["diagnose", "identify", "do i have", "am i", "you have", "you are", "i have", "i am", "what disease", "what illness", "symptoms mean", "symptoms show", "诊断", "我得了什么病", "我有什么病", "你有", "你是", "我是", "症状说明", "症状意味着", "症状表明"],
  outcomeAction: ["get", "become", "meet", "end", "happen", "accepted", "hired", "married", "divorced", "reconcile", "succeed", "fail", "win", "lose", "pass away", "pregnant", "得到", "成为", "遇到", "结束", "发生", "录用", "结婚", "离婚", "复合", "成功", "失败", "去世", "怀孕"]
} as const;

const HIDDEN_CONTENT_DESCRIPTORS = [
  "private", "hidden", "internal", "confidential", "system", "developer",
  "私密", "私有", "隐藏", "内部", "保密", "系统", "开发者"
] as const;
const HIDDEN_CONTENT_OBJECTS = [
  "instruction", "prompt", "reasoning", "message", "thought", "指令", "提示词", "推理", "消息", "思维"
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

function classifyRisk(value: string): RiskSignals {
  const source = normalizeRiskText(value
    .replace(/\b(?:no|not|never)\b[^.!?;]{0,40}\b(?:guaranteed|certain|inevitable|destined|predetermined)\b/giu, "")
    .replace(/\bwithout\s+(?:predicting|guaranteeing)\b/giu, "")
    .replace(/(?:不|并非|无法).{0,16}(?:一定|必定|注定|肯定)/gu, ""));
  return {
    hidden: hasLexiconSignal(source, HIDDEN_CONTENT_DIRECT) ||
      (hasLexiconSignal(source, HIDDEN_CONTENT_DESCRIPTORS) &&
        hasLexiconSignal(source, HIDDEN_CONTENT_OBJECTS)),
    death: hasLexiconSignal(source, RISK_LEXICON.death),
    health: hasLexiconSignal(source, RISK_LEXICON.health),
    finance: hasLexiconSignal(source, RISK_LEXICON.finance),
    relationship: hasLexiconSignal(source, RISK_LEXICON.relationship),
    lifeOutcome: hasLexiconSignal(source, RISK_LEXICON.lifeOutcome),
    material: hasLexiconSignal(source, RISK_LEXICON.material),
    efficacy: hasLexiconSignal(source, RISK_LEXICON.efficacy),
    predictive: hasLexiconSignal(source, RISK_LEXICON.predictive),
    temporal: hasLexiconSignal(source, RISK_LEXICON.temporal),
    certain: hasLexiconSignal(source, RISK_LEXICON.certain),
    diagnostic: hasLexiconSignal(source, RISK_LEXICON.diagnostic),
    outcomeAction: hasLexiconSignal(source, RISK_LEXICON.outcomeAction)
  };
}

const hasUnsafeCategoryCombination = (signals: RiskSignals): boolean => {
  const sensitiveOutcome = signals.death || signals.health || signals.finance ||
    signals.relationship || signals.lifeOutcome;
  return signals.hidden ||
    (signals.material && signals.efficacy && (signals.health || signals.finance)) ||
    (signals.health && signals.diagnostic) ||
    (signals.death && (signals.predictive || signals.certain || signals.temporal)) ||
    (signals.predictive && sensitiveOutcome && (signals.temporal || signals.outcomeAction)) ||
    (signals.certain && sensitiveOutcome) ||
    (signals.finance && signals.efficacy);
};

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
  return hasUnsafeCategoryCombination(classifyRisk(copy));
}

const questionIsBlocked = (question: string): boolean => {
  const signals = classifyRisk(question);
  return signals.hidden ||
    (signals.death && (signals.predictive || signals.temporal || signals.outcomeAction));
};

const questionRequiresFallback = (question: string): boolean =>
  hasUnsafeCategoryCombination(classifyRisk(question));

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
