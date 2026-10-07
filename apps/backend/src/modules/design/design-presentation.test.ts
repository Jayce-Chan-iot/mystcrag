import assert from "node:assert/strict";
import test from "node:test";

import { hasProhibitedOracleClaim } from "@mystcrag/ai-agent/oracle";
import { DesignPresentationResponseSchema } from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import {
  projectDesignPresentation,
  type DesignPresentationCatalogProduct
} from "./design-presentation.js";

const LOCALES = ["zh-CN", "zh-TW", "en-US"] as const;

const design = structuredClone(standardAiDesignFixture);

function catalog(): DesignPresentationCatalogProduct[] {
  return [
    {
      beadProductId: "product-aquamarine-round-8",
      crystalId: "crystal-aquamarine",
      crystalNameCn: "海蓝宝",
      crystalNameEn: "Aquamarine",
      shape: "ROUND",
      diameterMm: 8,
      availableQuantity: 5
    },
    {
      beadProductId: "product-moonstone-round-6",
      crystalId: "crystal-moonstone",
      crystalNameCn: "月光石",
      crystalNameEn: "Moonstone",
      shape: "ROUND",
      diameterMm: 6,
      availableQuantity: 4
    },
    {
      beadProductId: "product-quartz-round-10",
      crystalId: "crystal-clear-quartz",
      crystalNameCn: "白水晶",
      crystalNameEn: "Clear quartz",
      shape: "ROUND",
      diameterMm: 10,
      availableQuantity: 2
    }
  ];
}

const presentationTexts = (projection: ReturnType<typeof projectDesignPresentation>): string[] => [
  projection.title,
  projection.story,
  ...projection.materialLabels.map((entry) => entry.label)
];

test("a saved design projects into all three display locales with its exact identity", () => {
  const titles = new Set<string>();

  for (const locale of LOCALES) {
    const projection = projectDesignPresentation(design, locale, catalog());

    assert.equal(DesignPresentationResponseSchema.safeParse(projection).success, true);
    assert.equal(projection.designId, design.designId);
    assert.equal(projection.sourceRevision, design.revision);
    assert.equal(projection.locale, locale);
    assert.equal(projection.materialLabels.length, design.beads.length);
    assert.deepEqual(
      projection.materialLabels.map((entry) => entry.beadProductId),
      design.beads.map((bead) => bead.beadProductId)
    );
    titles.add(projection.title);
  }

  assert.equal(titles.size, 3, "each locale must render distinct reviewed copy");
});

test("localized material labels use catalog names and reviewed Traditional names", () => {
  const zhCn = projectDesignPresentation(design, "zh-CN", catalog());
  const zhTw = projectDesignPresentation(design, "zh-TW", catalog());
  const enUs = projectDesignPresentation(design, "en-US", catalog());

  const cnAquamarine = zhCn.materialLabels.find(
    (entry) => entry.beadProductId === "product-aquamarine-round-8"
  )!;
  const twAquamarine = zhTw.materialLabels.find(
    (entry) => entry.beadProductId === "product-aquamarine-round-8"
  )!;
  const enAquamarine = enUs.materialLabels.find(
    (entry) => entry.beadProductId === "product-aquamarine-round-8"
  )!;

  assert.match(cnAquamarine.label, /海蓝宝/u);
  assert.match(twAquamarine.label, /海藍寶/u);
  assert.equal(twAquamarine.label.includes("海蓝宝"), false);
  assert.match(enAquamarine.label, /Aquamarine/u);
  assert.match(enAquamarine.label, /8mm/u);

  const englishText = presentationTexts(enUs).join(" ");
  assert.equal(/[\u3400-\u9fff\uf900-\ufaff]/u.test(englishText), false, "en-US copy must not mix Han text");
});

test("the projection is deterministic, read-only, and never reuses historical free text", () => {
  const designSnapshot = structuredClone(design);
  const catalogSnapshot = structuredClone(catalog());

  assert.deepEqual(
    projectDesignPresentation(design, "zh-CN", catalog()),
    projectDesignPresentation(design, "zh-CN", catalog())
  );
  assert.deepEqual(design, designSnapshot, "the source design must never be mutated");
  assert.deepEqual(catalog(), catalogSnapshot, "the catalog must never be mutated");

  for (const locale of LOCALES) {
    const projection = projectDesignPresentation(design, locale, catalog());
    assert.notEqual(projection.title, design.designName);
    assert.notEqual(projection.story, design.story.designStory);
    assert.equal(presentationTexts(projection).includes(design.designName), false);
    assert.equal(presentationTexts(projection).includes(design.story.designStory), false);
  }
});

test("zero-stock and unavailable materials keep real labels without inventing stock or identity", () => {
  const zeroStock = catalog().map((product) => ({ ...product, availableQuantity: 0 }));
  const projection = projectDesignPresentation(design, "zh-CN", zeroStock);

  assert.equal(DesignPresentationResponseSchema.safeParse(projection).success, true);
  assert.equal(projection.materialLabels.length, design.beads.length);

  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes("availableQuantity"), false);
  assert.equal(serialized.includes("unitPriceMinor"), false);
  assert.equal(serialized.includes("totalPriceMinor"), false);
  assert.equal(serialized.includes("SKU-"), false);

  const missingCatalog = projectDesignPresentation(design, "en-US", []);
  assert.equal(DesignPresentationResponseSchema.safeParse(missingCatalog).success, true);
  assert.equal(missingCatalog.materialLabels.length, design.beads.length);
  for (const entry of missingCatalog.materialLabels) {
    assert.match(entry.label, /mm/u, "the real bead diameter stays visible without a catalog name");
  }
  assert.equal(JSON.stringify(missingCatalog).includes("Aquamarine"), false);
});

test("prohibited claims in catalog names never reach any locale projection", () => {
  const unsafeCatalog = catalog().map((product) =>
    product.beadProductId === "product-aquamarine-round-8"
      ? { ...product, crystalNameCn: "招财水晶", crystalNameEn: "Healing crystal" }
      : product
  );

  for (const locale of LOCALES) {
    const projection = projectDesignPresentation(design, locale, unsafeCatalog);
    const text = presentationTexts(projection).join(" ");
    assert.equal(text.includes("招财"), false, `${locale} leaked a Chinese efficacy claim`);
    assert.equal(/heal/iu.test(text), false, `${locale} leaked an English efficacy claim`);
    assert.ok(
      projection.materialLabels.some((entry) => entry.beadProductId === "product-aquamarine-round-8"),
      `${locale} still references the real product without fabricating identity`
    );
  }
});

test("every generated projection string is free of prohibited claims", () => {
  for (const locale of LOCALES) {
    const projection = projectDesignPresentation(design, locale, catalog());
    for (const text of presentationTexts(projection)) {
      assert.equal(hasProhibitedOracleClaim(text), false, `${locale}: ${text}`);
    }
  }
});

test("an unsupported display locale is rejected before any projection", () => {
  assert.throws(() => projectDesignPresentation(design, "ja-JP" as never, catalog()));
  assert.throws(() => projectDesignPresentation(design, "zh" as never, catalog()));
});