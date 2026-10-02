/**
 * TASK-FE-STAR-005 — real-browser remediation contracts.
 *
 * `TASK-QA-STAR-001` measured the customer routes in a real browser and filed nine
 * failures (`docs/progress/2026-09-26_STAR_PLATFORM_UI_QA_REPORT.md` §7). The measured
 * pixels stay owned by `scripts/ui-qa/capture_star_platform.py --validate`; this file
 * pins the structural seams that make those measurements hold, so a regression cannot
 * silently return through a different component:
 *
 * - DEV-1 — 12px accent/muted micro-copy is cut for one background only, so each star
 *   surface must resolve its own readable kicker/micro text token, and the legacy
 *   `--accent` alias plus home's already-passing lacquer hero must stay untouched.
 * - DEV-2 — the profile continue preview row is rem-sized, so at 200% text resize it has
 *   to wrap and shrink inside its card instead of widening the document.
 * - DEV-3 — the gallery card list children must be keyed by `designId`, or React mounts
 *   a dev error overlay on `/gallery`.
 *
 * Each contract fails on the QA candidate `c3967e4` for the recorded defect.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as galleryPage from "../gallery/components/gallery-page";
import type { GalleryEntry } from "../gallery/model/gallery-model";
import * as profilePage from "../profile/components/profile-page";
import { mockDesignOptions } from "./fixtures/mock-design-options";

const SOURCES = {
  acquisition: "../../../app/styles/star-acquisition.css",
  workbench: "../../../app/styles/star-workbench.css",
  content: "../../../app/styles/star-content.css",
  tokens: "../../../app/styles/star-tokens.css",
  globals: "../../../app/globals.css",
  oracleStyles: "../../../src/features/oracle/oracle.module.css",
  questionnaire: "../../../src/features/questionnaire/components/questionnaire-wizard.tsx",
  designResults: "../../../src/features/design/components/design-results.tsx",
  diyEditor: "../../../src/features/design/components/diy-editor.tsx",
  library: "../../../src/features/library/components/crystal-library-page.tsx",
  gallery: "../../../src/features/gallery/components/gallery-page.tsx",
  profile: "../../../src/features/profile/components/profile-page.tsx",
  tarot: "../../../src/features/tarot/components/tarot-setup.tsx"
} as const;

function source(rel: string): string {
  const url = new URL(rel, import.meta.url);
  if (!existsSync(url)) assert.fail(`missing file: ${rel}`);
  return readFileSync(url, "utf8");
}

// ---------------------------------------------------------------------------
// A minimal CSS reader: comments stripped, then top-level rule blocks with their
// selector list and declarations. `@media`/`@supports` blocks are skipped whole,
// because the readable-token layer lives outside conditional groups.
// ---------------------------------------------------------------------------

type CssRule = { selectors: string[]; declarations: Map<string, string> };

function cssRules(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open < 0) break;
    const prelude = text.slice(cursor, open).trim();
    let depth = 1;
    let end = open + 1;
    while (end < text.length && depth > 0) {
      const char = text[end];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      end += 1;
    }
    if (!prelude.startsWith("@")) {
      const declarations = new Map<string, string>();
      for (const entry of text.slice(open + 1, end - 1).split(";")) {
        const separator = entry.indexOf(":");
        if (separator < 0) continue;
        const prop = entry.slice(0, separator).trim();
        const value = entry.slice(separator + 1).trim();
        if (prop) declarations.set(prop, value);
      }
      rules.push({
        selectors: prelude.split(",").map((selector) => selector.trim()).filter(Boolean),
        declarations
      });
    }
    cursor = end;
  }
  return rules;
}

function surfaceSet(rule: CssRule): string[] {
  const surfaces: string[] = [];
  for (const selector of rule.selectors) {
    const match = /\[data-star-surface="([a-z-]+)"\](?![\w-])/.exec(selector);
    if (!match) return [];
    surfaces.push(match[1] ?? "");
  }
  return surfaces;
}

function tokenDeclarations(file: string, token: string): { surfaces: string[]; value: string }[] {
  return cssRules(source(file))
    .filter((rule) => rule.declarations.has(token))
    .map((rule) => ({ surfaces: surfaceSet(rule), value: rule.declarations.get(token) ?? "" }))
    .filter((entry) => entry.surfaces.length > 0);
}

const PAPER_SURFACES = ["questionnaire", "tarot-setup", "library", "gallery", "diy-workbench"] as const;
const LACQUER_SURFACES = ["oracle-setup", "oracle-result", "design-results"] as const;

function tokenValueFor(surface: string, token: string): string {
  for (const file of [SOURCES.acquisition, SOURCES.content, SOURCES.workbench]) {
    const match = tokenDeclarations(file, token).find((entry) => entry.surfaces.includes(surface));
    if (match) return match.value;
  }
  return "";
}

// ---------------------------------------------------------------------------
// DEV-1 — surface-aware readable micro-copy tokens
// ---------------------------------------------------------------------------

test("each page-family stylesheet resolves readable micro-copy per star surface", () => {
  for (const [label, file] of [
    ["star-acquisition.css", SOURCES.acquisition],
    ["star-content.css", SOURCES.content],
    ["star-workbench.css", SOURCES.workbench]
  ] as const) {
    const kicker = tokenDeclarations(file, "--star-kicker-text");
    const micro = tokenDeclarations(file, "--star-micro-text");
    assert.ok(kicker.length > 0, `${label} must resolve --star-kicker-text on [data-star-surface] groups`);
    assert.ok(micro.length > 0, `${label} must resolve --star-micro-text on [data-star-surface] groups`);
    for (const entry of [...kicker, ...micro]) {
      assert.ok(
        entry.surfaces.length > 0,
        `${label} micro-copy tokens must be scoped to star surfaces, not declared on :root`
      );
    }
  }

  const covered = new Set<string>();
  for (const file of [SOURCES.acquisition, SOURCES.content, SOURCES.workbench]) {
    for (const entry of tokenDeclarations(file, "--star-kicker-text")) {
      for (const surface of entry.surfaces) covered.add(surface);
    }
  }
  for (const surface of [...PAPER_SURFACES, ...LACQUER_SURFACES]) {
    assert.ok(covered.has(surface), `surface "${surface}" must resolve --star-kicker-text`);
  }
});

test("paper and lacquer surfaces resolve different kicker cuts, both still brass", () => {
  const paper = [...new Set(PAPER_SURFACES.map((surface) => tokenValueFor(surface, "--star-kicker-text")))];
  const lacquer = [...new Set(LACQUER_SURFACES.map((surface) => tokenValueFor(surface, "--star-kicker-text")))];
  assert.equal(paper.length, 1, `宣纸 surfaces disagree on --star-kicker-text: ${JSON.stringify(paper)}`);
  assert.equal(lacquer.length, 1, `漆夜 surfaces disagree on --star-kicker-text: ${JSON.stringify(lacquer)}`);
  assert.ok(paper[0], "every 宣纸 surface must resolve --star-kicker-text");
  assert.ok(lacquer[0], "every 漆夜 surface must resolve --star-kicker-text");
  assert.notEqual(paper[0], lacquer[0], "--star-kicker-text must resolve per background, not once globally");
  for (const [label, value] of [["宣纸", paper[0] ?? ""], ["漆夜", lacquer[0] ?? ""]] as const) {
    assert.match(value, /var\(--star-brass/, `${label}: the readable kicker must stay inside the brass family`);
    assert.doesNotMatch(value, /var\(--star-(ink|canvas)\)\s*$/, `${label}: the readable kicker must not collapse to plain ink`);
  }
  const micro = tokenValueFor("diy-workbench", "--star-micro-text");
  assert.ok(micro, "the workbench rail must resolve --star-micro-text for 12px counters");
  assert.doesNotMatch(micro, /^var\(--muted\)$/, "--star-micro-text must not alias the legacy muted value");
});

test("the lacquer opening bands carry readable display type, not inherited ink", () => {
  // The gate reports one worst target per route, so a headline that is dark-on-dark stays
  // hidden behind a failing kicker. Both bands are therefore pinned here.
  for (const token of ["--star-heading-text", "--star-lede-text"]) {
    const values = LACQUER_SURFACES.map((surface) => tokenValueFor(surface, token));
    assert.ok(values.every(Boolean), `${token} must resolve on the 漆夜 opening bands`);
    for (const value of values) {
      assert.doesNotMatch(
        value,
        /var\(--star-(ink|canvas)\)\s*$/,
        `${token} must not fall back to 墨 on a night-lacquer band`
      );
    }
  }

  const oracleRules = cssRules(source(SOURCES.oracleStyles));
  for (const className of [".oracleTitle", ".oracleLede"]) {
    const rule = oracleRules.find((candidate) => candidate.selectors.some((s) => s.includes(className)));
    assert.ok(rule, `${className} must keep its own rule`);
    assert.match(
      rule?.declarations.get("color") ?? "",
      /var\(--star-(heading|lede)-text\)/,
      `${className} must take its colour from the band token`
    );
  }

  const resultsHeading = cssRules(source(SOURCES.acquisition)).find((rule) =>
    rule.selectors.some((s) => s.includes('[data-star-surface="design-results"]') && s.includes("header h1"))
  );
  assert.ok(resultsHeading, "the results header headline needs an explicit band rule");
  assert.match(resultsHeading?.declarations.get("color") ?? "", /var\(--star-heading-text\)/);
});

test("DEV-1 micro-copy sites bind the surface token instead of the legacy alias", () => {
  // One entry per browser-measured failure: the element is identified by the copy it
  // renders, so a renamed utility class cannot make the contract silently pass.
  const sites = [
    ["ai-design eyebrow", SOURCES.questionnaire, /className="([^"]*)"[^>]*>\{step\.eyebrow\}/],
    ["tarot setup eyebrow", SOURCES.tarot, /className="([^"]*)">塔罗水晶引导/],
    ["design detail kicker", SOURCES.designResults, /className="([^"]*)">AI Design ·/],
    ["diy catalog counter", SOURCES.diyEditor, /className="([^"]*)">\{materialOptions\.length\}/],
    ["library kicker", SOURCES.library, /className="([^"]*)"[^>]*data-star-content-kicker="true">Crystal Library/],
    ["gallery kicker", SOURCES.gallery, /className="([^"]*)"[^>]*data-star-content-kicker="true">Gallery/]
  ] as const;

  for (const [label, file, pattern] of sites) {
    const matched = pattern.exec(source(file));
    assert.ok(matched, `${label}: the measured micro-copy element must still be locatable in ${file}`);
    const className = matched?.[1] ?? "";
    assert.match(
      className,
      /text-\[var\(--star-(kicker|micro)-text\)\]/,
      `${label} must take its colour from the surface-scoped readable token`
    );
    assert.doesNotMatch(
      className,
      /text-\[var\(--(accent|muted)\)\]/,
      `${label} must not paint 12px copy with the surface-blind --accent/--muted alias`
    );
  }

  const eyebrowRule = cssRules(source(SOURCES.oracleStyles)).find((rule) =>
    rule.selectors.some((selector) => selector.includes(".oracleEyebrow"))
  );
  assert.ok(eyebrowRule, "the oracle eyebrow must keep its own rule");
  const eyebrowColor = eyebrowRule?.declarations.get("color") ?? "";
  assert.match(eyebrowColor, /var\(--star-kicker-text/, "the oracle eyebrow must use the surface-scoped token");
});

test("the rejected global fixes stay rejected: --accent alias and home lacquer", () => {
  for (const file of [SOURCES.tokens, SOURCES.globals]) {
    assert.match(
      source(file),
      /--accent:\s*var\(--star-brass\)/,
      `${file}: --accent must remain the brass alias, so admin and legacy surfaces are unaffected`
    );
  }
  for (const file of [SOURCES.acquisition, SOURCES.content, SOURCES.workbench]) {
    assert.doesNotMatch(
      cssRules(source(file)).filter((rule) => rule.selectors.includes(":root")).map((rule) => rule.selectors.join()).join(),
      /--accent/,
      `${file} must not redefine the legacy accent alias`
    );
  }

  const homeKicker = cssRules(source(SOURCES.acquisition)).find(
    (rule) => rule.declarations.has("color") && rule.selectors.some((s) => /\[data-star-surface="home"\]\s*\[data-star-kicker\]/.test(s))
  );
  assert.ok(homeKicker, 'the home "[data-star-kicker]" rule must stay in place');
  assert.match(
    homeKicker?.declarations.get("color") ?? "",
    /var\(--star-brass\)/,
    "home's lacquer hero kicker already passes at 5.8:1 and must keep its brass value"
  );
});

// ---------------------------------------------------------------------------
// DEV-2 — /profile at 200% text resize
// ---------------------------------------------------------------------------

function galleryEntry(index: number): GalleryEntry {
  const design = mockDesignOptions[index] as PublicDesignV1;
  return {
    design: { ...design, revision: 7 } as PublicDesignV1,
    status: index === 0 ? "SAVED" : "DRAFT",
    updatedAt: "2026-09-30T08:12:00.000Z"
  };
}

/**
 * The opening tag of the element that directly wraps the first bead of the row the
 * browser measured (`h-9 w-9` inside the continue preview). Read out of rendered
 * markup, so it describes what the production card actually mounts.
 */
