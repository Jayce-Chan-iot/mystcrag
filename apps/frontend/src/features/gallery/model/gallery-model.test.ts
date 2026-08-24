import assert from "node:assert/strict";
import test from "node:test";

import type { DesignPersistenceStatus, PublicDesignV1 } from "@mystcrag/design-contract";

import {
  detailRouteFor,
  filterGalleryEntries,
  formatGalleryUpdatedAt,
  gallerySourceLabel,
  galleryStats,
  GALLERY_FILTER_OPTIONS,
  statusLabelFor
} from "./gallery-model";

function design(overrides: Partial<PublicDesignV1>): PublicDesignV1 {
  return {
    designId: overrides.designId ?? "design-1",
    designName: overrides.designName ?? "星河守护",
    designMode: overrides.designMode ?? "TAROT_GUIDED",
    revision: 1,
    createdAt: "2026-05-01T08:00:00.000Z",
    updatedAt: "2026-05-20T06:32:00.000Z",
    locale: "zh-CN",
    currency: "CNY",
    bracelet: {
      wristCircumferenceMm: 150,
      targetInnerCircumferenceMm: 157,
      elasticAllowanceMm: 7,
      braceletLayout: "CIRCLE",
      beadGapMm: 0.4,
      totalBeadCount: 20
    },
    beads: [],
    accessories: [],
    story: overrides.story ?? {
      emotionTags: [],
      styleTags: [],
      colorPalette: [],
      culturalInspiration: [],
      designStory: "一段设计故事",
      recommendationReasons: [],
      sourceTemplateIds: []
    },
    pricing: overrides.pricing ?? {
      materialSubtotalMinor: 10000,
      accessorySubtotalMinor: 0,
      laborFeeMinor: 0,
      designFeeMinor: 0,
      packagingFeeMinor: 0,
      platformFeeEstimateMinor: 0,
      logisticsFeeEstimateMinor: 0,
      discountMinor: 0,
      adjustments: [],
      totalPriceMinor: 12280,
      pricingVersion: "cny-retail-2026-07-v1",
      priceCalculatedAt: "2026-05-20T06:32:00.000Z"
    },
    production: {
      wristCircumferenceMm: 150,
      billOfMaterials: [],
      componentSequence: [],
      anchoredComponents: [],
      productionNotes: [],
      substitutionRules: []
    },
    compliance: {
      complianceStatus: "PASSED",
      restrictedClaims: [],
      disclaimerKeys: [],
      reviewRequired: false
    },
    provenance: {
      generatedBy: "USER",
      modelProvider: null,
      modelName: null,
      promptVersion: null,
      knowledgeBaseVersion: null,
      designTemplateVersion: null,
      pricingRuleVersion: "cny-retail-2026-07-v1",
      sourceDesignId: null
    },
    community: {
      visibility: "PRIVATE",
      publishConsent: false,
      allowRemix: false,
      creatorDisplayMode: "ANONYMOUS"
    },
    ...overrides
  } as PublicDesignV1;
}

function entry(
  overrides: { design?: Partial<PublicDesignV1>; status?: DesignPersistenceStatus; updatedAt?: string }
) {
  return {
    design: design(overrides.design ?? {}),
    status: overrides.status ?? "SAVED",
    updatedAt: overrides.updatedAt ?? "2026-05-20T06:32:00.000Z"
  };
}

const ENTRIES = [
  entry({ design: { designId: "tarot-1", designName: "星河守护", designMode: "TAROT_GUIDED" }, status: "SAVED", updatedAt: "2026-05-20T06:32:00.000Z" }),
  entry({ design: { designId: "ai-1", designName: "清泉新生", designMode: "AI_GENERATED", story: { designStory: "泉水般的清新", emotionTags: [], styleTags: [], colorPalette: [], culturalInspiration: [], recommendationReasons: [], sourceTemplateIds: [] } }, status: "DRAFT", updatedAt: "2026-05-19T01:18:00.000Z" }),
  entry({ design: { designId: "diy-1", designName: "月雾回响", designMode: "DIY_CREATED" }, status: "SAVED", updatedAt: "2026-05-18T09:45:00.000Z" }),
  entry({ design: { designId: "ai-2", designName: "晨曦之光", designMode: "AI_ASSISTED" }, status: "SAVED", updatedAt: "2026-05-18T02:21:00.000Z" }),
  entry({ design: { designId: "diy-2", designName: "柔光絮语", designMode: "DIY_CREATED" }, status: "DRAFT", updatedAt: "2026-05-17T08:08:00.000Z" })
];

