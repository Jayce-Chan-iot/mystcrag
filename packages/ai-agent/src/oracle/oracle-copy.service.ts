import {
  OracleCopyInputSchema,
  OracleCopyResultSchema,
  OracleInterpretationSchema,
  type OracleCopyInput,
  type OracleCopyResult,
  type OracleInterpretation
} from "./oracle-copy.schema.js";

export const ORACLE_COPY_POLICY_VERSION = "oracle-copy-policy-v1";
export const ORACLE_COPY_CONTENT_VERSION = "mystcrag-oracle-copy-v1";
export const ORACLE_FALLBACK_PROVIDER_ID = "mystcrag-deterministic-oracle-copy";
export const ORACLE_FALLBACK_PROVIDER_VERSION = "1.0.0";

const ZH_DISCLAIMER =
  "仅供自我观察、文化体验与设计灵感，不构成确定性建议，也不声称水晶具有任何功效。";
const EN_DISCLAIMER =
  "For reflection, cultural experience, and design inspiration only; not deterministic advice or a claim of crystal efficacy.";

const ZH_PROHIBITED_PHRASES = [
  "转运", "招财", "发财", "保平安", "辟邪", "开光", "加持", "治愈", "疗愈", "旺夫", "催旺",
  "桃花", "挽回", "命定", "注定", "一定", "必定", "大师", "治疗", "诊断", "心理疾病",
  "未来肯定", "保证成功", "保证发财", "前任会回来", "伴侣会回来", "现代释文原文照录", "转载自当代解读"
] as const;

const EN_PROHIBITED_PATTERNS = [
  /\b(?:heal|heals|healing|cure|cures|treat|treats|therapy|diagnose|diagnosis)\b/iu,
  /\b(?:guarantee|guarantees|guaranteed|definitely|destined|predestined|certain(?:ly)?)\b/iu,
  /\b(?:get rich|become rich|wealth guarantee|risk-free profit)\b/iu,
  /\b(?:partner|ex|lover)\b.{0,24}\b(?:return|reconcile|come back)\b/iu,
  /\b(?:copied from|excerpt from) (?:a )?modern (?:commentary|interpretation)\b/iu
] as const;

function normalizeRiskText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019]/gu, "'")
    .replace(/\s+/gu, " ").trim();
}

