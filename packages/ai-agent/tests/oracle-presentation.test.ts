import assert from "node:assert/strict";
import test from "node:test";

import {
  CatalogMaterialProductSchema,
  OraclePresentationResponseSchema,
  OraclePublicSessionSchema,
  type CatalogMaterialProduct,
  type OraclePublicSession
} from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { hasProhibitedOracleClaim, projectOraclePresentation } from "../src/oracle/index.js";

const SESSION_ID = "oracle-session-1";
const RULE_VERSION = "oracle-design-rules-v1";
const CREATED_AT = "2026-09-29T08:00:00.000Z";
const LOCALES = ["zh-CN", "zh-TW", "en-US"] as const;
const DIRECTIONS = ["BALANCED", "CONTRAST", "NEUTRAL_LED"] as const;

const cast = {
  lines: [7, 8, 9, 6, 7, 8],
  movingLineIndices: [3, 4],
  primaryHexagram: { number: 39, nameZh: "蹇", lowerTrigram: "WATER", upperTrigram: "MOUNTAIN" },
  transformedHexagram: { number: 31, nameZh: "咸", lowerTrigram: "MOUNTAIN", upperTrigram: "LAKE" },
  algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
} as const;

const signal = {
  ruleVersion: RULE_VERSION,
  primaryColorTags: ["color:black", "color:blue"],
  supportColorTags: ["color:white"],
  styleTags: ["style:eastern-contemporary"],
  rhythmTags: ["rhythm:steady"],
  accentLinePositions: [3, 4]
} as const;

const interpretation = {
  headline: "先稳住节奏，再观察转折",
  summary: "这组结构可作为观察当下节奏的一个角度，设计以沉静层次承接变化。",
  keywords: ["沉静", "节奏", "转折"],
  designRationale: "深色主调配一处克制点睛，让动爻只成为视觉转折而非命运判断。",
  disclaimer: "内容仅作文化观察与设计灵感，不构成预测、医疗建议或水晶功效承诺。",
  source: { kind: "MYSTCRAG_ORIGINAL", version: "oracle-copy-v1" }
} as const;

const oracleDesigns = DIRECTIONS.map((direction, index) => {
  const design = structuredClone(standardAiDesignFixture);
  design.designId = `oracle-design-${index + 1}`;
  design.designMode = "ORACLE_GUIDED" as typeof design.designMode;
  design.provenance.oracleCandidate = {
    sessionId: SESSION_ID,
    ruleVersion: RULE_VERSION,
    rank: index + 1,
    direction
  };
  return design;
});

const recommendedSession: OraclePublicSession = OraclePublicSessionSchema.parse({
  sessionId: SESSION_ID,
  status: "RECOMMENDED",
  revision: 2,
  locale: "zh-CN",
  currency: "CNY",
  wristCircumferenceMm: 155,
  cast,
  signal,
  interpretation,
  recommendations: oracleDesigns.map((design, index) => ({
    rank: index + 1,
    direction: DIRECTIONS[index],
    design
  })),
  createdAt: CREATED_AT,
  updatedAt: "2026-09-29T08:00:02.000Z"
});

const staticCastSession: OraclePublicSession = OraclePublicSessionSchema.parse({
  sessionId: "oracle-session-static",
  status: "CAST",
  revision: 1,
  locale: "zh-CN",
  currency: "CNY",
  cast: {
    lines: [7, 7, 7, 7, 7, 7],
    movingLineIndices: [],
    primaryHexagram: { number: 1, nameZh: "乾", lowerTrigram: "HEAVEN", upperTrigram: "HEAVEN" },
    algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
  },
  signal: {
    ruleVersion: RULE_VERSION,
    primaryColorTags: ["color:white", "color:gray"],
    supportColorTags: [],
    styleTags: ["style:minimal"],
    rhythmTags: ["rhythm:steady"],
    accentLinePositions: []
  },
  interpretation,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT
});

