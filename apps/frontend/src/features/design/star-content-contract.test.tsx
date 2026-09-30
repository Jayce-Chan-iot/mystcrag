import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(rel: string): string {
  const url = new URL(rel, import.meta.url);
  if (!existsSync(url)) {
    assert.fail(`missing file: ${rel}`);
  }
  return readFileSync(url, "utf8");
}

const CONTENT_SOURCES = {
  library: "../../../src/features/library/components/crystal-library-page.tsx",
  gallery: "../../../src/features/gallery/components/gallery-page.tsx",
  profile: "../../../src/features/profile/components/profile-page.tsx",
  designDetail: "../../../app/design/[id]/page.tsx",
  starContent: "../../../app/styles/star-content.css",
  libraryModel: "../../../src/features/library/model/library-model.ts",
  galleryModel: "../../../src/features/gallery/model/gallery-model.ts",
  profileModel: "../../../src/features/profile/model/profile-model.ts"
} as const;

test("every content route root declares data-star-surface", () => {
  for (const [name, rel] of Object.entries(CONTENT_SOURCES)) {
    if (name === "starContent" || name.endsWith("Model")) continue;
    const text = source(rel);
    assert.match(
      text,
      /data-star-surface=/,
      `${name} must declare a data-star-surface route root`
    );
  }
  assert.match(source(CONTENT_SOURCES.library), /data-star-surface="library"/);
  assert.match(source(CONTENT_SOURCES.gallery), /data-star-surface="gallery"/);
  assert.match(source(CONTENT_SOURCES.profile), /data-star-surface="profile"/);
});

test("content pages never render the PageScaffold placeholder", () => {
  for (const rel of [
    CONTENT_SOURCES.library,
    CONTENT_SOURCES.gallery,
    CONTENT_SOURCES.profile,
    CONTENT_SOURCES.designDetail
  ]) {
    const text = source(rel);
    assert.doesNotMatch(text, /PageScaffold/, `${rel} must not use the PageScaffold placeholder`);
    assert.doesNotMatch(
      text,
      /工程骨架已就绪/,
      `${rel} must not render the scaffold placeholder copy`
    );
  }
});

test("filters keep persistent visible labels instead of placeholder-only cues", () => {
  const library = source(CONTENT_SOURCES.library);
  const gallery = source(CONTENT_SOURCES.gallery);

  // Filter sections must carry persistent visible labels (not only sr-only).
  assert.match(library, /data-star-filter-label=/, "library filter labels must be marked");
  assert.match(gallery, /data-star-filter-label=/, "gallery filter labels must be marked");

  // Search fields keep a real accessible name plus a persistent cue.
  assert.match(library, /data-star-filter-field="search"/);
  assert.match(gallery, /data-star-filter-field="search"/);
});

test("zero-stock items report truthfulness as text marks, not color alone", () => {
  const library = source(CONTENT_SOURCES.library);
  const libraryModel = source(CONTENT_SOURCES.libraryModel);

  assert.match(libraryModel, /stockStatusLabel/, "library model must expose a stock text label");
  assert.match(library, /data-stock-mark=/, "library cards must carry a stock text mark");
  assert.match(library, /需补货|有库存/);
});

test("private/public state marks use text, not color alone", () => {
  const gallery = source(CONTENT_SOURCES.gallery);
  const galleryModel = source(CONTENT_SOURCES.galleryModel);
  const profile = source(CONTENT_SOURCES.profile);

  assert.match(galleryModel, /visibilityLabelFor/, "gallery model must expose visibility text");
  assert.match(galleryModel, /"私密"/, "visibility model returns the private text mark");
  assert.match(galleryModel, /"公开"/, "visibility model returns the public text mark");
  assert.match(gallery, /data-visibility-mark=/, "gallery cards must carry a visibility text mark");
  assert.match(gallery, /visibilityLabelFor/, "gallery must render visibility text from the model");
  assert.match(profile, /data-visibility-mark=|visibilityLabelFor/, "profile must surface visibility text");
});

test("profile query tabs resolve the workbench deep links", () => {
  const profile = source(CONTENT_SOURCES.profile);
  const profileModel = source(CONTENT_SOURCES.profileModel);

  assert.match(profileModel, /resolveProfileTab/, "profile model must resolve tab query values");
  assert.match(profile, /resolveProfileTab/, "profile page must call resolveProfileTab");
  assert.match(profile, /tab=|searchParams|location\.search/, "profile must read the tab query");
});

