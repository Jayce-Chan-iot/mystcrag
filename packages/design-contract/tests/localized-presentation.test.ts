import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DesignPresentationResponseSchema,
  LocalizedPresentationRequestSchema,
  OraclePresentationResponseSchema,
  PresentationLocaleSchema,
  TarotPresentationResponseSchema
} from "../src/index";

const oraclePresentation = {
  sessionId: "oracle-session-1",
  sourceRevision: 2,
  locale: "zh-CN",
  headline: "先稳住节奏，再观察转折",
  summary: "这组结构可作为观察当下节奏的一个角度，设计以沉静层次承接变化。",
  cues: [
    { kind: "COLOR", text: "以深色主调呈现沉静层次。" },
    { kind: "RHYTHM", text: "节奏保持稳定，只在动爻处转折。" },
    { kind: "ACCENT", text: "动爻对应位置作为克制点睛。" }
  ],
  materials: [
    { beadProductId: "product-obsidian-round-8", role: "PRIMARY", label: "黑曜石圆珠 8mm" },
    { beadProductId: "product-clear-quartz-round-6", role: "SUPPORT", label: "白水晶圆珠 6mm" }
  ],
  cards: [
    { designId: "oracle-design-1", title: "沉静主调", description: "以深色主调承接转折。" },
    { designId: "oracle-design-2", title: "对比层次", description: "以明暗对比强化节奏。" },
    { designId: "oracle-design-3", title: "中性主调", description: "以中性色稳定整体。" }
  ]
} as const;

const designPresentation = {
  designId: "oracle-design-1",
  sourceRevision: 3,
  locale: "en-US",
  title: "Grounded Rhythm",
  story: "A quiet dark base with a single restrained accent.",
  materialLabels: [
    { beadProductId: "product-obsidian-round-8", label: "Obsidian round bead 8mm" }
  ]
} as const;

const tarotPresentation = {
  sessionId: "tarot-session-1",
  sourceRevision: 6,
  locale: "zh-TW",
  headline: "把注意力放回當下的節奏",
  summary: "這組牌面邀請你從已有經驗中整理出更清晰的下一步。",
  cardReflections: [
    { slot: "PAST", text: "過去的沉澱可以成為穩定的參考。" },
    { slot: "PRESENT", text: "當下適合保留清晰而溫和的選擇。" },
    { slot: "FUTURE", text: "未來可用更開放的視角調整節奏。" }
  ],
  colorStory: "清透藍為主，柔和中性色承托，金色作為克制點綴。",
  designRationale: "藍白色調和清透材質呼應這次反思與整理的主題。",
  disclaimer: "內容僅供自我反思與設計靈感參考，不構成確定性建議或功效承諾。"
} as const;

test("localized presentation requests accept only the three approved display locales", () => {
  for (const locale of ["zh-CN", "zh-TW", "en-US"] as const) {
    assert.equal(LocalizedPresentationRequestSchema.safeParse({ locale }).success, true);
    assert.equal(PresentationLocaleSchema.safeParse(locale).success, true);
  }

  for (const locale of ["zh", "en", "ja-JP", "fr-FR", "zh-Hans-CN", "en-GB", ""]) {
    assert.equal(PresentationLocaleSchema.safeParse(locale).success, false);
    assert.equal(LocalizedPresentationRequestSchema.safeParse({ locale }).success, false);
  }

  assert.equal(LocalizedPresentationRequestSchema.safeParse({}).success, false);
  assert.equal(LocalizedPresentationRequestSchema.safeParse({ locale: "zh-CN", currency: "CNY" }).success, false);
});

test("Oracle presentation is a strict three-locale read-only projection", () => {
  assert.equal(OraclePresentationResponseSchema.safeParse(oraclePresentation).success, true);
  for (const locale of ["zh-TW", "en-US"] as const) {
    assert.equal(
      OraclePresentationResponseSchema.safeParse({ ...oraclePresentation, locale }).success,
      true
    );
  }
  assert.equal(
    OraclePresentationResponseSchema.safeParse({ ...oraclePresentation, locale: "ja-JP" }).success,
    false
  );

  assert.equal(
    OraclePresentationResponseSchema.safeParse({
      ...oraclePresentation,
      cast: { lines: [7, 8, 9, 6, 7, 8] }
    }).success,
    false
  );
  assert.equal(
    OraclePresentationResponseSchema.safeParse({ ...oraclePresentation, totalPriceMinor: 12800 }).success,
    false
  );
  assert.equal(
    OraclePresentationResponseSchema.safeParse({ ...oraclePresentation, currency: "CNY" }).success,
    false
  );
  assert.equal(
    OraclePresentationResponseSchema.safeParse({
      ...oraclePresentation,
      cues: [{ kind: "TEXTURE", text: "未知维度" }]
    }).success,
    false
  );
  assert.equal(
    OraclePresentationResponseSchema.safeParse({
      ...oraclePresentation,
      materials: [{ beadProductId: "product-obsidian-round-8", role: "PRIMARY", label: "黑曜石", unitPriceMinor: 400 }]
    }).success,
    false
  );
  assert.equal(
    OraclePresentationResponseSchema.safeParse({
      ...oraclePresentation,
      cards: [{ designId: "oracle-design-1", title: "沉静主调", description: "承接转折", beads: [] }]
    }).success,
    false
  );

  const parsed = OraclePresentationResponseSchema.parse(oraclePresentation);
  assert.deepEqual(Object.keys(parsed.materials[0]!).sort(), ["beadProductId", "label", "role"]);
  assert.deepEqual(Object.keys(parsed.cards[0]!).sort(), ["description", "designId", "title"]);
});

