import assert from "node:assert/strict";
import test from "node:test";

import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { designV1ToSceneDescriptor } from "../src/adapters/design-v1-to-scene-descriptor";

test("beads and INLINE accessories follow main-ring order", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  assert.deepEqual(
    descriptor.renderItems.slice(0, 4).map((item) => item.componentId),
    standardAiDesignFixture.production.componentSequence
  );
});

test("ANCHORED pendant preserves its render anchor", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  const pendant = descriptor.renderItems.find(
    (item) => item.componentId === "accessory-pendant-1"
  );
  assert.equal(pendant?.anchorComponentId, "accessory-spacer-1");
  assert.equal(pendant?.transform.position.z, -2);
});

test("different bead diameters create different radial offsets", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  const aquamarine = descriptor.renderItems.find(
    (item) => item.componentId === "bead-aquamarine-1"
  );
  const moonstone = descriptor.renderItems.find(
    (item) => item.componentId === "bead-moonstone-1"
  );
  assert.equal(aquamarine?.transform.radialOffsetMm, 4);
  assert.equal(moonstone?.transform.radialOffsetMm, 3);
});

test("component IDs remain stable", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  assert.deepEqual(
    new Set(descriptor.renderItems.map((item) => item.componentId)),
    new Set([
      ...standardAiDesignFixture.beads.map((bead) => bead.componentId),
      ...standardAiDesignFixture.accessories.map((accessory) => accessory.componentId)
    ])
  );
});

test("design revision is preserved", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  assert.equal(descriptor.revision, standardAiDesignFixture.revision);
});

test("unavailable asset keys produce structured warnings", () => {
  const knownAssetKeys = [
    ...standardAiDesignFixture.beads.flatMap((bead) => [
      bead.modelAssetKey,
      bead.textureAssetKey
    ]),
    ...standardAiDesignFixture.accessories.flatMap((accessory) => [
      accessory.modelAssetKey,
      accessory.textureAssetKey
    ])
  ].filter(
    (assetKey): assetKey is string =>
      assetKey !== undefined && assetKey !== standardAiDesignFixture.beads[0]!.modelAssetKey
  );
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture, { knownAssetKeys });
  assert.equal(descriptor.warnings.length > 0, true);
  assert.equal(descriptor.warnings[0]?.code, "ASSET_NOT_FOUND");
});

test("scene conversion does not modify DesignV1", () => {
  const input = structuredClone(standardAiDesignFixture);
  const original = structuredClone(input);
  designV1ToSceneDescriptor(input);
  assert.deepEqual(input, original);
});

test("scene conversion is deterministic", () => {
  assert.deepEqual(
    designV1ToSceneDescriptor(standardAiDesignFixture),
    designV1ToSceneDescriptor(standardAiDesignFixture)
  );
});

test("scene descriptor contains plain serializable data and no Three.js instances", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  const serialized = JSON.stringify(descriptor);
  assert.deepEqual(JSON.parse(serialized), descriptor);
  assert.equal(serialized.includes("isMaterial"), false);
  assert.equal(serialized.includes("isVector3"), false);
});

test("fixture scene order agrees with production componentSequence", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  const mainRingIds = descriptor.renderItems
    .filter((item) => item.anchorComponentId === undefined)
    .map((item) => item.componentId);
  assert.deepEqual(mainRingIds, standardAiDesignFixture.production.componentSequence);
});
