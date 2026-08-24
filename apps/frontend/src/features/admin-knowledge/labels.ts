import type { KnowledgeStatus, SourceReviewStatus } from "@mystcrag/design-contract";

/** Human labels for the internal coverage-domain names (task book §Track B). */
export const COVERAGE_DOMAIN_LABELS: Readonly<Record<string, string>> = {
  CRYSTAL_GEMOLOGY: "水晶宝石学",
  CRYSTAL_VISUAL_PROPERTIES: "水晶视觉特征",
  CRYSTAL_CULTURAL_SYMBOLISM: "水晶文化象征",
  COLOR_THEORY: "色彩理论",
  JEWELRY_DESIGN: "珠宝设计",
  COMPOSITION: "构图规则",
  PROPORTION: "比例规则",
  FOCAL: "焦点规则",
  TRANSITION: "过渡规则",
  MATERIAL_COMPATIBILITY: "材料相容性",
  NEGATIVE_RULE: "负面清单",
  STYLE: "风格规则",
  WUXING: "五行",
  WUXING_CRYSTAL_ASSOCIATION: "五行—水晶关联",
  ZODIAC: "星座",
  ZODIAC_CRYSTAL_ASSOCIATION: "星座—水晶关联",
  TAROT: "塔罗",
  TAROT_SYMBOLISM: "塔罗象征",
  TAROT_CRYSTAL_ASSOCIATION: "塔罗—水晶关联",
  MARKET_OBSERVATION: "市场观察"
};

export function coverageDomainLabel(domain: string): string {
  return COVERAGE_DOMAIN_LABELS[domain] ?? domain;
}

export const RULE_STATUS_LABELS: Readonly<Record<KnowledgeStatus, string>> = {
  NEW: "新建",
  EXTRACTED: "已抽取",
  VALIDATED: "已自动校验",
  NEEDS_REVIEW: "待审核",
  APPROVED: "已批准",
  REJECTED: "已拒绝",
  CONFLICTED: "冲突",
  SUPERSEDED: "已合并"
};

export const SOURCE_REVIEW_STATUS_LABELS: Readonly<Record<SourceReviewStatus, string>> = {
  DISCOVERED: "已发现",
  NEEDS_REVIEW: "待审核",
  APPROVED: "已批准",
  REJECTED: "已拒绝",
  DISABLED: "已禁用"
};

export const CLAIM_TYPE_LABELS: Readonly<Record<string, string>> = {
  SCIENTIFIC_FACT: "科学事实",
  GEMOLOGICAL_FACT: "宝石学事实",
  DESIGN_PRINCIPLE: "设计原则",
  DESIGN_HEURISTIC: "设计启发",
  CULTURAL_SYMBOLISM: "文化象征",
  MARKET_OBSERVATION: "市场观察"
};

export function claimTypeLabel(claimType: string | null): string {
  if (claimType === null) return "未声明";
  return CLAIM_TYPE_LABELS[claimType] ?? claimType;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDateTime(iso: string | null): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}
