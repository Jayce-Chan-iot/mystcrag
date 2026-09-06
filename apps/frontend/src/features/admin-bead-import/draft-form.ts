import {
  CRYSTAL_DRAFT_CURATION_TO_COMPLETENESS,
  CRYSTAL_DRAFT_TAG_LIMITS,
  CURRENCY_MINOR_UNITS,
  AssetUsagePermissionSchema,
  BeadShapeSchema,
  PublishAssetUsagePermissionSchema,
  SaveBeadProductDraftRequestSchema,
  UpdateCrystalDraftCurationRequestSchema,
  missingCrystalDraftCurationFields,
  type AssetUsagePermission,
  type CrystalDraftCurationField,
  type DraftCompletenessField,
  type SaveBeadProductDraftRequest,
  type SupportedCurrency,
  type UpdateCrystalDraftCurationRequest
} from "@mystcrag/design-contract";

import {
  CONFLICT_NOTICE_MESSAGE,
  STALE_GROUP_NOTICE_MESSAGE
} from "./workflow-state";

/**
 * The naming and curation step, as pure values. Every bound is judged by the
 * contract itself: a candidate body is parsed, and whatever the parse rejects is
 * reported to the operator and left out of the save, so this module never
 * restates a length, a range or a placeholder rule of its own.
 *
 * Two publish-required inputs are deliberately absent here. There is no read
 * surface this console may reach that resolves an existing crystal record, so a
 * crystal reference can only ever be the draft the Backend created and returned;
 * and an approved texture key is written by the Backend after human review, so
 * no field in this form can produce one. Both show up as publication blockers
 * rather than as inputs an operator could fill in with a guess.
 */

export type BeadShape = NonNullable<SaveBeadProductDraftRequest["shape"]>;

export const BEAD_SHAPES: readonly BeadShape[] = BeadShapeSchema.options;
export const USAGE_PERMISSIONS: readonly AssetUsagePermission[] = AssetUsagePermissionSchema.options;

export const PRODUCT_DRAFT_TEXT_FIELDS = [
  "displayName",
  "sku",
  "materialKey",
  "diameterMm",
  "lengthAlongStringMm",
  "unitPrice",
  "cost",
  "availableQuantity",
  "qualityStatement",
  "qualitySource",
  "rightsHolder"
] as const;
export type ProductDraftTextField = (typeof PRODUCT_DRAFT_TEXT_FIELDS)[number];

/**
 * Every rights and consent decision starts unanswered. A draft save omits an
 * unanswered decision instead of assuming one, and publication stays blocked
 * until a human has chosen it.
 */
export const PRODUCT_DRAFT_DECISION_FIELDS = [
  "isAuthenticPhotograph",
  "allowAiTraining",
  "allowCommercialUse",
  "allowPublicDisplay",
  "allowAiRecommendation"
] as const;
export type ProductDraftDecisionField = (typeof PRODUCT_DRAFT_DECISION_FIELDS)[number];

export type ProductDraftForm = {
  text: Record<ProductDraftTextField, string>;
  decisions: Record<ProductDraftDecisionField, boolean | null>;
  shape: BeadShape | null;
  currency: SupportedCurrency | null;
  usagePermission: AssetUsagePermission | null;
};

export const CRYSTAL_CURATION_TEXT_FIELDS = [
  "nameCn",
  "nameEn",
  "mineralName",
  "complianceNote"
] as const;
export const CRYSTAL_CURATION_TAG_FIELDS = ["colorTags", "visualTags", "styleTags"] as const;
export type CurationTextField = (typeof CRYSTAL_CURATION_TEXT_FIELDS)[number];
export type CurationTagField = (typeof CRYSTAL_CURATION_TAG_FIELDS)[number];

/** Raw operator input. Tags arrive as one separated string and are split here. */
export type CurationForm = Record<CurationTextField | CurationTagField | "priceLevel", string>;

