import assert from "node:assert/strict";
import test from "node:test";

import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { designV1ToSceneDescriptor } from "../src/adapters/design-v1-to-scene-descriptor";
import { AdaptiveDpr } from "../src/runtime/adaptive-dpr";
import { AssetCache } from "../src/runtime/asset-cache";
import { MATERIAL_QUALITY_PROFILES, resolveMaterialQuality } from "../src/runtime/quality";
import { createSceneResourceBundle, disposeSceneResourceBundle } from "../src/react/scene-resources";

test("11. cache reuses resources and disposes them after the final release", () => {
  let disposals = 0;
  const cache = new AssetCache<{ dispose(): void }>();
  const first = cache.acquire("asset", () => ({ dispose: () => { disposals += 1; } }));
  const second = cache.acquire("asset", () => ({ dispose: () => { disposals += 10; } }));
  assert.equal(first, second);
  assert.equal(cache.size, 1);
  cache.release("asset");
  assert.equal(disposals, 0);
  cache.release("asset");
  assert.equal(disposals, 1);
  assert.equal(cache.size, 0);
});

test("11. scene resources reuse geometry/material and release on unload", () => {
  const descriptor = designV1ToSceneDescriptor(standardAiDesignFixture);
  const resources = createSceneResourceBundle(descriptor.renderItems, "MEDIUM");
  assert.ok(resources.geometries.size <= descriptor.renderItems.length);
  assert.ok(resources.materials.size <= descriptor.renderItems.length);
  disposeSceneResourceBundle(resources);
  assert.equal(resources.geometries.size, 0);
  assert.equal(resources.materials.size, 0);
});

test("12. mobile defaults and clamps to LOW while desktop defaults to MEDIUM", () => {
  assert.equal(resolveMaterialQuality(undefined, true), "LOW");
  assert.equal(resolveMaterialQuality("HIGH", true), "LOW");
  assert.equal(resolveMaterialQuality(undefined, false), "MEDIUM");
  assert.equal(resolveMaterialQuality("HIGH", false), "HIGH");
  assert.ok(MATERIAL_QUALITY_PROFILES.LOW.samples < MATERIAL_QUALITY_PROFILES.MEDIUM.samples);
  assert.ok(MATERIAL_QUALITY_PROFILES.MEDIUM.samples < MATERIAL_QUALITY_PROFILES.HIGH.samples);
  assert.ok(MATERIAL_QUALITY_PROFILES.LOW.indexOfRefraction < MATERIAL_QUALITY_PROFILES.HIGH.indexOfRefraction);
  assert.ok(MATERIAL_QUALITY_PROFILES.LOW.maxDpr < MATERIAL_QUALITY_PROFILES.HIGH.maxDpr);
});

test("adaptive DPR reduces under load and recovers within its cap", () => {
  const adaptive = new AdaptiveDpr({ minDpr: 0.75, maxDpr: 1.75 });
  assert.equal(adaptive.sample(20), 1.5);
  assert.equal(adaptive.sample(20), 1.25);
  assert.equal(adaptive.sample(60), 1.35);
  for (let index = 0; index < 20; index += 1) adaptive.sample(10);
  assert.equal(adaptive.value, 0.75);
});