function beadRowTag(markup: string, beadClass: string): { tag: string; classes: string[] } {
  const pattern = new RegExp(`<([a-z]+) class="([^"]*)">\\s*<span class="[^"]*\\b${beadClass}\\b`);
  const matched = pattern.exec(markup);
  assert.ok(matched, `the mounted profile card must render a ${beadClass} bead row`);
  return { tag: matched?.[1] ?? "", classes: (matched?.[2] ?? "").split(/\s+/).filter(Boolean) };
}

test("the profile preview row wraps and shrinks instead of widening the document", () => {
  const Continue = profilePage.ProfileContinueCard;
  assert.equal(typeof Continue, "function", "ProfileContinueCard must stay exported");
  const markup = renderToStaticMarkup(React.createElement(Continue, { entry: galleryEntry(0) }));

  const row = beadRowTag(markup, "h-9");
  assert.ok(row.classes.includes("flex-wrap"), "the rem-sized bead row must wrap at 200% text size");
  assert.ok(row.classes.includes("min-w-0"), "the bead row must be allowed to shrink into its container");
  assert.ok(
    /<span class="[^"]*shrink-0[^"]*h-9 w-9/.test(markup),
    "every bead keeps shrink-0 so wrapping never squashes or hides a bead"
  );

  const card = /<article class="([^"]*)"/.exec(markup);
  assert.ok(card, "the continue card must mount its article");
  assert.ok((card?.[1] ?? "").split(/\s+/).includes("min-w-0"), "the card must shrink with its grid column");
  assert.match(markup, /h-9 w-9/, "bead thumbnails stay rem-sized so they follow the user's text scale");
});

