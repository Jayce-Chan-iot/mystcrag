import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PublicDesignV1Schema } from "@mystcrag/design-contract";
import { designV1ToSceneDescriptor, resolveMaterialQuality } from "@mystcrag/three-engine";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createReplaceRequest } from "../../lib/api/design-api";
import { ThreeBraceletPreview, supportsWebGl } from "./components/three-bracelet-preview";
import { mockDesignOptions } from "./fixtures/mock-design-options";

const sourceDesign = mockDesignOptions[0]!;
const componentDirectory = new URL("./components/", import.meta.url);

function designWithTwelveBeadsAndTwoAnchoredAccessories() {
  const beads = sourceDesign.beads.slice(0, 12).map((bead, positionIndex) => ({
    ...bead,
    positionIndex
  }));
  const firstAccessory = sourceDesign.accessories[0]!;
  const accessories = [
    { ...firstAccessory, componentId: "anchor-one", anchorComponentId: beads[0]!.componentId, anchorSlot: 0 },
    { ...firstAccessory, componentId: "anchor-two", anchorComponentId: beads[6]!.componentId, anchorSlot: 1 }
  ];
  const materialSubtotalMinor = beads.reduce((sum, bead) => sum + bead.unitPriceMinor, 0);
  const accessorySubtotalMinor = accessories.reduce((sum, accessory) => sum + accessory.unitPriceMinor, 0);
  const nonMaterialTotal = sourceDesign.pricing.totalPriceMinor
    - sourceDesign.pricing.materialSubtotalMinor
    - sourceDesign.pricing.accessorySubtotalMinor;

  return PublicDesignV1Schema.parse({
    ...structuredClone(sourceDesign),
    bracelet: { ...sourceDesign.bracelet, totalBeadCount: beads.length },
    beads,
    accessories,
    pricing: {
      ...sourceDesign.pricing,
      materialSubtotalMinor,
      accessorySubtotalMinor,
      totalPriceMinor: materialSubtotalMinor + accessorySubtotalMinor + nonMaterialTotal
    },
    production: {
      ...sourceDesign.production,
      componentSequence: beads.map((bead) => bead.componentId),
      anchoredComponents: accessories.map((accessory) => ({
        componentId: accessory.componentId,
        anchorComponentId: accessory.anchorComponentId,
        anchorSlot: accessory.anchorSlot
      })),
      billOfMaterials: [
        ...beads.map((bead) => ({
          productId: bead.beadProductId,
          specification: `${bead.shape} ${bead.diameterMm}mm`,
          quantity: 1,
          sourceComponentIds: [bead.componentId]
        })),
        ...accessories.map((accessory) => ({
          productId: accessory.accessoryProductId,
          specification: `${accessory.material} ${accessory.accessoryType}`,
          quantity: 1,
          sourceComponentIds: [accessory.componentId]
        }))
      ]
    }
  });
}

test("Three scene is browser-only and dynamically loaded", () => {
  const source = readFileSync(new URL("three-bracelet-preview.tsx", componentDirectory), "utf8");
  assert.match(source, /dynamic<ThreeBraceletSceneClientProps>/);
  assert.match(source, /import\("\.\/three-bracelet-scene-client"\)/);
  assert.match(source, /ssr: false/);
});

test("PublicDesignV1 mounts a deterministic 12-bead ring with two anchored accessories", () => {
  const design = designWithTwelveBeadsAndTwoAnchoredAccessories();
  const descriptor = designV1ToSceneDescriptor(design);
  assert.deepEqual(descriptor, designV1ToSceneDescriptor(structuredClone(design)));
  assert.equal(descriptor.renderItems.filter((item) => item.componentType === "BEAD").length, 12);
  assert.equal(descriptor.renderItems.filter((item) => item.placementMode === "ANCHORED").length, 2);
  assert.deepEqual(
    descriptor.renderItems.filter((item) => item.placementMode === "ANCHORED").map((item) => item.anchorComponentId),
    [design.beads[0]!.componentId, design.beads[6]!.componentId]
  );
});

