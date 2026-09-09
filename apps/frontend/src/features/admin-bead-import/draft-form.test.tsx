import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  CRYSTAL_DRAFT_CURATION_FIELDS,
  CRYSTAL_DRAFT_TAG_LIMITS,
  CRYSTAL_PRICE_LEVEL_RANGE,
  DRAFT_COMPLETENESS_FIELDS,
  SaveBeadProductDraftRequestSchema,
  UpdateCrystalDraftCurationRequestSchema
} from "@mystcrag/design-contract";

import {
  CRYSTAL_CURATION_LABELS,
  DRAFT_COMPLETENESS_LABELS,
  PRODUCT_DRAFT_DECISION_FIELDS,
  PRODUCT_DRAFT_TEXT_FIELDS,
  buildCurationRequest,
  buildProductDraftRequest,
  curationIssues,
  curationMissingFields,
  emptyCurationForm,
  emptyProductDraftForm,
  isCurationFormEmpty,
  isProductDraftFormEmpty,
  isPublishableUsagePermission,
  productDraftIssues,
  publishBlockersFor,
  sameCurationForm,
  sameProductDraftForm,
  toMinorUnits,
  type CurationForm,
  type ProductDraftForm
} from "./draft-form";

const SOURCE = readFileSync(join(__dirname, "draft-form.ts"), "utf8");

const FORBIDDEN_LEAKS = [
  "archiveKey",
  "storageKey",
  "x-admin-key",
  "MYSTCRAG_ASSET_ADMIN_KEY",
  "ASSET_ADMIN_API_KEY",
  "MYSTCRAG_BACKEND_ORIGIN",
  "127.0.0.1",
  "localhost",
  "/Users/",
  "C:\\",
  "prisma",
  "postgres",
  "process.env",
  "document.cookie",
  "localStorage",
  "sessionStorage"
];

/** Copy that would claim a health effect, a guarantee or a fixed fortune. */
const FORBIDDEN_CLAIMS = ["治疗", "疗愈", "疗效", "招财", "转运", "辟邪", "保证", "一定能", "必定", "功效"];

/** Copy that would pretend a crystal identity was read off the files. */
const FORBIDDEN_INFERENCE = ["自动识别", "推荐名称", "已为你推断", "根据文件名", "根据文件夹"];

/**
 * A form an operator has actually filled in. It is written out field by field so
 * a test that changes one value cannot silently change another.
 */
function filledProductForm(overrides: Partial<ProductDraftForm> = {}): ProductDraftForm {
  return {
    text: {
      displayName: "紫水晶圆珠 8mm",
      sku: "MXJ-BEAD-AMETHYST-08",
      materialKey: "amethyst-round-v1",
      diameterMm: "8",
      lengthAlongStringMm: "8",
      unitPrice: "39.90",
      cost: "12.00",
      availableQuantity: "24",
      qualityStatement: "天然紫水晶，肉眼可见色带，无裂纹。",
      qualitySource: "供货方 2026 年 3 月批次检验记录",
      rightsHolder: "玄矶工作室"
    },
    decisions: {
      isAuthenticPhotograph: true,
      allowAiTraining: false,
      allowCommercialUse: true,
      allowPublicDisplay: true,
      allowAiRecommendation: true
    },
    shape: "ROUND",
    currency: "CNY",
    usagePermission: "OWNED",
    ...overrides
  };
}

function filledCurationForm(overrides: Partial<CurationForm> = {}): CurationForm {
  return {
    nameCn: "紫水晶",
    nameEn: "Amethyst",
    mineralName: "石英（二氧化硅）",
    colorTags: "紫色, 深紫",
    visualTags: "透明\n色带",
    styleTags: "简约、复古",
    priceLevel: "3",
    complianceNote: "照片为实拍，未做合成；描述不含功效主张。",
    ...overrides
  };
}

function issueFields(issues: readonly { field: string }[]): string[] {
  return issues.map((issue) => issue.field);
}

