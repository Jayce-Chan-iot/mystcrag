import assert from "node:assert/strict";
import test from "node:test";

import { getBeadVisual, getTrayVisual } from "./visual-assets";

const coreMaterials = [
  "aquamarine-clear-v1",
  "moonstone-soft-v1",
  "clear-quartz-v1",
  "amethyst-mist-v1",
  "smoky-quartz-v1"
] as const;

test("core demo materials resolve to dedicated photographic assets without CSS filters", () => {
  const visuals = coreMaterials.map(getBeadVisual);
  assert.equal(new Set(visuals.map((visual) => visual.src)).size, coreMaterials.length);
  for (const visual of visuals) {
    assert.match(visual.src, /^\/beads\/photographic\/.+\.webp$/);
    assert.equal(visual.filter, "none");
  }
});

test("unknown materials use the neutral photographic fallback", () => {
  assert.deepEqual(getBeadVisual("future-material"), getBeadVisual("clear-quartz-v1"));
});

test("every display tray resolves to a real photographic surface", () => {
  const sources = ["ACRYLIC_CLEAR", "BONE_CHINA", "WOOD", "FRENCH_LINEN"].map((id) =>
    getTrayVisual(id as "ACRYLIC_CLEAR" | "BONE_CHINA" | "WOOD" | "FRENCH_LINEN").src
  );
  assert.equal(new Set(sources).size, 4);
  for (const src of sources) assert.match(src, /^\/trays\/.+\.webp$/);
});
