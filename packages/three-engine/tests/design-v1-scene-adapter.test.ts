import assert from "node:assert/strict";
import test from "node:test";

import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { designV1ToSceneDescriptor } from "../src/adapters/design-v1-to-scene-descriptor";
import { replacePreviewComponent } from "../src/interactions/replace-preview";

test("1. main ring follows DesignV1 and production order", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  const mainRing = descriptor.renderItems
    .filter((item) => item.placementMode === "INLINE")
    .map((item) => item.componentId);
  assert.deepEqual(mainRing, standardAiDesignFixture.production.componentSequence);
});

test("2. different bead diameters affect radial offset and angular layout", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  const aquamarine = descriptor.renderItems.find((item) => item.componentId === "bead-aquamarine-1")!;
  const moonstone = descriptor.renderItems.find((item) => item.componentId === "bead-moonstone-1")!;
  const quartz = descriptor.renderItems.find((item) => item.componentId === "bead-quartz-1")!;
  assert.equal(aquamarine.transform.radialOffsetMm, 4);
  assert.equal(moonstone.transform.radialOffsetMm, 3);
  assert.equal(quartz.transform.radialOffsetMm, 5);
  assert.notEqual(
    Math.atan2(moonstone.transform.position.y, moonstone.transform.position.x),
    Math.atan2(quartz.transform.position.y, quartz.transform.position.x)
  );
});

test("3. INLINE accessory occupies its production position", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  const spacer = descriptor.renderItems.find((item) => item.componentId === "accessory-spacer-1")!;
  assert.equal(spacer.placementMode, "INLINE");
  assert.equal(spacer.sequenceIndex, 1);
  assert.equal(spacer.geometry.kind, "CYLINDER");
});

test("4-5. ANCHORED pendant follows anchorComponentId", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  const pendant = descriptor.renderItems.find((item) => item.componentId === "accessory-pendant-1")!;
  const anchor = descriptor.renderItems.find((item) => item.componentId === pendant.anchorComponentId)!;
  assert.equal(pendant.placementMode, "ANCHORED");
  assert.equal(pendant.anchorComponentId, "accessory-spacer-1");
  assert.equal(pendant.accessoryType, "PENDANT");
  assert.ok(Math.hypot(pendant.transform.position.x, pendant.transform.position.y) > Math.hypot(anchor.transform.position.x, anchor.transform.position.y));
});

test("6. componentId is the stable one-to-one scene identity", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  assert.deepEqual(
    new Set(descriptor.renderItems.map((item) => item.componentId)),
    new Set([
      ...standardAiDesignFixture.beads.map((bead) => bead.componentId),
      ...standardAiDesignFixture.accessories.map((accessory) => accessory.componentId)
    ])
  );
  assert.equal(descriptor.renderItems.every((item) => item.interactionState.selectable), true);
  assert.equal(descriptor.renderItems.every((item) => !item.interactionState.draggable), true);
});

test("7. preview replacement preserves identity and relayouts the ring and pendant", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  const oldTarget = descriptor.renderItems.find((item) => item.componentId === "bead-aquamarine-1")!;
  const oldPendant = descriptor.renderItems.find((item) => item.componentId === "accessory-pendant-1")!;
  const replaced = replacePreviewComponent(descriptor, "bead-aquamarine-1", {
    materialKey: "large-preview",
    geometryKey: "sphere-14",
    geometry: { kind: "SPHERE", diameterMm: 14 }
  });
  const target = replaced.renderItems.find((item) => item.componentId === "bead-aquamarine-1")!;
  const pendant = replaced.renderItems.find((item) => item.componentId === "accessory-pendant-1")!;
  assert.equal(target.componentId, oldTarget.componentId);
  assert.equal(target.transform.radialOffsetMm, 7);
  assert.notDeepEqual(target.transform.position, oldTarget.transform.position);
  assert.notDeepEqual(pendant.transform.position, oldPendant.transform.position);
  assert.deepEqual(
    replaced.renderItems.filter((item) => item.placementMode === "INLINE").map((item) => item.componentId),
    standardAiDesignFixture.production.componentSequence
  );
});

test("8. adapter and replacement do not mutate their inputs", () => {
  const design = structuredClone(standardAiDesignFixture);
  const originalDesign = structuredClone(design);
  const descriptor = designV1ToSceneDescriptor(design);
  const originalDescriptor = structuredClone(descriptor);
  replacePreviewComponent(descriptor, "bead-moonstone-1", {
    materialKey: "preview",
    geometryKey: "sphere-8",
    geometry: { kind: "SPHERE", diameterMm: 8 }
  });
  assert.deepEqual(design, originalDesign);
  assert.deepEqual(descriptor, originalDescriptor);
});

test("9. descriptor is deterministic, serializable, and preserves revision", () => {
  const first = designV1ToSceneDescriptor(standardAiDesignFixture);
  const second = designV1ToSceneDescriptor(standardAiDesignFixture);
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(first.revision, standardAiDesignFixture.revision);
});

test("10. invalid assets receive warnings and procedural fallback", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture, { knownAssetKeys: [] });
  assert.ok(descriptor.warnings.length > 0);
  assert.equal(descriptor.warnings[0]?.code, "ASSET_NOT_FOUND");
  assert.equal(descriptor.renderItems.every((item) => item.assetStatus === "FALLBACK"), true);
  assert.equal(descriptor.renderItems.every((item) => item.geometry.kind.length > 0), true);
});

test("13. production componentSequence stays consistent after preview changes", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  const replaced = replacePreviewComponent(descriptor, "bead-quartz-1", {
    materialKey: "preview-quartz",
    geometryKey: "preview-quartz-6",
    geometry: { kind: "SPHERE", diameterMm: 6 }
  });
  assert.deepEqual(
    replaced.renderItems.filter((item) => item.placementMode === "INLINE").map((item) => item.componentId),
    standardAiDesignFixture.production.componentSequence
  );
});