const material = (overrides: Record<string, unknown>): CatalogMaterialProduct =>
  CatalogMaterialProductSchema.parse({
    beadProductId: "product-aquamarine-round-8",
    sku: "SKU-AQUAMARINE-8",
    displayName: "Aquamarine round bead 8mm",
    crystalId: "crystal-aquamarine",
    crystalNameCn: "海蓝宝",
    crystalNameEn: "Aquamarine",
    colorTags: ["color:blue"],
    visualTags: [],
    styleTags: [],
    emotionTags: [],
    cultureTags: [],
    materialKey: "aquamarine-clear-v1",
    shape: "ROUND",
    diameterMm: 8,
    modelAssetKey: "sphere-round-8mm-v1",
    textureAssetKey: "aquamarine-clear-texture-v1",
    currency: "CNY",
    unitPriceMinor: 1200,
    availableQuantity: 5,
    ...overrides
  });

const availableCatalog: readonly CatalogMaterialProduct[] = [
  material({}),
  material({
    beadProductId: "product-moonstone-round-6",
    sku: "SKU-MOONSTONE-6",
    crystalId: "crystal-moonstone",
    crystalNameCn: "月光石",
    crystalNameEn: "Moonstone",
    materialKey: "moonstone-soft-v1",
    diameterMm: 6,
    availableQuantity: 4
  }),
  material({
    beadProductId: "product-quartz-round-10",
    sku: "SKU-QUARTZ-10",
    crystalId: "crystal-clear-quartz",
    crystalNameCn: "白水晶",
    crystalNameEn: "Clear quartz",
    materialKey: "clear-quartz-v1",
    diameterMm: 10,
    availableQuantity: 2
  })
];

const projectionTexts = (projection: ReturnType<typeof projectOraclePresentation>): string[] => [
  projection.headline,
  projection.summary,
  ...projection.cues.map((cue) => cue.text),
  ...projection.cards.flatMap((card) => [card.title, card.description]),
  ...projection.materials.map((entry) => entry.label)
];

test("a recommended session projects readable copy in all three display locales", () => {
  const headlines = new Set<string>();

  for (const locale of LOCALES) {
    const projection = projectOraclePresentation(recommendedSession, locale, availableCatalog);

    assert.equal(OraclePresentationResponseSchema.safeParse(projection).success, true);
    assert.equal(projection.locale, locale);
    assert.equal(projection.sessionId, recommendedSession.sessionId);
    assert.equal(projection.sourceRevision, recommendedSession.revision);
    assert.equal(projection.sourceRevision, 2);
    assert.ok(projection.headline.length > 0 && projection.headline.length <= 48);
    assert.ok(projection.summary.length > 0 && projection.summary.length <= 240);
    assert.ok(projection.cues.length >= 1);
    assert.deepEqual(
      [...new Set(projection.cues.map((cue) => cue.kind))].sort(),
      ["ACCENT", "COLOR", "RHYTHM"]
    );

    headlines.add(projection.headline);
  }

  assert.equal(headlines.size, 3, "each locale must render distinct reviewed copy");
});

test("cards reuse the persisted three recommendation design IDs in rank order", () => {
  const expectedIds = [...recommendedSession.recommendations!]
    .sort((left, right) => left.rank - right.rank)
    .map((recommendation) => recommendation.design.designId);

  for (const locale of LOCALES) {
    const projection = projectOraclePresentation(recommendedSession, locale, availableCatalog);
    assert.equal(projection.cards.length, 3);
    assert.deepEqual(projection.cards.map((card) => card.designId), expectedIds);
    assert.deepEqual(projection.cards.map((card) => card.designId), [
      "oracle-design-1",
      "oracle-design-2",
      "oracle-design-3"
    ]);
  }
});