test("every machine field the Backend can report missing has operator-facing copy", () => {
  assert.deepEqual(
    Object.keys(DRAFT_COMPLETENESS_LABELS).sort(),
    [...DRAFT_COMPLETENESS_FIELDS].sort(),
    "the label map must cover exactly the contract fields"
  );
  for (const field of DRAFT_COMPLETENESS_FIELDS) {
    const label = DRAFT_COMPLETENESS_LABELS[field];
    assert.ok(label.length >= 2, `${field} needs a real label, got ${label}`);
    assert.notEqual(label, field, `${field} must be translated, not echoed`);
    assert.ok(
      /[\u4e00-\u9fff]/.test(label),
      `${field} must be explained in operator language, got ${label}`
    );
  }
});

test("every curation field has operator-facing copy", () => {
  assert.deepEqual(
    Object.keys(CRYSTAL_CURATION_LABELS).sort(),
    [...CRYSTAL_DRAFT_CURATION_FIELDS].sort()
  );
  for (const field of CRYSTAL_DRAFT_CURATION_FIELDS) {
    const label = CRYSTAL_CURATION_LABELS[field];
    assert.ok(label.length >= 2);
    assert.notEqual(label, field);
    assert.ok(/[\u4e00-\u9fff]/.test(label), `${field} must be explained in operator language`);
  }
});

test("a fresh form leaves every rights decision unanswered", () => {
  const form = emptyProductDraftForm();

  for (const field of PRODUCT_DRAFT_DECISION_FIELDS) {
    assert.equal(form.decisions[field], null, `${field} must never default to a decision`);
  }
  for (const field of PRODUCT_DRAFT_TEXT_FIELDS) {
    assert.equal(form.text[field], "");
  }
  assert.equal(form.shape, null);
  assert.equal(form.currency, null);
  assert.equal(form.usagePermission, null);
  assert.equal(productDraftIssues(form).length > 0, false, "an empty form is simply incomplete");
});

test("a staged save carries only what the operator filled", () => {
  const form = emptyProductDraftForm();
  form.text.displayName = "紫水晶圆珠 8mm";
  form.text.diameterMm = "8";
  form.shape = "ROUND";

  const request = buildProductDraftRequest({ form, expectedGroupRevision: 7, crystalDraftId: null });

  assert.ok(request !== null);
  assert.deepEqual(request, {
    expectedGroupRevision: 7,
    displayName: "紫水晶圆珠 8mm",
    diameterMm: 8,
    shape: "ROUND"
  });
});