export const DRAFT_COMPLETENESS_LABELS: Readonly<Record<DraftCompletenessField, string>> = {
  CRYSTAL_NAME: "珠子名称",
  CRYSTAL_REFERENCE: "水晶资料引用",
  PRODUCT_NAME: "商品名称",
  SKU: "SKU 编码",
  SHAPE: "珠子形状",
  DIMENSIONS: "直径尺寸",
  QUALITY_STATEMENT: "品质说明",
  QUALITY_SOURCE: "品质依据来源",
  MATERIAL_KEY: "材质标识",
  TEXTURE_ASSET_KEY: "贴图素材",
  CURRENCY: "结算币种",
  UNIT_PRICE: "单价",
  COST: "成本",
  AVAILABLE_QUANTITY: "可用数量",
  RIGHTS_HOLDER: "权利持有人",
  USAGE_PERMISSION: "使用授权",
  AUTHENTIC_PHOTO_DECLARATION: "实拍照片声明",
  AI_TRAINING_DECISION: "AI 训练授权决定",
  COMMERCIAL_USE_DECISION: "商用授权决定",
  PUBLIC_DISPLAY_DECISION: "公开展示授权决定",
  AI_RECOMMENDATION_DECISION: "AI 推荐授权决定"
};

export const CRYSTAL_CURATION_LABELS: Readonly<Record<CrystalDraftCurationField, string>> = {
  NAME_CN: "中文名",
  NAME_EN: "英文名",
  MINERAL_NAME: "矿物学名称",
  COLOR_TAGS: "颜色标签",
  VISUAL_TAGS: "视觉特征标签",
  STYLE_TAGS: "风格标签",
  PRICE_LEVEL: "价格档位（1 到 5）",
  COMPLIANCE_NOTE: "合规说明"
};

export const PRODUCT_FIELD_LABELS: Readonly<Record<ProductDraftTextField, string>> = {
  displayName: "商品名称",
  sku: "SKU 编码",
  materialKey: "材质标识",
  diameterMm: "直径（毫米）",
  lengthAlongStringMm: "穿孔方向长度（毫米）",
  unitPrice: "单价",
  cost: "成本",
  availableQuantity: "可用数量",
  qualityStatement: "品质说明",
  qualitySource: "品质依据来源",
  rightsHolder: "权利持有人"
};

export const DECISION_FIELD_LABELS: Readonly<Record<ProductDraftDecisionField, string>> = {
  isAuthenticPhotograph: "这些照片是实拍，未由图像生成或合成",
  allowAiTraining: "允许将这些素材用于 AI 训练",
  allowCommercialUse: "允许商业用途",
  allowPublicDisplay: "允许公开展示",
  allowAiRecommendation: "允许用于 AI 推荐"
};

export const USAGE_PERMISSION_LABELS: Readonly<Record<AssetUsagePermission, string>> = {
  UNKNOWN: "尚不清楚（可保存，不能发布）",
  OWNED: "自有版权",
  GRANTED: "已获授权",
  PROHIBITED: "明确禁止（可保存，不能发布）"
};

export const BEAD_SHAPE_LABELS: Readonly<Record<BeadShape, string>> = {
  ROUND: "圆形",
  OVAL: "椭圆形",
  FACETED: "刻面",
  BAROQUE: "不规则"
};

export type DraftRefusalReason =
  | "NO_SESSION"
  | "UNKNOWN_GROUP"
  | "GROUP_LOCKED"
  | "CONFLICT_BLOCKED"
  | "IN_FLIGHT"
  | "STALE"
  | "NOTHING_TO_SAVE"
  | "INVALID_INPUT"
  | "NO_CRYSTAL_DRAFT"
  | "CURATION_IN_FLIGHT";

export const DRAFT_REFUSAL_MESSAGES: Readonly<Record<DraftRefusalReason, string>> = {
  NO_SESSION: "导入任务尚未载入，无法保存草稿。",
  UNKNOWN_GROUP: "该分组已不存在或已被合并，请刷新后再试。",
  GROUP_LOCKED: "导入任务已进入不可编辑阶段，草稿仅供查看。",
  CONFLICT_BLOCKED: CONFLICT_NOTICE_MESSAGE,
  IN_FLIGHT: "该分组的草稿正在保存，请等待完成后再试。",
  STALE: STALE_GROUP_NOTICE_MESSAGE,
  NOTHING_TO_SAVE: "还没有可保存的内容，请先填写至少一项。",
  INVALID_INPUT: "有字段未被接受，请先按提示修正后再保存。",
  NO_CRYSTAL_DRAFT: "该分组还没有水晶资料草稿，请先保存一次商品草稿以建立它。",
  CURATION_IN_FLIGHT: "水晶资料正在保存，请等待完成后再试。"
};

export type DraftIssue = { field: string; message: string };

export type DraftCompletenessSnapshot = {
  complete: boolean;
  missingFields: DraftCompletenessField[];
  checkedAt: string;
};