test("filter options cover the six approved gallery tabs", () => {
  assert.deepEqual(
    GALLERY_FILTER_OPTIONS.map((option) => option.id),
    ["ALL", "DRAFT", "COMPLETED", "AI_DESIGN", "TAROT_INSPIRED", "DIY"]
  );
  assert.deepEqual(
    GALLERY_FILTER_OPTIONS.map((option) => option.label),
    ["全部", "草稿", "已完成", "AI 设计", "塔罗灵感", "DIY"]
  );
});

test("status and source labels follow the approved wording", () => {
  assert.equal(statusLabelFor("DRAFT"), "草稿");
  assert.equal(statusLabelFor("GENERATED"), "草稿");
  assert.equal(statusLabelFor("SAVED"), "已完成");
  assert.equal(gallerySourceLabel(design({ designMode: "AI_GENERATED" })), "AI 设计");
  assert.equal(gallerySourceLabel(design({ designMode: "AI_ASSISTED" })), "AI 设计");
  assert.equal(gallerySourceLabel(design({ designMode: "TAROT_GUIDED" })), "塔罗灵感");
  assert.equal(gallerySourceLabel(design({ designMode: "DIY_CREATED" })), "DIY");
  assert.equal(gallerySourceLabel(design({ designMode: "TEMPLATE_REMIX" })), "DIY");
});

test("filtering by status tab keeps only matching persistence statuses", () => {
  const drafts = filterGalleryEntries(ENTRIES, "DRAFT", "");
  assert.deepEqual(drafts.map(({ design }) => design.designId), ["ai-1", "diy-2"]);
  const completed = filterGalleryEntries(ENTRIES, "COMPLETED", "");
  assert.deepEqual(completed.map(({ design }) => design.designId), ["tarot-1", "diy-1", "ai-2"]);
});

test("filtering by source tab keeps only matching design modes", () => {
  const ai = filterGalleryEntries(ENTRIES, "AI_DESIGN", "");
  assert.deepEqual(ai.map(({ design }) => design.designId), ["ai-1", "ai-2"]);
  const tarot = filterGalleryEntries(ENTRIES, "TAROT_INSPIRED", "");
  assert.deepEqual(tarot.map(({ design }) => design.designId), ["tarot-1"]);
  const diy = filterGalleryEntries(ENTRIES, "DIY", "");
  assert.deepEqual(diy.map(({ design }) => design.designId), ["diy-1", "diy-2"]);
});

test("search matches design names and stories case-insensitively", () => {
  assert.deepEqual(
    filterGalleryEntries(ENTRIES, "ALL", "泉").map(({ design }) => design.designId),
    ["ai-1"]
  );
  assert.deepEqual(
    filterGalleryEntries(ENTRIES, "ALL", "月雾").map(({ design }) => design.designId),
    ["diy-1"]
  );
  assert.deepEqual(filterGalleryEntries(ENTRIES, "ALL", "不存在的名字"), []);
});

test("stats summarize total, drafts, and completed counts", () => {
  assert.deepEqual(galleryStats(ENTRIES), { total: 5, drafts: 2, completed: 3 });
  assert.deepEqual(galleryStats([]), { total: 0, drafts: 0, completed: 0 });
});

test("detail routes send AI designs to the comparison view and others to the editor", () => {
  assert.equal(detailRouteFor(design({ designId: "ai-1", designMode: "AI_GENERATED" })), "/design/ai-1");
  assert.equal(detailRouteFor(design({ designId: "ai-2", designMode: "AI_ASSISTED" })), "/design/ai-2");
  assert.equal(detailRouteFor(design({ designId: "tarot-1", designMode: "TAROT_GUIDED" })), "/diy/tarot-1");
  assert.equal(detailRouteFor(design({ designId: "diy-1", designMode: "DIY_CREATED" })), "/diy/diy-1");
});

test("updated timestamps render as YYYY-MM-DD HH:mm in local display order", () => {
  assert.equal(formatGalleryUpdatedAt("2026-05-20T06:32:00.000Z").length, 16);
  assert.match(formatGalleryUpdatedAt("2026-05-20T06:32:00.000Z"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});