test("a first save on a named group carries the operator-confirmed name for draft creation", () => {
  const request = buildProductDraftRequest({
    form: filledProductForm(),
    expectedGroupRevision: 7,
    crystalDraftId: null,
    crystalName: "  白水晶  "
  });

  assert.ok(request !== null);
  assert.equal(
    request.crystalName,
    "白水晶",
    "the name is the trimmed SET_NAME value the operator confirmed in the review step, never retyped here"
  );
  const parsed = SaveBeadProductDraftRequestSchema.safeParse(request);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

test("no creation name is sent for an unnamed group or one that already holds a crystal reference", () => {
  const unnamed = buildProductDraftRequest({
    form: filledProductForm(),
    expectedGroupRevision: 7,
    crystalDraftId: null,
    crystalName: null
  });
  assert.ok(unnamed !== null);
  assert.equal("crystalName" in unnamed, false);

  const blank = buildProductDraftRequest({
    form: filledProductForm(),
    expectedGroupRevision: 7,
    crystalDraftId: null,
    crystalName: "   "
  });
  assert.ok(blank !== null);
  assert.equal("crystalName" in blank, false);

  const linked = buildProductDraftRequest({
    form: filledProductForm(),
    expectedGroupRevision: 7,
    crystalDraftId: "draft-1",
    crystalName: "白水晶"
  });
  assert.ok(linked !== null);
  assert.equal(linked.crystalDraftId, "draft-1");
  assert.equal("crystalName" in linked, false, "an existing draft reference stays the reference, never a re-creation");
});

test("an empty form produces no request instead of a body the contract rejects", () => {
  assert.equal(
    buildProductDraftRequest({ form: emptyProductDraftForm(), expectedGroupRevision: 3, crystalDraftId: null }),
    null
  );
});

test("the built request always satisfies the contract schema", () => {
  const request = buildProductDraftRequest({
    form: filledProductForm(),
    expectedGroupRevision: 12,
    crystalDraftId: "draft-1"
  });

  assert.ok(request !== null);
  const parsed = SaveBeadProductDraftRequestSchema.safeParse(request);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  assert.equal(request.expectedGroupRevision, 12);
  assert.equal(request.crystalDraftId, "draft-1");
  assert.equal(request.unitPriceMinor, 3990);
  assert.equal(request.costMinor, 1200);
  assert.equal(request.availableQuantity, 24);
  assert.equal(request.lengthAlongStringMm, 8);
});

test("the operator can never author a crystal id or an approved asset key", () => {
  const request = buildProductDraftRequest({
    form: filledProductForm(),
    expectedGroupRevision: 4,
    crystalDraftId: "draft-9"
  });

  assert.ok(request !== null);
  assert.equal("crystalId" in request, false, "the product-draft form has no id surface");
  assert.equal("textureAssetKey" in request, false, "approved keys come from the Backend only");
  assert.equal("modelAssetKey" in request, false);
  assert.equal(SOURCE.includes("textureAssetKey:"), false);
  // The only legitimate crystalId sites are inside the explicit
  // search-selection builder (its input type and the field it forwards), whose
  // value is the id the Backend's search returned — never name-derived.
  assert.equal(
    SOURCE.split("crystalId:").length - 1,
    2,
    "crystalId may only appear in the selection builder's signature and forwarding"
  );
  assert.ok(
    SOURCE.includes("buildCrystalSelectionRequest") && SOURCE.includes("crystalId: input.crystalId"),
    "that surface is the selection builder and it forwards the searched id"
  );
});

test("a crystal reference is either the session's draft id or nothing", () => {
  const withDraft = buildProductDraftRequest({
    form: filledProductForm(),
    expectedGroupRevision: 2,
    crystalDraftId: "draft-1"
  });
  const withoutDraft = buildProductDraftRequest({
    form: filledProductForm(),
    expectedGroupRevision: 2,
    crystalDraftId: null
  });

  assert.ok(withDraft !== null && withoutDraft !== null);
  assert.equal(withDraft.crystalDraftId, "draft-1");
  assert.equal("crystalDraftId" in withoutDraft, false);
});

test("prices become exact minor units for the chosen currency", () => {
  assert.equal(toMinorUnits("39.90", "CNY"), 3990);
  assert.equal(toMinorUnits("0", "CNY"), 0);
  assert.equal(toMinorUnits("1200", "CNY"), 120000);
  assert.equal(toMinorUnits("39", "TWD"), 39);
  assert.equal(toMinorUnits(" 8.05 ", "CNY"), 805);
  assert.equal(toMinorUnits("", "CNY"), null, "an empty price is unanswered, not zero");
  assert.equal(toMinorUnits("39.9", "TWD"), null, "TWD has no minor unit");
  assert.equal(toMinorUnits("39.999", "CNY"), null, "a sub-cent price must not be rounded away");
  assert.equal(toMinorUnits("-5", "CNY"), null);
  assert.equal(toMinorUnits("1e3", "CNY"), null);
  assert.equal(toMinorUnits("1,000", "CNY"), null);
  assert.equal(toMinorUnits("abc", "CNY"), null);
});

test("a price field that cannot be read is reported and left out of the save", () => {
  const form = filledProductForm({
    text: { ...filledProductForm().text, unitPrice: "39.999" }
  });

  assert.ok(issueFields(productDraftIssues(form)).includes("unitPrice"));

  const request = buildProductDraftRequest({ form, expectedGroupRevision: 5, crystalDraftId: null });
  assert.ok(request !== null);
  assert.equal("unitPriceMinor" in request, false, "an unreadable price is never guessed");
});

test("dimensions, quantity and text bounds come from the contract, not from a copy", () => {
  const zeroDiameter = filledProductForm({
    text: { ...filledProductForm().text, diameterMm: "0" }
  });
  assert.ok(issueFields(productDraftIssues(zeroDiameter)).includes("diameterMm"));

  const fractionalQuantity = filledProductForm({
    text: { ...filledProductForm().text, availableQuantity: "2.5" }
  });
  assert.ok(issueFields(productDraftIssues(fractionalQuantity)).includes("availableQuantity"));

  const blankSku = filledProductForm({ text: { ...filledProductForm().text, sku: "   " } });
  assert.ok(issueFields(productDraftIssues(blankSku)).includes("sku"));

  const longDisplayName = filledProductForm({
    text: { ...filledProductForm().text, displayName: "珠".repeat(201) }
  });
  assert.ok(issueFields(productDraftIssues(longDisplayName)).includes("displayName"));

  assert.equal(SOURCE.includes("CRYSTAL_DRAFT_TAG_LIMITS"), true);
  assert.equal(SOURCE.includes("CURRENCY_MINOR_UNITS"), true);
});

test("an untouched field stays silent while a whitespace-only attempt is refused", () => {
  const untouched = filledProductForm();
  untouched.text.cost = "";
  assert.equal(issueFields(productDraftIssues(untouched)).includes("cost"), false);

  const whitespace = filledProductForm({ text: { ...filledProductForm().text, sku: "   " } });
  assert.ok(issueFields(productDraftIssues(whitespace)).includes("sku"));
  const salvaged = buildProductDraftRequest({
    form: whitespace,
    expectedGroupRevision: 3,
    crystalDraftId: null
  });
  assert.ok(salvaged !== null);
  assert.equal("sku" in salvaged, false, "a refused value is never sent");

  const padded = filledProductForm({
    text: { ...filledProductForm().text, displayName: "  紫水晶圆珠 8mm  " }
  });
  const request = buildProductDraftRequest({
    form: padded,
    expectedGroupRevision: 3,
    crystalDraftId: null
  });
  assert.ok(request !== null);
  assert.equal(request.displayName, "紫水晶圆珠 8mm");
});

test("an unanswered rights decision is omitted rather than assumed", () => {
  const form = filledProductForm({
    decisions: {
      isAuthenticPhotograph: true,
      allowAiTraining: null,
      allowCommercialUse: true,
      allowPublicDisplay: true,
      allowAiRecommendation: null
    }
  });

  const request = buildProductDraftRequest({ form, expectedGroupRevision: 6, crystalDraftId: null });
  assert.ok(request !== null);
  assert.equal("allowAiTraining" in request, false);
  assert.equal("allowAiRecommendation" in request, false);
  assert.equal(request.isAuthenticPhotograph, true);
  assert.equal(request.allowPublicDisplay, true);
});

test("UNKNOWN and PROHIBITED permissions can be saved but never published", () => {
  for (const permission of ["UNKNOWN", "PROHIBITED"] as const) {
    assert.equal(isPublishableUsagePermission(permission), false);
    const request = buildProductDraftRequest({
      form: filledProductForm({ usagePermission: permission }),
      expectedGroupRevision: 8,
      crystalDraftId: null
    });
    assert.ok(request !== null, `${permission} must still be savable for review`);
    assert.equal(request.usagePermission, permission);
  }
  assert.equal(isPublishableUsagePermission("OWNED"), true);
  assert.equal(isPublishableUsagePermission("GRANTED"), true);
  assert.equal(isPublishableUsagePermission(null), false);
});

test("publication blockers name the reason in operator language", () => {
  const incomplete = publishBlockersFor({
    completeness: {
      complete: false,
      missingFields: ["SKU", "TEXTURE_ASSET_KEY"],
      checkedAt: "2026-09-06T09:00:00.000Z"
    },
    usagePermission: "PROHIBITED",
    crystalDraft: { curationComplete: false, promotionEligible: false }
  });

  assert.ok(incomplete.some((blocker) => blocker.includes("SKU 编码")));
  assert.ok(incomplete.some((blocker) => blocker.includes("贴图")));
  assert.ok(incomplete.some((blocker) => blocker.includes("使用授权")));
  assert.ok(incomplete.some((blocker) => blocker.includes("水晶资料")));

  const ready = publishBlockersFor({
    completeness: { complete: true, missingFields: [], checkedAt: "2026-09-06T09:00:00.000Z" },
    usagePermission: "OWNED",
    crystalDraft: { curationComplete: true, promotionEligible: true }
  });
  assert.deepEqual(ready, []);
});

test("a group with no crystal draft cannot publish, because no crystal id can be looked up here", () => {
  const blockers = publishBlockersFor({
    completeness: { complete: true, missingFields: [], checkedAt: "2026-09-06T09:00:00.000Z" },
    usagePermission: "GRANTED",
    crystalDraft: null
  });

  assert.equal(blockers.length, 1);
  assert.ok(blockers[0]?.includes("水晶资料"));
});

test("curation the Backend will not promote is a blocker even once it is complete", () => {
  const blockers = publishBlockersFor({
    completeness: { complete: true, missingFields: [], checkedAt: "2026-09-06T09:00:00.000Z" },
    usagePermission: "OWNED",
    crystalDraft: { curationComplete: true, promotionEligible: false }
  });

  assert.equal(blockers.length, 1);
  assert.ok(blockers[0]?.includes("提升"));
  assert.equal(
    blockers.some((blocker) => blocker.includes("尚未完整")),
    false,
    "complete curation must not be reported as incomplete"
  );
});

test("an unchecked draft is a blocker rather than a silent pass", () => {
  const blockers = publishBlockersFor({
    completeness: null,
    usagePermission: "OWNED",
    crystalDraft: { curationComplete: true, promotionEligible: true }
  });

  assert.equal(blockers.length, 1);
  assert.ok(blockers[0]?.includes("完整性"));
});

test("curation completeness is judged by the contract's own rule", () => {
  assert.deepEqual(curationMissingFields(emptyCurationForm()), [...CRYSTAL_DRAFT_CURATION_FIELDS]);
  assert.deepEqual(curationMissingFields(filledCurationForm()), []);

  for (const placeholder of ["待补充", "unknown", "N/A", "无", "同上"]) {
    const form = filledCurationForm({ nameCn: placeholder });
    assert.ok(
      curationMissingFields(form).includes("NAME_CN"),
      `${placeholder} must still count as missing`
    );
  }

  const blank = filledCurationForm({ complianceNote: "   " });
  assert.ok(curationMissingFields(blank).includes("COMPLIANCE_NOTE"));
});

test("curation tags are split, trimmed and deduplicated before they are judged", () => {
  const form = filledCurationForm({ colorTags: " 紫色 ，深紫、 淡紫 \n 紫水晶 " });
  const request = buildCurationRequest({
    form,
    expectedRevision: 3,
    idempotencyKey: "curation-1"
  });

  assert.ok(request !== null);
  assert.deepEqual(request.colorTags, ["紫色", "深紫", "淡紫", "紫水晶"]);
  assert.equal(curationIssues(form).length, 0);

  const duplicated = filledCurationForm({ colorTags: "紫色, 紫色" });
  assert.ok(issueFields(curationIssues(duplicated)).includes("colorTags"));
  assert.equal(
    buildCurationRequest({ form: duplicated, expectedRevision: 3, idempotencyKey: "k" }),
    null,
    "a duplicate tag is refused rather than silently dropped"
  );
});

test("tag counts and price level stay inside the contract bounds", () => {
  const tooMany = filledCurationForm({
    colorTags: Array.from({ length: CRYSTAL_DRAFT_TAG_LIMITS.colorTags + 1 }, (_, index) => `色${index}`).join(",")
  });
  assert.ok(issueFields(curationIssues(tooMany)).includes("colorTags"));

  const exact = filledCurationForm({
    colorTags: Array.from({ length: CRYSTAL_DRAFT_TAG_LIMITS.colorTags }, (_, index) => `色${index}`).join(",")
  });
  assert.equal(curationIssues(exact).length, 0);

  for (const level of ["0", "6", "3.5", "abc"]) {
    assert.ok(
      issueFields(curationIssues(filledCurationForm({ priceLevel: level }))).includes("priceLevel"),
      `price level ${level} must be refused`
    );
  }
  assert.equal(CRYSTAL_PRICE_LEVEL_RANGE.min, 1);
  assert.equal(CRYSTAL_PRICE_LEVEL_RANGE.max, 5);
});

test("a curation patch carries its own revision and idempotency key", () => {
  const form = filledCurationForm({ styleTags: "" });
  const request = buildCurationRequest({
    form,
    expectedRevision: 9,
    idempotencyKey: "curation-group-1-9"
  });

  assert.ok(request !== null);
  assert.equal(request.expectedRevision, 9);
  assert.equal(request.idempotencyKey, "curation-group-1-9");
  assert.equal("styleTags" in request, false, "an untouched tag list is not re-sent");
  assert.equal(request.priceLevel, 3);

  const parsed = UpdateCrystalDraftCurationRequestSchema.safeParse(request);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

test("curation refuses to send an empty patch or one that fixes nothing", () => {
  assert.equal(
    buildCurationRequest({ form: emptyCurationForm(), expectedRevision: 1, idempotencyKey: "k" }),
    null,
    "the contract requires at least one curated material field"
  );
  assert.equal(
    buildCurationRequest({
      form: filledCurationForm(),
      expectedRevision: 1,
      idempotencyKey: ""
    }),
    null,
    "an idempotency key is required, so a replay cannot create a second revision"
  );
});

test("an untouched form is recognised as empty so nothing is reported unsaved", () => {
  assert.equal(isProductDraftFormEmpty(emptyProductDraftForm()), true);
  assert.equal(isCurationFormEmpty(emptyCurationForm()), true);

  const typed = emptyProductDraftForm();
  typed.text.sku = "MXJ-BEAD-AMETHYST-08";
  assert.equal(isProductDraftFormEmpty(typed), false);

  const decided = emptyProductDraftForm();
  decided.decisions.allowAiTraining = false;
  assert.equal(isProductDraftFormEmpty(decided), false, "an explicit no is not an empty form");

  const curated = emptyCurationForm();
  curated.nameCn = "紫水晶";
  assert.equal(isCurationFormEmpty(curated), false);
});

test("two forms compare field by field, so a reverted edit reads as saved again", () => {
  const saved = filledProductForm();

  const edited = filledProductForm();
  edited.text.sku = "MXJ-BEAD-CITRINE-06";
  assert.equal(sameProductDraftForm(saved, edited), false);

  assert.equal(
    sameProductDraftForm(saved, filledProductForm()),
    true,
    "an edit that is put back reads as the saved form again"
  );

  const flipped = filledProductForm();
  flipped.decisions.allowPublicDisplay = false;
  assert.equal(sameProductDraftForm(saved, flipped), false);

  const recoloured = filledProductForm();
  recoloured.currency = "TWD";
  assert.equal(sameProductDraftForm(saved, recoloured), false);

  const savedCuration = filledCurationForm();
  assert.equal(sameCurationForm(savedCuration, filledCurationForm({ priceLevel: "4" })), false);
  assert.equal(sameCurationForm(savedCuration, filledCurationForm()), true);
});

test("the module reasons about values and reaches for no transport of its own", () => {
  assert.equal(SOURCE.startsWith('"use client"'), false);
  for (const forbidden of ["fetch(", "XMLHttpRequest"]) {
    assert.equal(SOURCE.includes(forbidden), false, `the model must not reach for ${forbidden}`);
  }
  for (const forbidden of [...FORBIDDEN_LEAKS, ...FORBIDDEN_CLAIMS, ...FORBIDDEN_INFERENCE]) {
    assert.equal(SOURCE.includes(forbidden), false, `the model must not mention ${forbidden}`);
  }
  assert.ok(
    SOURCE.includes("missingCrystalDraftCurationFields"),
    "completeness must be judged by the contract, not restated"
  );
});
