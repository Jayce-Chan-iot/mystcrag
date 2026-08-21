import assert from "node:assert/strict";
import test from "node:test";

import {
  AccessoryV1Schema,
  BeadV1Schema,
  CatalogMaterialProductSchema,
  DesignV1Schema,
  VisualProfileSchema
} from "../src/index";
import { standardAiDesignFixture } from "../src/fixtures/index";

const validVisualProfile = {
  colorFamily: "color:purple",
  secondaryColorFamily: "color:white",
  saturationLevel: "saturation-level:low",
  lightnessLevel: "lightness-level:medium",
  temperature: "temperature:cool",
  transparency: "transparency:transparent",
  luster: "luster:soft",
  visualWeight: "MEDIUM",
  uniformity: "HIGH",
  textureComplexity: "LOW"
};

test("VisualProfile accepts a complete taxonomy-driven profile", () => {
  const result = VisualProfileSchema.safeParse(validVisualProfile);
  assert.equal(result.success, true);
});

test("VisualProfile rejects unknown taxonomy ids and invalid level enums", () => {
  assert.equal(
    VisualProfileSchema.safeParse({ ...validVisualProfile, colorFamily: "color:not-a-color" }).success,
    false
  );
  assert.equal(
    VisualProfileSchema.safeParse({ ...validVisualProfile, temperature: "temperature:hot" }).success,
    false
  );
  assert.equal(
    VisualProfileSchema.safeParse({ ...validVisualProfile, saturationLevel: "saturation-level:ultra" }).success,
    false
  );
  assert.equal(
    VisualProfileSchema.safeParse({ ...validVisualProfile, transparency: "color:blue" }).success,
    false
  );
  assert.equal(
    VisualProfileSchema.safeParse({ ...validVisualProfile, visualWeight: "HEAVY" }).success,
    false
  );
  assert.equal(
    VisualProfileSchema.safeParse({ ...validVisualProfile, uniformity: "SOMETIMES" }).success,
    false
  );
});

test("VisualProfile requires color family and level refs; secondary family is optional", () => {
  const { secondaryColorFamily: _secondary, ...requiredOnly } = validVisualProfile;
  assert.equal(VisualProfileSchema.safeParse(requiredOnly).success, true);

  const noColor = { ...validVisualProfile } as { colorFamily?: string };
  delete noColor.colorFamily;
  assert.equal(VisualProfileSchema.safeParse(noColor).success, false);

  const noLuster = { ...validVisualProfile } as { luster?: string };
  delete noLuster.luster;
  assert.equal(VisualProfileSchema.safeParse(noLuster).success, false);
});

test("VisualProfile rejects unknown fields", () => {
  assert.equal(
    VisualProfileSchema.safeParse({ ...validVisualProfile, tarotCards: [] }).success,
    false
  );
});

const catalogMaterialBase = {
  beadProductId: "product-amethyst-faceted-8",
  sku: "AM-CNY-8",
  displayName: "紫水晶切面珠 8mm",
  crystalId: "crystal-amethyst",
  crystalNameCn: "紫水晶",
  crystalNameEn: "Amethyst",
  colorTags: ["purple", "cool", "deep"],
  visualTags: ["translucent", "faceted"],
  styleTags: ["minimal"],
  emotionTags: ["calm-aesthetic"],
  cultureTags: ["design-inspiration-only"],
  materialKey: "crystal-amethyst-material-v1",
  shape: "FACETED",
  diameterMm: 8,
  modelAssetKey: "sphere-faceted-8mm-v1",
  textureAssetKey: "crystal-amethyst-texture-v1",
  currency: "CNY",
  unitPriceMinor: 680
};

test("CatalogMaterialProduct accepts optional Product V2 fields", () => {
  assert.equal(CatalogMaterialProductSchema.safeParse(catalogMaterialBase).success, true);

  const withV2 = {
    ...catalogMaterialBase,
    lengthAlongStringMm: 8.4,
    visualProfile: validVisualProfile
  };
  assert.equal(CatalogMaterialProductSchema.safeParse(withV2).success, true);

  assert.equal(
    CatalogMaterialProductSchema.safeParse({ ...catalogMaterialBase, lengthAlongStringMm: 0 }).success,
    false
  );
  assert.equal(
    CatalogMaterialProductSchema.safeParse({ ...catalogMaterialBase, lengthAlongStringMm: -1 }).success,
    false
  );
  assert.equal(
    CatalogMaterialProductSchema.safeParse({
      ...catalogMaterialBase,
      visualProfile: { ...validVisualProfile, colorFamily: "purple" }
    }).success,
    false,
    "catalog visual profiles must use canonical taxonomy ids"
  );
});

test("BeadV1 accepts an optional lengthAlongStringMm and keeps diameter mandatory", () => {
  const bead = standardAiDesignFixture.beads[0];
  assert.ok(bead);

  assert.equal(BeadV1Schema.safeParse(bead).success, true);
  assert.equal(
    BeadV1Schema.safeParse({ ...bead, lengthAlongStringMm: 8.4 }).success,
    true
  );
  assert.equal(
    BeadV1Schema.safeParse({ ...bead, lengthAlongStringMm: 0 }).success,
    false
  );

  const noDiameter = { ...bead } as { diameterMm?: number };
  delete noDiameter.diameterMm;
  assert.equal(
    BeadV1Schema.safeParse({ ...noDiameter, lengthAlongStringMm: 8.4 }).success,
    false,
    "diameterMm remains mandatory"
  );
});

test("AccessoryV1 accepts an optional lengthAlongStringMm", () => {
  const accessory = standardAiDesignFixture.accessories.find(
    (entry) => entry.placementMode === "INLINE"
  );
  assert.ok(accessory);
  assert.equal(
    AccessoryV1Schema.safeParse({ ...accessory, lengthAlongStringMm: 2 }).success,
    true
  );
  assert.equal(
    AccessoryV1Schema.safeParse({ ...accessory, lengthAlongStringMm: -0.5 }).success,
    false
  );
});

test("DesignV1 accepts beads carrying lengthAlongStringMm without breaking invariants", () => {
  const design = structuredClone(standardAiDesignFixture);
  design.beads = design.beads.map((bead, index) => ({
    ...bead,
    ...(index === 0 ? { lengthAlongStringMm: bead.diameterMm * 1.05 } : {})
  }));
  assert.equal(DesignV1Schema.safeParse(design).success, true);

  const legacyDesign = structuredClone(standardAiDesignFixture);
  assert.equal(DesignV1Schema.safeParse(legacyDesign).success, true);
});
