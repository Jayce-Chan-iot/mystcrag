import type { GenerateDesignRequest } from "@mystcrag/design-contract";

export const QUESTIONNAIRE_STEPS = [
  { id: "state", eyebrow: "01 · 当下", title: "此刻，你更接近哪一种状态？", description: "没有标准答案，也不用于任何心理判断。只选最贴近当下的一项。" },
  { id: "color", eyebrow: "02 · 色彩", title: "哪组颜色最让你停留？", description: "选择你直觉喜欢的色彩关系。" },
  { id: "style", eyebrow: "03 · 风格", title: "你希望它以怎样的方式出现？", description: "想象它与你日常衣着和气质的关系。" },
  { id: "budget", eyebrow: "04 · 预算", title: "为这次设计留出多少空间？", description: "预算用于筛选材料与工艺，不影响设计被认真对待。" },
  { id: "wrist", eyebrow: "05 · 手围", title: "告诉我们你的净手围", description: "用软尺贴合手腕测量，不要预留松量；我们会在设计中加入合理余量。" },
  { id: "culture", eyebrow: "06 · 灵感", title: "是否加入一缕文化意象？", description: "这是可选的视觉与叙事参考，不代表科学功效或确定性结果。" }
] as const;

export type QuestionnaireStepId = (typeof QUESTIONNAIRE_STEPS)[number]["id"];

export type QuestionnaireAnswers = {
  state: string;
  color: string;
  style: string;
  budget: string;
  wrist: string;
  culture: string;
  excludedProductIds: string[];
  personalizationConsent: boolean;
};

export const INITIAL_ANSWERS: QuestionnaireAnswers = {
  state: "",
  color: "",
  style: "",
  budget: "",
  wrist: "",
  culture: "none",
  excludedProductIds: [],
  personalizationConsent: false
};

export const QUESTION_OPTIONS: Record<Exclude<QuestionnaireStepId, "wrist">, Array<{ value: string; label: string; detail: string; swatches?: string[] }>> = {
  state: [
    { value: "quiet", label: "想慢下来", detail: "给思绪留一点安静的空隙" },
    { value: "light", label: "想找回轻盈", detail: "偏爱清透、松弛与流动感" },
    { value: "new-chapter", label: "准备新的开始", detail: "用一件作品标记此刻" },
    { value: "aesthetic", label: "只想忠于审美", detail: "从颜色、质感与搭配出发" }
  ],
  color: [
    { value: "mist-blue", label: "雨后雾蓝", detail: "低饱和蓝与月白", swatches: ["#9fcbd5", "#e9e7df", "#c5b9cd"] },
    { value: "mountain-purple", label: "暮山浅紫", detail: "烟紫、灰褐与冷白", swatches: ["#a995bb", "#8c827f", "#ece9e1"] },
    { value: "tea-amber", label: "茶金琥珀", detail: "蜜色、茶褐与柔金", swatches: ["#c9a36d", "#8e7464", "#d8c7a7"] },
    { value: "ink-neutral", label: "墨色中性", detail: "烟黑、岩灰与银色", swatches: ["#4c4a4e", "#a5a1a0", "#ddd9d0"] }
  ],
  style: [
    { value: "minimal", label: "克制极简", detail: "清晰秩序，少量重点" },
    { value: "eastern", label: "东方当代", detail: "传统意象的现代转译" },
    { value: "organic", label: "自然不规则", detail: "保留材质原生的呼吸感" },
    { value: "delicate", label: "精致轻珠宝", detail: "细节丰富但不过度装饰" }
  ],
  budget: [
    { value: "entry", label: "¥299 – ¥499", detail: "轻盈日常的基础组合" },
    { value: "signature", label: "¥500 – ¥899", detail: "更多材质层次与配件" },
    { value: "premium", label: "¥900 – ¥1,499", detail: "稀有质感与精细工艺" },
    { value: "open", label: "暂不设限", detail: "先让设计完整发生" }
  ],
  culture: [
    { value: "landscape", label: "山水留白", detail: "疏密、远近与呼吸" },
    { value: "season", label: "节气光影", detail: "自然变化中的色彩" },
    { value: "objects", label: "古典器物", detail: "材质、比例与温润感" },
    { value: "none", label: "暂不加入", detail: "只从个人审美出发" }
  ]
};

const BUDGETS: Record<string, Pick<GenerateDesignRequest, "minBudgetMinor" | "maxBudgetMinor">> = {
  entry: { minBudgetMinor: 29_900, maxBudgetMinor: 49_900 },
  signature: { minBudgetMinor: 50_000, maxBudgetMinor: 89_900 },
  premium: { minBudgetMinor: 90_000, maxBudgetMinor: 149_900 },
  open: {}
};

export function validateQuestionnaireStep(step: QuestionnaireStepId, answers: QuestionnaireAnswers): string | null {
  if (step === "wrist") {
    const wrist = Number(answers.wrist);
    if (!answers.wrist.trim()) return "请输入净手围。";
    if (!Number.isFinite(wrist) || wrist < 120 || wrist > 220) return "请输入 120–220 mm 之间的有效手围。";
    return null;
  }
  if (step !== "culture" && !answers[step]) return "请选择一项后继续。";
  return null;
}

export function getPreviousStepIndex(currentStepIndex: number): number {
  return Math.max(0, currentStepIndex - 1);
}

export function getNextStepIndex(currentStepIndex: number): number {
  return Math.min(QUESTIONNAIRE_STEPS.length - 1, currentStepIndex + 1);
}

export function toGenerateDesignRequest(answers: QuestionnaireAnswers): GenerateDesignRequest {
  const wrist = Number(answers.wrist);
  const budget = BUDGETS[answers.budget] ?? {};
  return {
    requestId: `frontend-${answers.state}-${answers.color}`,
    locale: "zh-CN",
    currency: "CNY",
    wristCircumferenceMm: wrist,
    emotionTags: [answers.state],
    styleTags: [answers.style, ...(answers.culture === "none" ? [] : [answers.culture])],
    colorTags: [answers.color],
    ...budget,
    excludedProductIds: answers.excludedProductIds,
    personalizationConsent: answers.personalizationConsent
  };
}

const DESIGN_DIRECTIONS = [
  { id: "clear-rhythm", styleTag: "airy-rhythm", colorTag: "clear-accent" },
  { id: "layered-contrast", styleTag: "layered-contrast", colorTag: "smoky-accent" },
  { id: "focused-balance", styleTag: "focal-balance", colorTag: "neutral-accent" }
] as const;

export function toGenerateDesignRequests(answers: QuestionnaireAnswers): GenerateDesignRequest[] {
  const base = toGenerateDesignRequest(answers);
  return DESIGN_DIRECTIONS.map((direction) => ({
    ...base,
    requestId: `${base.requestId}-${direction.id}`,
    styleTags: [...base.styleTags, direction.styleTag],
    colorTags: [...base.colorTags, direction.colorTag]
  }));
}