test("Three hit testing maps instanceId back to stable componentId", () => {
  const source = readFileSync(new URL("../../../../../packages/three-engine/src/react/BraceletScene.tsx", import.meta.url), "utf8");
  assert.match(source, /group\.items\[event\.instanceId\]/);
  assert.match(source, /onSelect\?\.\(item\.componentId\)/);
  assert.doesNotMatch(source, /onSelect\?\.\(event\.instanceId/);
});

test("selection round-trips through componentId in the operable fallback", () => {
  const selected = sourceDesign.beads[2]!.componentId;
  const markup = renderToStaticMarkup(
    <ThreeBraceletPreview design={sourceDesign} onSelect={() => undefined} quality="MEDIUM" selectedComponentId={selected} webglAvailable={false} />
  );
  assert.match(markup, new RegExp(`data-component-id="${selected}"`));
  assert.match(markup, /aria-pressed="true"/);
});

test("replacement remains a finite REPLACE_COMPONENT operation for the Backend", () => {
  const target = sourceDesign.beads[0]!;
  const material = sourceDesign.beads.find((bead) => bead.beadProductId !== target.beadProductId)!;
  const request = createReplaceRequest(sourceDesign, target.componentId, {
    ...material,
    componentId: target.componentId,
    positionIndex: target.positionIndex,
    role: target.role
  });
  assert.equal(request.expectedRevision, sourceDesign.revision);
  assert.equal(request.operations.length, 1);
  assert.equal(request.operations[0]?.operation, "REPLACE_COMPONENT");
  assert.equal(request.operations[0]?.componentId, target.componentId);
});

test("WebGL failure is visible and keeps the bracelet selectable", () => {
  assert.equal(supportsWebGl(undefined), false);
  const markup = renderToStaticMarkup(
    <ThreeBraceletPreview design={sourceDesign} onSelect={() => undefined} quality="LOW" webglAvailable={false} />
  );
  assert.match(markup, /data-scene-fallback="WEBGL_UNAVAILABLE"/);
  assert.match(markup, /data-preview-mode="interactive"/);
});

test("invalid assets use procedural fallbacks and mobile quality is bounded", () => {
  const descriptor = designV1ToSceneDescriptor(sourceDesign, { knownAssetKeys: [] });
  assert.ok(descriptor.warnings.length > 0);
  assert.ok(descriptor.renderItems.every((item) => item.assetStatus === "FALLBACK"));
  assert.equal(resolveMaterialQuality(undefined, true), "LOW");
  assert.equal(resolveMaterialQuality("HIGH", true), "LOW");
  assert.equal(resolveMaterialQuality(undefined, false), "MEDIUM");
});

test("revision key and Three Engine cleanup preserve scene lifecycle", () => {
  const previewSource = readFileSync(new URL("three-bracelet-preview.tsx", componentDirectory), "utf8");
  const sceneSource = readFileSync(new URL("../../../../../packages/three-engine/src/react/BraceletScene.tsx", import.meta.url), "utf8");
  const canvasSource = readFileSync(new URL("../../../../../packages/three-engine/src/react/BraceletCanvas.tsx", import.meta.url), "utf8");
  assert.match(previewSource, /design\.revision/);
  assert.match(sceneSource, /disposeSceneResourceBundle\(resources\)/);
  assert.match(canvasSource, /controls\.dispose\(\)/);
  assert.match(canvasSource, /<Canvas/);
  assert.match(canvasSource, /width: "100%", height: "100%"/);
});

test("DIY keeps save, price verification, budget acceptance, and order paths", () => {
  const source = readFileSync(new URL("diy-editor.tsx", componentDirectory), "utf8");
  assert.match(source, /designApi\.price\(updateResponse\.design\)/);
  assert.match(source, /designApi\.save\(design\)/);
  assert.match(source, /hasOverBudgetAcceptance\(design\.designId\)/);
  assert.match(source, /designApi\.createOrder\(design\)/);
  assert.match(source, /<ThreeBraceletPreview/);
});

test("scene client owns no pricing or commercial mutation logic", () => {
  const source = readFileSync(new URL("three-bracelet-scene-client.tsx", componentDirectory), "utf8");
  assert.doesNotMatch(source, /pricing|totalPrice|unitPrice|priceDifference|inventory/);
});
