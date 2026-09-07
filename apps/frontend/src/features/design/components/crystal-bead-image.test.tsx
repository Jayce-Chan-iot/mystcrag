import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CrystalBeadImage } from "./crystal-bead-image";

const HEX = "b".repeat(64);
const APPROVED_KEY = `approved:${HEX}`;

const CONSUMER_SOURCES: readonly { file: string; label: string }[] = [
  { file: "../components/bracelet-preview.tsx", label: "bracelet-preview" },
  { file: "../components/diy-editor.tsx", label: "diy-editor" },
  { file: "../components/flat-bracelet-editor.tsx", label: "flat-bracelet-editor" },
  { file: "../../gallery/components/gallery-page.tsx", label: "gallery-page" },
  { file: "../../profile/components/profile-page.tsx", label: "profile-page" },
  { file: "../../library/components/crystal-library-page.tsx", label: "crystal-library-page" }
];

function render(props: { materialKey: string; textureAssetKey?: string | null; alt?: string; sizes?: string; priority?: boolean }): string {
  return renderToStaticMarkup(
    React.createElement(CrystalBeadImage, {
      materialKey: props.materialKey,
      ...(props.textureAssetKey === undefined ? {} : { textureAssetKey: props.textureAssetKey }),
      alt: props.alt ?? "",
      ...(props.sizes === undefined ? {} : { sizes: props.sizes }),
      ...(props.priority === undefined ? {} : { priority: props.priority })
    })
  );
}

test("a valid approved key renders the same-origin public asset URL", () => {
  const html = render({ materialKey: "amethyst-mist-v1", textureAssetKey: APPROVED_KEY });
  // next/image wraps every src in its optimizer proxy; the encoded approved
  // route must be the primary source behind it.
  assert.ok(html.includes("%2Fapi%2Fassets%2Fapproved%253A"));
  assert.ok(!html.includes("%2Fbeads%2Fphotographic%2F"), "the approved visual must be primary");
});

test("a missing or legacy key renders the static photographic fallback directly", () => {
  for (const textureAssetKey of [undefined, null, "texture-legacy-001", "imports/x/bead-512.webp"]) {
    const html = render({ materialKey: "amethyst-mist-v1", textureAssetKey });
    assert.ok(
      html.includes("%2Fbeads%2Fphotographic%2Famethyst.webp"),
      `key ${String(textureAssetKey)} must fall back`
    );
    assert.ok(!html.includes("%2Fapi%2Fassets%2F"), "no approved request may be built from a legacy key");
  }
});

test("alt, sizes and priority behavior do not regress", () => {
  const html = render({ materialKey: "amethyst-mist-v1", alt: "紫水晶珠子", sizes: "96px", priority: true });
  assert.ok(html.includes('alt="紫水晶珠子"'));
  assert.ok(html.includes("96px"));
  assert.ok(html.includes("fetchPriority=\"high\""), "priority must map to fetchpriority");
  assert.ok(html.includes('data-photo-real-bead="true"'), "the photo-real marker stays");

  const plain = render({ materialKey: "amethyst-mist-v1" });
  assert.ok(!plain.includes('fetchPriority="high"'));
  assert.ok(plain.includes('aria-hidden="true"'), "an empty alt stays decorative");
});

test("every authoritative consumer forwards the DTO's textureAssetKey", () => {
  for (const { file, label } of CONSUMER_SOURCES) {
    const source = readFileSync(join(__dirname, file), "utf8");
    assert.ok(
      source.includes("textureAssetKey={"),
      `${label} must pass textureAssetKey to CrystalBeadImage or the visual resolver`
    );
  }
});

test("the gallery export resolves bead images through the same visual resolver", () => {
  const source = readFileSync(join(__dirname, "../../gallery/components/gallery-page.tsx"), "utf8");
  assert.match(
    source,
    /getBeadVisual\(\s*bead\.materialKey\s*,\s*bead\.textureAssetKey\s*\)/,
    "the exported card must prefer the approved asset exactly like the live view"
  );
});

test("the component never derives an approved key or names a backend origin", () => {
  const source = readFileSync(join(__dirname, "./crystal-bead-image.tsx"), "utf8");
  assert.ok(!source.includes("approved:`"), "no key may be assembled client-side");
  assert.ok(!/approved:\s*\$\{/.test(source), "no template may build an approved key");
  assert.ok(!source.includes("MYSTCRAG_BACKEND_ORIGIN"));
  assert.ok(!source.includes("127.0.0.1"));
  assert.ok(!source.includes("x-admin-key"));
});