export type CrystalDraftSnapshot = {
  curationComplete: boolean;
  promotionEligible: boolean;
};

/** Request key per operator field, so a contract rejection names the input. */
const TEXT_FIELD_TO_REQUEST_KEY: Readonly<Record<ProductDraftTextField, string>> = {
  displayName: "displayName",
  sku: "sku",
  materialKey: "materialKey",
  diameterMm: "diameterMm",
  lengthAlongStringMm: "lengthAlongStringMm",
  unitPrice: "unitPriceMinor",
  cost: "costMinor",
  availableQuantity: "availableQuantity",
  qualityStatement: "qualityStatement",
  qualitySource: "qualitySource",
  rightsHolder: "rightsHolder"
};

const REQUEST_KEY_TO_TEXT_FIELD: Readonly<Record<string, ProductDraftTextField | undefined>> = {
  displayName: "displayName",
  sku: "sku",
  materialKey: "materialKey",
  diameterMm: "diameterMm",
  lengthAlongStringMm: "lengthAlongStringMm",
  unitPriceMinor: "unitPrice",
  costMinor: "cost",
  availableQuantity: "availableQuantity",
  qualityStatement: "qualityStatement",
  qualitySource: "qualitySource",
  rightsHolder: "rightsHolder"
};

const TEXT_FIELD_ISSUE_MESSAGES: Readonly<Record<ProductDraftTextField, string>> = {
  displayName: "商品名称需要重新填写：不能为空，也不能超出允许的长度。",
  sku: "SKU 编码需要重新填写：不能为空，也不能超出允许的长度。",
  materialKey: "材质标识需要重新填写：不能为空，也不能超出允许的长度。",
  diameterMm: "直径需要是大于零的毫米数。",
  lengthAlongStringMm: "穿孔方向长度需要是大于零的毫米数。",
  unitPrice: "单价需要先选择币种，再填写到该币种的最小单位。",
  cost: "成本需要先选择币种，再填写到该币种的最小单位。",
  availableQuantity: "可用数量需要是非负整数。",
  qualityStatement: "品质说明需要由人工填写，不能为空。",
  qualitySource: "品质依据需要写明来源，不能为空。",
  rightsHolder: "权利持有人不能为空。"
};

const PUBLISHABLE_USAGE_PERMISSIONS: ReadonlySet<AssetUsagePermission> = new Set(
  PublishAssetUsagePermissionSchema.options
);

const TAG_SEPARATORS = /[,，、;；\n\r\t]+/;

const CURATION_REJECTED_MESSAGE =
  "该字段未被接受：不能为空，不能使用占位文本，长度也要在允许范围内。";

export function emptyProductDraftForm(): ProductDraftForm {
  const text = {} as Record<ProductDraftTextField, string>;
  for (const field of PRODUCT_DRAFT_TEXT_FIELDS) {
    text[field] = "";
  }
  const decisions = {} as Record<ProductDraftDecisionField, boolean | null>;
  for (const field of PRODUCT_DRAFT_DECISION_FIELDS) {
    decisions[field] = null;
  }
  return { text, decisions, shape: null, currency: null, usagePermission: null };
}

export function emptyCurationForm(): CurationForm {
  return {
    nameCn: "",
    nameEn: "",
    mineralName: "",
    colorTags: "",
    visualTags: "",
    styleTags: "",
    priceLevel: "",
    complianceNote: ""
  };
}

/**
 * Converts a price written in major units into exact minor units. The fraction is
 * assembled as digits rather than multiplied, so a decimal never arrives one unit
 * short; a price the currency cannot represent is refused instead of rounded.
 */
