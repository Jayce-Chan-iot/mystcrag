import assert from "node:assert/strict";
import test from "node:test";

import { getBeadVisual, getTrayVisual, loadBeadVisualImage, nextBeadImagePhase } from "./visual-assets";

const coreMaterials = [
  "aquamarine-clear-v1",
  "moonstone-soft-v1",
  "clear-quartz-v1",
  "amethyst-mist-v1",
  "smoky-quartz-v1"
] as const;

test("core demo materials resolve to dedicated photographic assets without CSS filters", () => {
  const visuals = coreMaterials.map((materialKey) => getBeadVisual(materialKey));
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

const HEX = "a".repeat(64);
const APPROVED_KEY = `approved:${HEX}`;

test("a strictly valid approved key resolves to the same-origin public asset URL first", () => {
  const visual = getBeadVisual("amethyst-mist-v1", APPROVED_KEY);
  assert.equal(visual.source, "approved");
  assert.equal(visual.src, `/api/assets/${encodeURIComponent(APPROVED_KEY)}`);
  assert.equal(visual.filter, "none");
  assert.match(
    visual.fallbackSrc,
    /^\/beads\/photographic\/amethyst\.webp$/,
    "the photographic fallback stays attached to the approved visual"
  );
});

test("missing, legacy, or malformed keys never leave the photographic mapping", () => {
  const cases: readonly (string | null | undefined)[] = [
    undefined,
    null,
    "",
    "texture-legacy-001",
    "asset://something",
    "imports/session-1/processed/x/bead-512.webp",
    `approved:${"A".repeat(64)}`,
    `approved:${"g".repeat(64)}`,
    `approved:${"a".repeat(63)}`,
    `${APPROVED_KEY} `,
    `${APPROVED_KEY}/../raw.jpg`,
    `approved:${HEX}\n`
  ];
  for (const key of cases) {
    const visual = getBeadVisual("amethyst-mist-v1", key);
    assert.equal(visual.source, "photographic", `key ${String(key)} must fall back`);
    assert.match(visual.src, /^\/beads\/photographic\/amethyst\.webp$/);
    assert.equal(visual.fallbackSrc, visual.src);
  }
});

test("no approved key can be derived from a material name alone", () => {
  for (const materialKey of ["amethyst-mist-v1", "clear-quartz-v1", "approved", "approved:", "approved-0000"]) {
    const visual = getBeadVisual(materialKey);
    assert.equal(visual.source, "photographic", `${materialKey} must never resolve to an approved asset`);
    assert.ok(!visual.src.startsWith("/api/assets/"));
  }
});

test("the approved URL never embeds traversal or a non-approved payload", () => {
  const traversal = getBeadVisual("clear-quartz-v1", "approved:../../etc/passwd");
  assert.equal(traversal.source, "photographic");
  const encoded = getBeadVisual("clear-quartz-v1", APPROVED_KEY).src;
  assert.ok(encoded.startsWith("/api/assets/approved%3A"), "the colon is safely encoded");
  assert.ok(!encoded.includes(".."));
});

test("bead image phases advance once and never loop back on repeated errors", () => {
  assert.equal(nextBeadImagePhase("PRIMARY", { type: "RESET" }), "PRIMARY");
  assert.equal(nextBeadImagePhase("PRIMARY", { type: "ERROR" }), "FALLBACK");
  assert.equal(
    nextBeadImagePhase("FALLBACK", { type: "ERROR" }),
    "FALLBACK",
    "a failing fallback must not cycle back to the approved URL"
  );
  assert.equal(nextBeadImagePhase("FALLBACK", { type: "RESET" }), "PRIMARY");
});

type FakeImage = {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
};

function imageHarness(): {
  requests: string[];
  createImage: () => FakeImage;
  settle: (index: number, outcome: "ok" | "fail") => void;
} {
  const requests: string[] = [];
  const pending: FakeImage[] = [];
  return {
    requests,
    createImage() {
      const image: FakeImage = {
        src: "",
        onload: null,
        onerror: null
      };
      let current = "";
      Object.defineProperty(image, "src", {
        set(value: string) {
          current = value;
          requests.push(value);
          pending.push(image);
        },
        get() {
          return current;
        }
      });
      return image;
    },
    settle(index: number, outcome: "ok" | "fail") {
      const image = pending[index];
      assert.ok(image !== undefined, `image request ${index} must exist`);
      const handler = (outcome === "ok" ? image.onload : image.onerror) as
        | (() => void)
        | null;
      assert.ok(handler !== null, `image request ${index} needs its handler attached`);
      handler();
    }
  };
}

const EXPORT_APPROVED_URL = `/api/assets/${encodeURIComponent("approved:" + "d".repeat(64))}`;

/** The fallback attempt starts one microtask after the primary rejects. */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

test("export image loading tries the approved src first and the photographic fallback second", async () => {
  const harness = imageHarness();
  const pending = loadBeadVisualImage(
    { src: EXPORT_APPROVED_URL, fallbackSrc: "/beads/photographic/amethyst.webp" },
    { createImage: harness.createImage }
  );
  harness.settle(0, "fail");
  await flush();
  harness.settle(1, "ok");
  const image = await pending;

  assert.deepEqual(
    harness.requests,
    [EXPORT_APPROVED_URL, "/beads/photographic/amethyst.webp"],
    "the fallback request must follow the failed primary, in order"
  );
  assert.equal(image.src, "/beads/photographic/amethyst.webp");
});

test("a successful approved export load never requests the fallback", async () => {
  const harness = imageHarness();
  const pending = loadBeadVisualImage(
    { src: EXPORT_APPROVED_URL, fallbackSrc: "/beads/photographic/amethyst.webp" },
    { createImage: harness.createImage }
  );
  harness.settle(0, "ok");
  await pending;
  assert.deepEqual(harness.requests, [EXPORT_APPROVED_URL]);
});

test("a photographic primary loads once and never retries itself", async () => {
  const harness = imageHarness();
  const pending = loadBeadVisualImage(
    { src: "/beads/photographic/clear-quartz.webp", fallbackSrc: "/beads/photographic/clear-quartz.webp" },
    { createImage: harness.createImage }
  );
  harness.settle(0, "fail");
  await assert.rejects(() => pending, /导出失败/);
  assert.deepEqual(harness.requests, ["/beads/photographic/clear-quartz.webp"]);
});

test("both failures reject clearly instead of looping or swallowing", async () => {
  const harness = imageHarness();
  const pending = loadBeadVisualImage(
    { src: EXPORT_APPROVED_URL, fallbackSrc: "/beads/photographic/amethyst.webp" },
    { createImage: harness.createImage }
  );
  harness.settle(0, "fail");
  await flush();
  harness.settle(1, "fail");
  await assert.rejects(() => pending, /导出失败/);
  assert.deepEqual(harness.requests.length, 2, "exactly two attempts, no loop");
});