test("an old single-language session projects into every locale without mutation or mixed copy", () => {
  const sessionSnapshot = structuredClone(recommendedSession);
  const catalogSnapshot = structuredClone(availableCatalog);

  for (const locale of LOCALES) {
    const projection = projectOraclePresentation(recommendedSession, locale, availableCatalog);
    assert.equal(OraclePresentationResponseSchema.safeParse(projection).success, true);
  }

  assert.deepEqual(recommendedSession, sessionSnapshot, "the source session must never be mutated");
  assert.deepEqual(recommendedSession.interpretation, sessionSnapshot.interpretation);
  assert.deepEqual(availableCatalog, catalogSnapshot, "the catalog must never be mutated");

  const english = projectOraclePresentation(recommendedSession, "en-US", availableCatalog);
  const englishText = projectionTexts(english).join(" ");
  assert.equal(englishText.includes(recommendedSession.interpretation.headline), false);
  assert.equal(englishText.includes(recommendedSession.interpretation.summary), false);
  assert.equal(englishText.includes(recommendedSession.interpretation.designRationale), false);
  assert.equal(/[\u3400-\u9fff\uf900-\ufaff]/u.test(englishText), false, "en-US copy must not mix Han text");

  const traditional = projectOraclePresentation(recommendedSession, "zh-TW", availableCatalog);
  const simplified = projectOraclePresentation(recommendedSession, "zh-CN", availableCatalog);
  assert.notEqual(traditional.headline, simplified.headline);
  assert.match(traditional.headline, /主色、節奏與點睛/u);
  assert.match(simplified.headline, /主色、节奏与点睛/u);
  assert.equal(traditional.cards[1]!.title, "明暗對比");
  assert.equal(simplified.cards[1]!.title, "明暗对比");
});

test("a CAST session yields no cards and no materials while staying a valid projection", () => {
  for (const locale of LOCALES) {
    const projection = projectOraclePresentation(staticCastSession, locale, availableCatalog);
    assert.equal(OraclePresentationResponseSchema.safeParse(projection).success, true);
    assert.equal(projection.sourceRevision, staticCastSession.revision);
    assert.deepEqual(projection.cards, []);
    assert.deepEqual(projection.materials, []);
    assert.equal(projection.cues.some((cue) => cue.kind === "ACCENT"), false);
    assert.ok(projection.cues.length >= 1);
  }
});

test("materials reference only real, available catalog products from the recommendations", () => {
  const projection = projectOraclePresentation(recommendedSession, "zh-CN", availableCatalog);

  assert.deepEqual(
    projection.materials.map((entry) => entry.beadProductId).sort(),
    ["product-aquamarine-round-8", "product-moonstone-round-6", "product-quartz-round-10"]
  );

  const availableIds = new Set(
    availableCatalog.filter((product) => product.availableQuantity > 0).map((product) => product.beadProductId)
  );
  const recommendationIds = new Set(
    recommendedSession.recommendations!.flatMap((recommendation) =>
      recommendation.design.beads.map((bead) => bead.beadProductId)
    )
  );

  for (const entry of projection.materials) {
    assert.equal(availableIds.has(entry.beadProductId), true, entry.beadProductId);
    assert.equal(recommendationIds.has(entry.beadProductId), true, entry.beadProductId);
  }

  assert.equal(projection.materials.some((entry) => entry.beadProductId === "product-spacer-silver-3"), false);
  assert.equal(JSON.stringify(projection).includes("unitPriceMinor"), false);
  assert.equal(JSON.stringify(projection).includes("availableQuantity"), false);
  assert.equal(JSON.stringify(projection).includes("totalPriceMinor"), false);
});