export function toMinorUnits(text: string, currency: SupportedCurrency): number | null {
  const units = CURRENCY_MINOR_UNITS[currency];
  const fractionDigits = String(units).length - 1;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const whole = match[1] ?? "0";
  const fraction = match[2];
  if (fraction !== undefined && fraction.length > fractionDigits) {
    return null;
  }
  const minor = Number(whole) * units + Number((fraction ?? "").padEnd(fractionDigits, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

function toMillimeters(text: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function toQuantity(text: string): number | null {
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * A value the contract cannot read is passed through unchanged so that the parse
 * reports it. Guessing a number here would turn a typo into a wrong price.
 */
function coercedTextValue(
  field: ProductDraftTextField,
  text: string,
  currency: SupportedCurrency | null
): string | number {
  switch (field) {
    case "diameterMm":
    case "lengthAlongStringMm":
      return toMillimeters(text) ?? text;
    case "unitPrice":
    case "cost":
      return currency === null ? text : (toMinorUnits(text, currency) ?? text);
    case "availableQuantity":
      return toQuantity(text) ?? text;
    default:
      return text;
  }
}

function candidateRequest(
  form: ProductDraftForm,
  expectedGroupRevision: number,
  crystalDraftId: string | null
): Record<string, unknown> {
  const candidate: Record<string, unknown> = { expectedGroupRevision };
  if (crystalDraftId !== null) {
    candidate.crystalDraftId = crystalDraftId;
  }
  for (const field of PRODUCT_DRAFT_TEXT_FIELDS) {
    const raw = form.text[field];
    if (raw === "") {
      continue;
    }
    candidate[TEXT_FIELD_TO_REQUEST_KEY[field]] = coercedTextValue(field, raw.trim(), form.currency);
  }
  if (form.shape !== null) {
    candidate.shape = form.shape;
  }
  if (form.currency !== null) {
    candidate.currency = form.currency;
  }
  if (form.usagePermission !== null) {
    candidate.usagePermission = form.usagePermission;
  }
  for (const field of PRODUCT_DRAFT_DECISION_FIELDS) {
    const decision = form.decisions[field];
    if (decision !== null) {
      candidate[field] = decision;
    }
  }
  return candidate;
}

function rejectedRequestKeys(candidate: Record<string, unknown>): Set<string> {
  const parsed = SaveBeadProductDraftRequestSchema.safeParse(candidate);
  if (parsed.success) {
    return new Set();
  }
  const rejected = new Set<string>();
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string") {
      rejected.add(key);
    }
  }
  return rejected;
}

/**
 * Reports the fields the contract would refuse. An untouched field is not an
 * issue: a staged save is allowed to be incomplete, and only publication insists
 * on the full set.
 */
export function productDraftIssues(form: ProductDraftForm): DraftIssue[] {
  const issues: DraftIssue[] = [];
  for (const key of rejectedRequestKeys(candidateRequest(form, 1, null))) {
    const field = REQUEST_KEY_TO_TEXT_FIELD[key];
    if (field === undefined) {
      continue;
    }
    issues.push({ field, message: TEXT_FIELD_ISSUE_MESSAGES[field] });
  }
  return issues;
}

export function buildProductDraftRequest(input: {
  form: ProductDraftForm;
  expectedGroupRevision: number;
  crystalDraftId: string | null;
}): SaveBeadProductDraftRequest | null {
  const candidate = candidateRequest(input.form, input.expectedGroupRevision, input.crystalDraftId);
  const rejected = rejectedRequestKeys(candidate);
  if (rejected.size === 0) {
    const parsed = SaveBeadProductDraftRequestSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }
  const salvaged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!rejected.has(key)) {
      salvaged[key] = value;
    }
  }
  const parsed = SaveBeadProductDraftRequestSchema.safeParse(salvaged);
  return parsed.success ? parsed.data : null;
}

export function isPublishableUsagePermission(permission: AssetUsagePermission | null): boolean {
  return permission !== null && PUBLISHABLE_USAGE_PERMISSIONS.has(permission);
}

/**
 * Everything that stands between a group and publication, in operator language.
 * The Backend stays the authority: these are the blockers the console can already
 * see, and a publication attempt is still refused server-side on its own terms.
 */
export function publishBlockersFor(input: {
  completeness: DraftCompletenessSnapshot | null;
  usagePermission: AssetUsagePermission | null;
  crystalDraft: CrystalDraftSnapshot | null;
}): string[] {
  const blockers: string[] = [];
  const { completeness, usagePermission, crystalDraft } = input;

  if (completeness === null) {
    blockers.push("尚未核对草稿完整性，请先检查还缺少哪些字段。");
  } else if (!completeness.complete) {
    for (const field of completeness.missingFields) {
      blockers.push(
        field === "TEXTURE_ASSET_KEY"
          ? "贴图素材尚未由服务端写入，控制台无法代为填写。"
          : `${DRAFT_COMPLETENESS_LABELS[field]}尚未填写。`
      );
    }
  }

  if (!isPublishableUsagePermission(usagePermission)) {
    blockers.push(
      usagePermission === null
        ? "使用授权尚未由人工选择，不能发布。"
        : `使用授权为 ${usagePermission}，不能发布。`
    );
  }

  if (crystalDraft === null) {
    blockers.push("尚未建立水晶资料草稿，不能发布：发布必须解析出唯一的水晶引用。");
  } else if (!crystalDraft.curationComplete) {
    blockers.push("水晶资料尚未完整，不能发布。");
  } else if (!crystalDraft.promotionEligible) {
    blockers.push("服务端尚未允许提升该水晶资料，不能发布。");
  }

  return blockers;
}

function splitTags(raw: string): string[] {
  return raw
    .split(TAG_SEPARATORS)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

function tagIssue(field: CurationTagField, raw: string): string | null {
  const tags = splitTags(raw);
  if (tags.length === 0) {
    return null;
  }
  const limit = CRYSTAL_DRAFT_TAG_LIMITS[field];
  if (tags.length > limit) {
    return `标签数量超出上限（最多 ${limit} 个），请合并后再保存。`;
  }
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.toLocaleLowerCase("en-US");
    if (seen.has(normalized)) {
      return "标签不能重复，请删除重复项后再保存。";
    }
    seen.add(normalized);
  }
  return null;
}

/** The values the contract will judge, with anything unreadable left out. */
function parsedCuration(form: CurationForm): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of CRYSTAL_CURATION_TEXT_FIELDS) {
    const text = form[field].trim();
    if (text !== "") {
      values[field] = text;
    }
  }
  for (const field of CRYSTAL_CURATION_TAG_FIELDS) {
    if (tagIssue(field, form[field]) !== null) {
      continue;
    }
    const tags = splitTags(form[field]);
    if (tags.length > 0) {
      values[field] = tags;
    }
  }
  const levelText = form.priceLevel.trim();
  if (levelText !== "") {
    const level = Number(levelText);
    if (Number.isInteger(level)) {
      values.priceLevel = level;
    }
  }
  return values;
}

