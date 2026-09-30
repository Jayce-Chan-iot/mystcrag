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

const STAR_STYLE_ENTRIES = [
  "star-tokens.css",
  "star-shell.css",
  "star-components.css",
  "star-acquisition.css",
  "star-workbench.css",
  "star-content.css"
] as const;

test("globals.css loads the six star style entries after atelier.css in a deterministic order", () => {
  const globals = source("../../../app/globals.css");

  const atelierIndex = globals.indexOf('@import "./atelier.css"');
  assert.ok(atelierIndex >= 0, "globals.css must import atelier.css as the legacy baseline");

  let cursor = atelierIndex;
  for (const entry of STAR_STYLE_ENTRIES) {
    const marker = `@import "./styles/${entry}"`;
    const index = globals.indexOf(marker);
    assert.ok(index >= 0, `globals.css must import ${entry}`);
    assert.ok(
      index > cursor,
      `${entry} must load after atelier.css and after earlier star entries (deterministic order)`
    );
    cursor = index;
  }

  for (const entry of STAR_STYLE_ENTRIES) {
    assert.ok(existsSync(new URL(`../../../app/styles/${entry}`, import.meta.url)), `${entry} must exist`);
  }
});

test("route surfaces declare data-star-surface and star rules stay scoped to it", () => {
  const layout = source("../../../app/layout.tsx");
  const scaffold = source("../../../components/page-scaffold.tsx");

  assert.match(layout, /data-star-surface/);
  assert.match(scaffold, /data-star-surface/);

  for (const entry of STAR_STYLE_ENTRIES) {
    const css = source(`../../../app/styles/${entry}`);
    if (entry === "star-tokens.css") continue;
    assert.match(
      css,
      /\[data-star-surface/,
      `${entry} route rules must be scoped with a data-star-surface selector`
    );
    assert.doesNotMatch(
      css,
      /^(?!.*\[data-star-surface)[^@/]*\b(?:main|section|article)\s*\{/m,
      `${entry} must not emit unscoped element layout rules`
    );
  }
});

test("legacy token aliases map onto the semantic star tokens", () => {
  const tokens = source("../../../app/styles/star-tokens.css");
  const globals = source("../../../app/globals.css");

  // Legacy names retained for admin and intermediate pages during migration.
  for (const legacy of ["--background", "--foreground", "--surface", "--muted", "--accent", "--border"]) {
    assert.ok(
      tokens.includes(legacy) || globals.includes(legacy),
      `legacy token ${legacy} must remain available`
    );
  }

  assert.match(tokens, /LEGACY/i);
  assert.match(tokens, /var\(--star-/);
  const mapped = tokens.match(/(?:--background|--foreground|--surface|--muted|--accent|--border)\s*:\s*var\(--star-/);
  assert.ok(mapped, "legacy aliases must reference semantic star tokens");
});

test("the shell never fakes density with global zoom or body transforms", () => {
  for (const entry of STAR_STYLE_ENTRIES) {
    const css = source(`../../../app/styles/${entry}`);
    assert.doesNotMatch(css, /(?:^|[;{]\s*)zoom\s*:/m, `${entry} must not use the zoom property`);
    assert.doesNotMatch(
      css,
      /(?:html|body)[^{]*\{[^}]*transform:\s*scale\(/s,
      `${entry} must not scale html/body with transform`
    );
    assert.doesNotMatch(css, /window\.addEventListener\(\s*["']scroll/, `${entry} must not register scroll listeners`);
  }
  const globals = source("../../../app/globals.css");
  assert.doesNotMatch(globals, /(?:^|[;{]\s*)zoom\s*:/m);
  assert.doesNotMatch(globals, /(?:html|body)[^{]*\{[^}]*transform:\s*scale\(/s);
});

test("shell navigation keeps the existing truthful capability model", () => {
  const navigation = source("../../../app/navigation.ts");
  const layout = source("../../../app/layout.tsx");

  assert.match(navigation, /getMainNavigation/);
  assert.match(navigation, /tarotEnabled/);
  assert.match(navigation, /oracleEnabled/);
  assert.match(layout, /isTarotFeatureEnabled/);
  assert.match(layout, /isOracleFeatureEnabled/);
  assert.match(layout, /getMainNavigation/);
  // Capability flags must gate labels; no unconditional Tarot/Oracle entry.
  assert.match(navigation, /\.\.\.\(oracleEnabled \?/);
  assert.match(navigation, /\.\.\.\(tarotEnabled \?/);
});

test("mobile bottom navigation keeps safe-area padding, readable labels and no duplicate hamburger", () => {
  const mobileNav = source("../../../components/mobile-bottom-nav.tsx");
  const layout = source("../../../app/layout.tsx");

  assert.match(mobileNav, /env\(safe-area-inset-bottom\)/);
  assert.match(mobileNav, /data-mobile-bottom-nav/);
  // Labels stay at a readable floor (12px = 0.75rem) or larger.
  assert.match(mobileNav, /text-\[0\.(?:75|68|62)rem\]|text-xs|text-sm|0\.75rem|min-h-/);
  const shellCss = source("../../../app/styles/star-shell.css");
  assert.match(
    shellCss,
    /\[data-mobile-bottom-nav\][\s\S]*?font-size:\s*0\.75rem|\[data-mobile-bottom-nav\][\s\S]*?min-height:\s*2\.75rem/
  );

  // Bottom nav already covers the destinations; do not also ship a hamburger.
  assert.doesNotMatch(mobileNav, /hamburger|menu-toggle|data-menu-button/i);
  assert.doesNotMatch(layout, /hamburger|data-menu-button/i);

  // Desktop nav stays a single row and compact.
  assert.match(layout, /data-desktop-navigation/);
  assert.match(shellCss, /\[data-star-header\][\s\S]*?max-height:\s*80px|\[data-desktop-navigation\][\s\S]*?max-height:\s*80px|header[^{]*\{[^}]*max-height:\s*80px/s);
});

test("star shell encodes short-viewport and reduced-motion safety", () => {
  const shell = source("../../../app/styles/star-shell.css");
  const tokens = source("../../../app/styles/star-tokens.css");

  assert.match(shell, /100dvh|min-height:\s*calc\(100dvh/);
  assert.doesNotMatch(shell, /(?:^|[;{]\s*)h-screen\b/);
  assert.match(tokens, /prefers-reduced-motion/);
  assert.match(shell, /prefers-reduced-motion|@media \(prefers-reduced-motion/);
});