test("cards keep photographic bead images without CSS recoloring", () => {
  const starContent = source(CONTENT_SOURCES.starContent);
  for (const rel of [CONTENT_SOURCES.library, CONTENT_SOURCES.gallery, CONTENT_SOURCES.profile]) {
    assert.match(source(rel), /CrystalBeadImage/, `${rel} must use CrystalBeadImage for product photos`);
  }
  assert.doesNotMatch(
    starContent,
    /data-photo-real-bead[^}]*\{[^}]*(?:filter|mix-blend|background-blend)/s,
    "star-content must not tint photographic bead images"
  );
  assert.doesNotMatch(
    starContent,
    /\[data-star-content-card\][^{]*\{[^}]*(?:filter:\s*hue|filter:\s*sepia|filter:\s*saturate)/s,
    "content cards must not recolor product imagery"
  );
});

test("empty and no-result states expose a real recovery action", () => {
  for (const [name, rel] of [
    ["library", CONTENT_SOURCES.library],
    ["gallery", CONTENT_SOURCES.gallery],
    ["profile", CONTENT_SOURCES.profile]
  ] as const) {
    const text = source(rel);
    assert.match(text, /data-star-empty/, `${name} must mark empty states`);
    assert.match(text, /data-star-recovery/, `${name} empty/no-result states must expose recovery`);
  }
});

test("content grammar keeps 44px targets, scoping, and reduced-motion safety", () => {
  const css = source(CONTENT_SOURCES.starContent);

  assert.match(css, /\[data-star-surface/, "star-content rules stay scoped to data-star-surface");
  assert.match(css, /min-height:\s*2\.75rem|min-width:\s*2\.75rem|44px/, "content controls keep the 44px floor");
  assert.doesNotMatch(css, /(?:^|[;{]\s*)zoom\s*:/m, "star-content must not use zoom");
  assert.doesNotMatch(
    css,
    /(?:html|body)[^{]*\{[^}]*transform:\s*scale\(/s,
    "star-content must not scale html/body"
  );
});

test("content pages avoid AI-gradient, glassmorphism, and prohibited claim copy", () => {
  const bannedUi = [
    /backdrop-filter:\s*blur/i,
    /linear-gradient\([^)]*purple/i,
    /linear-gradient\([^)]*#a855f7/i,
    /glass(?:morph)?/i
  ];
  const bannedCopy = [
    /转运/,
    /招财/,
    /发财/,
    /保平安/,
    /辟邪/,
    /开光/,
    /加持/,
    /治愈/,
    /疗愈/,
    /命定/,
    /注定/,
    /一定让你/,
    /必定/,

    /大师/,
    /功效/,
    /疗效/
  ];

  for (const rel of [
    CONTENT_SOURCES.library,
    CONTENT_SOURCES.gallery,
    CONTENT_SOURCES.profile,
    CONTENT_SOURCES.designDetail,
    CONTENT_SOURCES.starContent
  ]) {
    const text = source(rel);
    for (const pattern of bannedUi) {
      assert.doesNotMatch(text, pattern, `${rel} must avoid AI/glass decorative treatments`);
    }
    for (const pattern of bannedCopy) {
      assert.doesNotMatch(text, pattern, `${rel} must avoid prohibited claim copy`);
    }
  }
});

test("visible content copy avoids em-dash filler and status stays text-bearing", () => {
  for (const rel of [
    CONTENT_SOURCES.library,
    CONTENT_SOURCES.gallery,
    CONTENT_SOURCES.profile
  ]) {
    const text = source(rel)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // JSX text nodes and string literals should not introduce —— as filler copy.
    assert.doesNotMatch(text, /——/, `${rel} must avoid em-dash filler in visible copy`);
    assert.doesNotMatch(text, /—(?!>)/, `${rel} must avoid single em-dash filler`);
  }

  const gallery = source(CONTENT_SOURCES.gallery);
  assert.match(gallery, /data-status-mark=/, "gallery status marks must be explicit text marks");
  const profile = source(CONTENT_SOURCES.profile);
  assert.match(profile, /data-status-mark=|ORDER_STATUS_PRESENTATION/, "profile status stays text-bearing");
});