/**
 * Which of the eight human fields the Backend would still call missing. The
 * contract answers this, so placeholder text, blank values and bounds are judged
 * exactly as they will be on the server.
 */
export function curationMissingFields(form: CurationForm): CrystalDraftCurationField[] {
  return missingCrystalDraftCurationFields(parsedCuration(form));
}

function isCurationFieldFilled(form: CurationForm, field: string): boolean {
  return form[field as keyof CurationForm].trim() !== "";
}

export function curationIssues(form: CurationForm): DraftIssue[] {
  const issues: DraftIssue[] = [];
  for (const field of CRYSTAL_CURATION_TAG_FIELDS) {
    const problem = tagIssue(field, form[field]);
    if (problem !== null) {
      issues.push({ field, message: problem });
    }
  }
  const missing = new Set(curationMissingFields(form));
  for (const [inputField, completenessField] of Object.entries(
    CRYSTAL_DRAFT_CURATION_TO_COMPLETENESS
  )) {
    if (!missing.has(completenessField)) {
      continue;
    }
    if (!isCurationFieldFilled(form, inputField)) {
      continue;
    }
    if (issues.some((issue) => issue.field === inputField)) {
      continue;
    }
    issues.push({ field: inputField, message: CURATION_REJECTED_MESSAGE });
  }
  return issues;
}

export function buildCurationRequest(input: {
  form: CurationForm;
  expectedRevision: number;
  idempotencyKey: string;
}): UpdateCrystalDraftCurationRequest | null {
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey === "") {
    return null;
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision <= 0) {
    return null;
  }
  if (curationIssues(input.form).length > 0) {
    return null;
  }
  const missing = new Set(curationMissingFields(input.form));
  const values = parsedCuration(input.form);
  const request: Record<string, unknown> = {
    idempotencyKey,
    expectedRevision: input.expectedRevision
  };
  let curatedFieldCount = 0;
  for (const [inputField, completenessField] of Object.entries(
    CRYSTAL_DRAFT_CURATION_TO_COMPLETENESS
  )) {
    if (missing.has(completenessField)) {
      continue;
    }
    const value = values[inputField];
    if (value === undefined) {
      continue;
    }
    request[inputField] = value;
    curatedFieldCount += 1;
  }
  if (curatedFieldCount === 0) {
    return null;
  }
  const parsed = UpdateCrystalDraftCurationRequestSchema.safeParse(request);
  return parsed.success ? parsed.data : null;
}