test("the profile layout stays honest: no zoom, scale or text-size hacks", () => {
  for (const file of [SOURCES.profile, SOURCES.content]) {
    const text = source(file);
    assert.doesNotMatch(text, /(^|[\s{;])zoom\s*:/m, `${file} must not resize with CSS zoom`);
    assert.doesNotMatch(text, /text-size-adjust/, `${file} must not suppress the browser's text scaling`);
    assert.doesNotMatch(
      text,
      /transform:\s*scale\(|html\s*\{\s*font-size/,
      `${file} must not fake 200% text resize with a transform or a root font override`
    );
  }
});

// ---------------------------------------------------------------------------
// DEV-3 — /gallery stable list keys
// ---------------------------------------------------------------------------

function cardActions(): Record<string, unknown> {
  return {
    onArmDelete: () => {},
    onClone: () => {},
    onConfirmDelete: () => {},
    onExport: () => {},
    onToggleMenu: () => {}
  };
}

function cardElements(count: number): React.ReactElement[] {
  const render = galleryPage.renderGalleryCard as unknown as
    | ((
        entry: GalleryEntry,
        isFeatured: boolean,
        view: Record<string, unknown>,
        actions: Record<string, unknown>
      ) => React.ReactElement)
    | undefined;
  assert.equal(typeof render, "function", "GalleryPage must expose one keyed card factory for its list");
  const view = { busyDesignId: null, deleteArmedId: null, menuOpenId: null };
  return Array.from({ length: count }, (_, index) => render!(galleryEntry(index), index === 0, view, cardActions()));
}

function keyWarnings(children: React.ReactElement[]): string[] {
  const warnings: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    renderToStaticMarkup(React.createElement("div", null, children));
  } finally {
    console.error = original;
  }
  return warnings.filter((warning) => /unique "key" prop/.test(warning));
}

test("the gallery card factory keys every list child by designId", () => {
  const entries = [galleryEntry(0), galleryEntry(1), galleryEntry(2)];
  const rendered = cardElements(entries.length);
  const expected = entries.map((entry) => entry.design.designId);
  assert.deepEqual(
    rendered.map((element) => element.key),
    expected,
    "each card must be keyed by its own designId so a filtered re-render cannot reuse another card"
  );
  assert.equal(new Set(rendered.map((element) => element.key)).size, rendered.length, "keys must be unique");
  assert.ok(
    rendered.every((element) => !/^\d+$/.test(String(element.key))),
    "keys must be stable identities, not render positions"
  );

  const gallerySource = source(SOURCES.gallery);
  const callSites = gallerySource.match(/<GalleryDesignCard\b/g) ?? [];
  assert.equal(callSites.length, 1, "the gallery list must mount through exactly one card call site");
  assert.match(
    gallerySource.slice(gallerySource.indexOf("<GalleryDesignCard"), gallerySource.indexOf("<GalleryDesignCard") + 700),
    /\bkey=\{/,
    "that call site must declare the key where the element is created"
  );
});

test("the gallery card list mounts without the React key warning that raised the dev overlay", () => {
  assert.equal(
    keyWarnings(cardElements(3)).length,
    0,
    "featured plus remaining cards must mount with no missing-key warning"
  );

  // Control: the same probe must notice an unkeyed list, otherwise this assertion is vacuous.
  const unkeyed = cardElements(3).map((element) =>
    React.createElement(
      element.type as React.ComponentType<Record<string, unknown>>,
      element.props as Record<string, unknown>
    )
  );
  assert.ok(
    keyWarnings(unkeyed).length > 0,
    "the key-warning probe itself must detect a missing key before it can certify one is absent"
  );
});