test("zero-stock and unknown products are dropped rather than fabricated", () => {
  const scarceCatalog: readonly CatalogMaterialProduct[] = [
    material({ availableQuantity: 0 }),
    material({ beadProductId: "product-moonstone-round-6", availableQuantity: 0 }),
    material({
      beadProductId: "product-unrelated-round-4",
      sku: "SKU-UNRELATED-4",
      crystalNameCn: "无关珠",
      crystalNameEn: "Unrelated bead",
      availableQuantity: 9
    })
  ];

  const projection = projectOraclePresentation(recommendedSession, "en-US", scarceCatalog);
  assert.deepEqual(projection.materials, []);
  assert.equal(projection.cards.length, 3, "cards are persisted facts and do not depend on stock");

  const emptyCatalog = projectOraclePresentation(recommendedSession, "en-US", []);
  assert.deepEqual(emptyCatalog.materials, []);
  assert.equal(JSON.stringify(emptyCatalog).includes("beadProductId"), false);
});

test("material labels are localized from catalog names and never invent a SKU", () => {
  const zh = projectOraclePresentation(recommendedSession, "zh-CN", availableCatalog);
  const en = projectOraclePresentation(recommendedSession, "en-US", availableCatalog);

  const zhAquamarine = zh.materials.find((entry) => entry.beadProductId === "product-aquamarine-round-8");
  const enAquamarine = en.materials.find((entry) => entry.beadProductId === "product-aquamarine-round-8");
  assert.ok(zhAquamarine);
  assert.ok(enAquamarine);
  assert.match(zhAquamarine.label, /海蓝宝/u);
  assert.match(enAquamarine.label, /Aquamarine/u);
  assert.match(enAquamarine.label, /8mm/u);
  assert.equal(JSON.stringify(zh).includes("SKU-"), false);
});

test("every generated projection string is free of prohibited claims", () => {
  for (const locale of LOCALES) {
    const projection = projectOraclePresentation(recommendedSession, locale, availableCatalog);
    for (const text of projectionTexts(projection)) {
      assert.equal(hasProhibitedOracleClaim(text), false, `${locale}: ${text}`);
    }
  }

  const castProjection = projectOraclePresentation(staticCastSession, "zh-CN", availableCatalog);
  for (const text of projectionTexts(castProjection)) {
    assert.equal(hasProhibitedOracleClaim(text), false, text);
  }
});

test("projection is deterministic and rejects an unsupported display locale", () => {
  assert.deepEqual(
    projectOraclePresentation(recommendedSession, "zh-CN", availableCatalog),
    projectOraclePresentation(recommendedSession, "zh-CN", availableCatalog)
  );

  assert.throws(() => projectOraclePresentation(recommendedSession, "ja-JP" as never, availableCatalog));
  assert.throws(() => projectOraclePresentation(recommendedSession, "zh" as never, availableCatalog));
});

test("the projection is exported from the bounded oracle module", () => {
  assert.equal(typeof projectOraclePresentation, "function");
});

const withSubstitutedBeadProduct = (
  session: OraclePublicSession,
  recommendationIndex: number,
  beadProductId: string
): OraclePublicSession => {
  const clone = structuredClone(session);
  clone.recommendations![recommendationIndex]!.design.beads[0]!.beadProductId = beadProductId;
  return clone;
};

const STRUCTURAL_JARGON = /卦|爻|THREE_COIN|three-coin|算法|algorithm|\b(?:39|31|47|60)\b/u;

test("customer-facing headline, summary, and accent cue hide structural jargon", () => {
  const expectedPrimary = { "zh-CN": "墨黑", "zh-TW": "墨黑", "en-US": "ink black" } as const;
  const expectedRhythm = {
    "zh-CN": "均衡留白",
    "zh-TW": "均衡留白",
    "en-US": "measured spacing"
  } as const;

  for (const locale of LOCALES) {
    const projection = projectOraclePresentation(recommendedSession, locale, availableCatalog);
    const accent = projection.cues.find((cue) => cue.kind === "ACCENT");
    assert.ok(accent, `${locale} moving cast keeps an accent cue`);

    const exposed = [projection.headline, projection.summary, accent.text].join(" ");
    assert.equal(STRUCTURAL_JARGON.test(exposed), false, `${locale}: ${exposed}`);

    assert.match(projection.summary, new RegExp(expectedPrimary[locale], "u"));
    assert.match(projection.summary, new RegExp(expectedRhythm[locale], "u"));
  }
});