/** Defense-in-depth for fixtures and audits; display still requires exact template equality. */
export function hasProhibitedOracleClaim(value: string): boolean {
  const normalized = normalizeRiskText(value);
  if (ZH_PROHIBITED_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  if (/(^|[^\p{Letter}\p{Number}])旺($|[^\p{Letter}\p{Number}])/u.test(normalized)) return true;
  return EN_PROHIBITED_PATTERNS.some((pattern) => pattern.test(normalized));
}

const isChineseLocale = (locale: string): boolean => locale.toLowerCase().startsWith("zh");

const COLOR_LABELS = {
  "color:white": { zh: "月白", en: "moon white" },
  "color:gray": { zh: "岩灰", en: "stone gray" },
  "color:blue": { zh: "深蓝", en: "deep blue" },
  "color:black": { zh: "墨黑", en: "ink black" },
  "color:red": { zh: "朱红", en: "vermilion" },
  "color:orange": { zh: "暖橙", en: "warm orange" },
  "color:green": { zh: "青绿", en: "mineral green" },
  "color:teal": { zh: "黛青", en: "dark teal" },
  "color:brown": { zh: "沉木", en: "dark wood" },
  "color:yellow": { zh: "土黄", en: "earth yellow" }
} as const;

const RHYTHM_LABELS = {
  "rhythm:steady": { zh: "均衡留白", en: "measured spacing" },
  "rhythm:alternating": { zh: "交替节奏", en: "alternating rhythm" },
  "rhythm:gradual": { zh: "渐变层次", en: "graduated layers" },
  "rhythm:punctuated": { zh: "点状对比", en: "punctuated contrast" }
} as const;

function bounded(value: string, maximum: number): string {
  return value.slice(0, maximum).trim();
}

function colorLabel(tag: string, chinese: boolean): string {
  const label = COLOR_LABELS[tag as keyof typeof COLOR_LABELS];
  return label ? (chinese ? label.zh : label.en) : tag.replace(/^color:/u, "");
}

function rhythmLabel(tag: string, chinese: boolean): string {
  const label = RHYTHM_LABELS[tag as keyof typeof RHYTHM_LABELS];
  return label ? (chinese ? label.zh : label.en) : tag.replace(/^rhythm:/u, "");
}

function deterministicInterpretation(input: OracleCopyInput): OracleInterpretation {
  const chinese = isChineseLocale(input.locale);
  const moving = input.cast.movingLineIndices.length > 0;
  const primary = input.signal.primaryColorTags.map((tag) => colorLabel(tag, chinese)).join(chinese ? "、" : ", ");
  const support = input.signal.supportColorTags.map((tag) => colorLabel(tag, chinese)).join(chinese ? "、" : ", ");
  const rhythm = rhythmLabel(input.signal.rhythmTags[0] ?? "rhythm:steady", chinese);

  if (chinese) {
    return OracleInterpretationSchema.parse({
      headline: bounded(`「${input.cast.primaryHexagram.nameZh}」的水晶设计线索`, 48),
      summary: moving
        ? "从本卦到变卦的变化仅作为构图提示：先建立稳定主序，再在动爻位置加入轻重转折。"
        : "此卦可作为观察当前节奏的一个角度：以稳定秩序展开色彩与材质，不预设任何现实结果。",
      keywords: moving ? ["观察", "节奏", "转折"] : ["观察", "秩序", "留白"],
      designRationale: bounded(
        `以${primary}为主色${support ? `，以${support}为辅色` : ""}，用${rhythm}${moving ? `呼应第${input.cast.movingLineIndices.join("、")}爻的点睛位置` : "保持整体秩序"}。`,
        240
      ),
      disclaimer: ZH_DISCLAIMER
    });
  }

  return OracleInterpretationSchema.parse({
    headline: bounded(`Hexagram ${input.cast.primaryHexagram.number} as a design cue`, 48),
    summary: moving
      ? "Use the shift from the primary to the transformed structure only as a composition cue: establish a calm base, then mark the moving positions with measured contrast."
      : "Use this structure as one way to observe the present rhythm: build color and material with steady order, without predicting an outcome.",
    keywords: moving ? ["observe", "rhythm", "transition"] : ["observe", "order", "space"],
    designRationale: bounded(
      `Use ${primary} as the lead${support ? ` with ${support} in support` : ""}; ${rhythm} shapes the bead sequence${moving ? `, with accents at line positions ${input.cast.movingLineIndices.join(", ")}` : ""}.`,
      240
    ),
    disclaimer: EN_DISCLAIMER
  });
}

const normalizeApprovedCopy = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ");

function approvedTemplateMatch(
  candidate: OracleInterpretation,
  approved: OracleInterpretation
): OracleInterpretation | undefined {
  const creativeFields = ["headline", "summary", "designRationale"] as const;
  const fieldsMatch = creativeFields.every(
    (field) => normalizeApprovedCopy(candidate[field]) === normalizeApprovedCopy(approved[field])
  );
  const keywordsMatch = candidate.keywords.length === approved.keywords.length &&
    candidate.keywords.every(
      (keyword, index) => normalizeApprovedCopy(keyword) === normalizeApprovedCopy(approved.keywords[index] ?? "")
    );
  return fieldsMatch && keywordsMatch ? approved : undefined;
}

function interpretationHasProhibitedClaim(value: OracleInterpretation): boolean {
  return [value.headline, value.summary, ...value.keywords, value.designRationale, value.disclaimer]
    .some(hasProhibitedOracleClaim);
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

function sourceFor(
  input: OracleCopyInput,
  mode: "PROVIDER" | "DETERMINISTIC_FALLBACK",
  providerId: string,
  providerVersion: string
) {
  return {
    mode,
    providerId,
    providerVersion,
    policyVersion: ORACLE_COPY_POLICY_VERSION,
    contentVersion: ORACLE_COPY_CONTENT_VERSION,
    algorithmVersion: input.cast.algorithm.version,
    ruleVersion: input.signal.ruleVersion
  } as const;
}

function fallbackResult(input: OracleCopyInput, interpretation: OracleInterpretation): OracleCopyResult {
  return OracleCopyResultSchema.parse({
    interpretation,
    source: sourceFor(
      input,
      "DETERMINISTIC_FALLBACK",
      ORACLE_FALLBACK_PROVIDER_ID,
      ORACLE_FALLBACK_PROVIDER_VERSION
    )
  });
}

export interface OracleCopyProvider {
  readonly providerId: string;
  readonly providerVersion: string;
  generate(input: OracleCopyInput): Promise<unknown>;
}

export class OracleCopyService {
  constructor(private readonly dependencies: { readonly provider?: OracleCopyProvider } = {}) {}

  async createInterpretation(inputValue: OracleCopyInput): Promise<OracleCopyResult> {
    const input = OracleCopyInputSchema.parse(inputValue);
    const approved = deterministicInterpretation(input);
    const fallback = fallbackResult(input, approved);
    const provider = this.dependencies.provider;
    if (!provider) return fallback;

    let output: unknown;
    try {
      output = await provider.generate(deepFreeze(OracleCopyInputSchema.parse(input)));
    } catch {
      return fallback;
    }

    try {
      const parsed = OracleInterpretationSchema.safeParse(output);
      if (!parsed.success || interpretationHasProhibitedClaim(parsed.data)) return fallback;
      const matched = approvedTemplateMatch(parsed.data, approved);
      if (!matched) return fallback;
      if (
        typeof provider.providerId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(provider.providerId) ||
        typeof provider.providerVersion !== "string" ||
        provider.providerVersion.trim().length === 0 ||
        provider.providerVersion.length > 80
      ) {
        return fallback;
      }

      return OracleCopyResultSchema.parse({
        interpretation: matched,
        source: sourceFor(input, "PROVIDER", provider.providerId, provider.providerVersion)
      });
    } catch {
      return fallback;
    }
  }
}