test("Oracle presentation allows a cast-only projection with no cards or materials", () => {
  assert.equal(
    OraclePresentationResponseSchema.safeParse({ ...oraclePresentation, cards: [], materials: [] }).success,
    true
  );
  assert.equal(
    OraclePresentationResponseSchema.safeParse({ ...oraclePresentation, cards: [] }).success,
    true
  );
  assert.equal(
    OraclePresentationResponseSchema.safeParse({ ...oraclePresentation, materials: [] }).success,
    true
  );
});

test("Oracle presentation accepts exactly three recommendation cards and rejects one or two", () => {
  const threeCards = oraclePresentation.cards;
  assert.equal(threeCards.length, 3);

  for (const count of [1, 2]) {
    assert.equal(
      OraclePresentationResponseSchema.safeParse({
        ...oraclePresentation,
        cards: threeCards.slice(0, count)
      }).success,
      false
    );
  }
  assert.equal(
    OraclePresentationResponseSchema.safeParse({
      ...oraclePresentation,
      cards: [...threeCards, threeCards[0]]
    }).success,
    false
  );
});

test("Oracle presentation never fabricates a material SKU when nothing is displayable", () => {
  const empty = OraclePresentationResponseSchema.parse({ ...oraclePresentation, materials: [] });
  assert.deepEqual(empty.materials, []);

  assert.equal(
    OraclePresentationResponseSchema.safeParse({
      ...oraclePresentation,
      materials: [{ beadProductId: "", role: "PRIMARY", label: "虚构材质" }]
    }).success,
    false
  );
});

test("Design presentation exposes labels only and rejects authority copies", () => {
  assert.equal(DesignPresentationResponseSchema.safeParse(designPresentation).success, true);
  assert.equal(
    DesignPresentationResponseSchema.safeParse({ ...designPresentation, locale: "zh-CN" }).success,
    true
  );
  assert.equal(
    DesignPresentationResponseSchema.safeParse({ ...designPresentation, locale: "ja-JP" }).success,
    false
  );

  assert.equal(
    DesignPresentationResponseSchema.safeParse({ ...designPresentation, pricing: { totalPriceMinor: 12800 } })
      .success,
    false
  );
  assert.equal(
    DesignPresentationResponseSchema.safeParse({ ...designPresentation, beads: [] }).success,
    false
  );
  assert.equal(
    DesignPresentationResponseSchema.safeParse({ ...designPresentation, unitPriceMinor: 400 }).success,
    false
  );
  assert.equal(
    DesignPresentationResponseSchema.safeParse({
      ...designPresentation,
      materialLabels: [{ beadProductId: "product-obsidian-round-8", label: "黑曜石", availableQuantity: 3 }]
    }).success,
    false
  );

  const parsed = DesignPresentationResponseSchema.parse(designPresentation);
  assert.deepEqual(Object.keys(parsed.materialLabels[0]!).sort(), ["beadProductId", "label"]);
});

test("Tarot presentation reuses canonical slots and never returns a second draw", () => {
  assert.equal(TarotPresentationResponseSchema.safeParse(tarotPresentation).success, true);
  assert.equal(
    TarotPresentationResponseSchema.safeParse({ ...tarotPresentation, locale: "zh-CN" }).success,
    true
  );
  assert.equal(
    TarotPresentationResponseSchema.safeParse({
      ...tarotPresentation,
      cardReflections: [{ slot: "GUIDANCE", text: "單張指引可讀。" }]
    }).success,
    true
  );
  assert.equal(
    TarotPresentationResponseSchema.safeParse({ ...tarotPresentation, locale: "ja-JP" }).success,
    false
  );
  assert.equal(
    TarotPresentationResponseSchema.safeParse({
      ...tarotPresentation,
      cardReflections: [{ slot: "PASTT", text: "未知牌位。" }]
    }).success,
    false
  );
  assert.equal(
    TarotPresentationResponseSchema.safeParse({
      ...tarotPresentation,
      revealedCards: [
        { slot: "PAST", cardId: "the-hermit", orientation: "UPRIGHT", keywords: ["reflection"] }
      ]
    }).success,
    false
  );
  assert.equal(
    TarotPresentationResponseSchema.safeParse({ ...tarotPresentation, cards: [] }).success,
    false
  );
  assert.equal(
    TarotPresentationResponseSchema.safeParse({ ...tarotPresentation, totalPriceMinor: 9900 }).success,
    false
  );
});

test("localized presentation schemas are exported from the package root", () => {
  const indexSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(indexSource, /export \* from "\.\/schemas\/localized-presentation\.schema"/);
});