test("a CAST projection also hides structural jargon and keeps no accent cue", () => {
  for (const locale of LOCALES) {
    const projection = projectOraclePresentation(staticCastSession, locale, availableCatalog);
    const exposed = [projection.headline, projection.summary, ...projection.cues.map((cue) => cue.text)].join(" ");
    assert.equal(STRUCTURAL_JARGON.test(exposed), false, `${locale}: ${exposed}`);
    assert.equal(projection.cues.some((cue) => cue.kind === "ACCENT"), false);
  }
});

test("traditional material labels use reviewed names instead of simplified catalog text", () => {
  const zhTw = projectOraclePresentation(recommendedSession, "zh-TW", availableCatalog);
  const zhCn = projectOraclePresentation(recommendedSession, "zh-CN", availableCatalog);

  const twAquamarine = zhTw.materials.find((entry) => entry.beadProductId === "product-aquamarine-round-8");
  const cnAquamarine = zhCn.materials.find((entry) => entry.beadProductId === "product-aquamarine-round-8");
  assert.ok(twAquamarine);
  assert.ok(cnAquamarine);

  assert.match(twAquamarine.label, /海藍寶/u);
  assert.equal(twAquamarine.label.includes("海蓝宝"), false);
  assert.match(cnAquamarine.label, /海蓝宝/u);
  assert.notEqual(twAquamarine.label, cnAquamarine.label);
});

test("unmapped crystal names fall back safely without reusing simplified script", () => {
  const marsProduct = material({
    beadProductId: "product-mars-round-6",
    sku: "SKU-MARS-6",
    crystalId: "crystal-mars",
    crystalNameCn: "火星石",
    crystalNameEn: "Mars stone",
    materialKey: "mars-stone-v1",
    diameterMm: 6,
    availableQuantity: 3
  });

  const session = withSubstitutedBeadProduct(recommendedSession, 0, "product-mars-round-6");
  const zhTw = projectOraclePresentation(session, "zh-TW", [...availableCatalog, marsProduct]);
  const entry = zhTw.materials.find((item) => item.beadProductId === "product-mars-round-6");
  assert.ok(entry);

  assert.equal(entry.label.includes("火星石"), false, "must not reuse the simplified catalog name");
  assert.match(entry.label, /Mars stone/u, "documented fallback is the authoritative English catalog name");
});

test("prohibited claims in catalog names never reach any locale projection", () => {
  const badProduct = material({
    beadProductId: "product-bad-round-8",
    sku: "SKU-BAD-8",
    crystalId: "crystal-bad",
    crystalNameCn: "招财水晶",
    crystalNameEn: "Healing crystal",
    materialKey: "bad-crystal-v1",
    availableQuantity: 5
  });

  const session = withSubstitutedBeadProduct(recommendedSession, 0, "product-bad-round-8");
  const catalog = [...availableCatalog, badProduct];

  for (const locale of LOCALES) {
    const projection = projectOraclePresentation(session, locale, catalog);
    const text = projectionTexts(projection).join(" ");
    assert.equal(text.includes("招财"), false, `${locale} leaked a Chinese efficacy claim`);
    assert.equal(/heal/iu.test(text), false, `${locale} leaked an English efficacy claim`);

    const entry = projection.materials.find((item) => item.beadProductId === "product-bad-round-8");
    assert.ok(entry, `${locale} still references the real product without fabricating identity`);

    const serialized = JSON.stringify(projection);
    assert.equal(serialized.includes("SKU-"), false);
    assert.equal(serialized.includes("unitPriceMinor"), false);
    assert.equal(serialized.includes("availableQuantity"), false);
  }
});