import assert from "node:assert/strict";
import test from "node:test";

import {
  DISPLAY_TRAY_OPTIONS,
  displayTrayCanvasPalette,
  displayTrayStorageKey,
  isPointOutsideTray,
  loadDisplayTray,
  saveDisplayTray
} from "./display-tray";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };
}

test("display trays expose the four approved scene materials and default to bone china", () => {
  assert.deepEqual(
    DISPLAY_TRAY_OPTIONS.map(({ id, label }) => [id, label]),
    [
      ["ACRYLIC_CLEAR", "透明亚克力"],
      ["BONE_CHINA", "米白骨瓷"],
      ["WOOD", "原木"],
      ["FRENCH_LINEN", "法式亚麻"]
    ]
  );
  assert.equal(loadDisplayTray("design-a", memoryStorage()), "BONE_CHINA");
});

test("display tray preference is isolated per design and rejects unknown stored values", () => {
  const storage = memoryStorage();
  saveDisplayTray("design-a", "WOOD", storage);
  saveDisplayTray("design-b", "ACRYLIC_CLEAR", storage);

  assert.equal(storage.getItem(displayTrayStorageKey("design-a")), "WOOD");
  assert.equal(loadDisplayTray("design-a", storage), "WOOD");
  assert.equal(loadDisplayTray("design-b", storage), "ACRYLIC_CLEAR");

  storage.setItem(displayTrayStorageKey("design-a"), "UNKNOWN");
  assert.equal(loadDisplayTray("design-a", storage), "BONE_CHINA");
});

test("tray boundary treats the visible circular rim as inside and only removes beyond it", () => {
  const rect = { height: 400, width: 400 };
  assert.equal(isPointOutsideTray({ x: 200, y: 200 }, rect), false);
  assert.equal(isPointOutsideTray({ x: 388, y: 200 }, rect), false);
  assert.equal(isPointOutsideTray({ x: 389, y: 200 }, rect), true);
  assert.equal(isPointOutsideTray({ x: 12, y: 200 }, rect), false);
  assert.equal(isPointOutsideTray({ x: 11, y: 200 }, rect), true);
});

test("each display tray has an export-safe canvas palette", () => {
  const palettes = DISPLAY_TRAY_OPTIONS.map(({ id }) => displayTrayCanvasPalette(id));
  assert.equal(new Set(palettes.map(({ surface }) => surface)).size, 4);
  for (const palette of palettes) {
    assert.match(palette.surface, /^#[0-9a-f]{6}$/i);
    assert.match(palette.rim, /^#[0-9a-f]{6}$/i);
  }
});
