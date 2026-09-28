import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("primary navigation and notice actions retain at least 44px targets", () => {
  const layout = source("../../../app/layout.tsx");
  const mobileNavigation = source("../../../components/mobile-bottom-nav.tsx");
  const flowNotice = source("../../../src/components/flow-notice.tsx");

  assert.match(layout, /data-atelier-header="true"[\s\S]*?min-h-11/);
  assert.match(layout, /data-desktop-navigation="true"[\s\S]*?min-h-11/);
  assert.match(mobileNavigation, /data-mobile-bottom-nav="true"[\s\S]*?min-h-\[3\.4rem\]/);
  assert.match(flowNotice, /ACTION_CLASS\s*=\s*"[^"]*min-h-11/);
});

test("catalog, tray and completion controls have a route-local 44px floor", () => {
  const globals = source("../../../app/globals.css");
  const css = source("../../../app/atelier.css");

  assert.match(css, /data-workbench-toolrail="true"/);
  assert.match(css, /data-desktop-catalog-grid="true"/);
  assert.match(css, /data-tray-picker-overlay="true"/);
  assert.match(css, /data-desktop-inspector-footer="true"/);
  assert.match(css, /data-atelier-surface="diy-workbench"[^\n]*:is\(button, a, input, select, summary\)[^{]*\{[^}]*min-height:\s*2\.75rem/s);
  assert.match(css, /aria-label="桌面珠子分类"[^\n]*button[^{]*\{[^}]*min-height:\s*2\.75rem/s);
  assert.match(css, /data-atelier-surface="tarot-setup"[^\n]*input\[type="number"\][\s\S]*?min-height:\s*2\.75rem/);
  assert.match(css, /data-atelier-surface="tarot-setup"[^\n]*details\s*>\s*summary[\s\S]*?min-height:\s*2\.75rem/);
  assert.match(css, /data-atelier-surface="tarot-setup"[^\n]*select[^{]*\{[^}]*min-height:\s*2\.75rem/s);
  assert.match(globals, /data-library-page="ready"[^\n]*:is\(button, a, select, summary\)[^{]*\{[^}]*min-height:\s*2\.75rem/s);
  assert.match(globals, /data-library-filters[^\n]*label[^{]*\{[^}]*min-height:\s*2\.75rem/s);
});

test("critical mobile and workbench labels use at least a 12px readable floor", () => {
  const globals = source("../../../app/globals.css");
  const css = source("../../../app/atelier.css");

  assert.match(globals, /data-mobile-bottom-nav="true"[^\n]*a[^{]*\{[^}]*font-size:\s*0\.75rem/s);
  assert.match(css, /data-workbench-toolrail="true"[\s\S]*?font-size:\s*0\.75rem/);
  assert.match(css, /data-desktop-catalog-grid="true"[\s\S]*?font-size:\s*0\.75rem/);
  assert.match(css, /data-tray-picker-overlay="true"[\s\S]*?font-size:\s*0\.75rem/);
  assert.match(css, /data-catalog-sheet-state[\s\S]*?font-size:\s*0\.75rem/);
  assert.match(css, /data-questionnaire-stepper="true"[\s\S]*?font-size:\s*0\.75rem/);
  assert.match(css, /data-atelier-surface="questionnaire"[^\n]*section\s*>\s*p:first-child[^{]*\{[^}]*font-size:\s*0\.75rem/s);
  assert.match(css, /aria-label="桌面珠子分类"[^\n]*button[^{]*\{[^}]*font-size:\s*0\.75rem/s);
  assert.match(css, /data-compliance-status[^\n]*small[^{]*\{[^}]*font-size:\s*0\.75rem/s);
  assert.match(css, /data-tarot-safety-note="true"[^{]*\{[^}]*font-size:\s*0\.75rem/s);
  assert.match(css, /data-tarot-setup-panel="theme"[^\n]*label:last-child[^{]*\{[^}]*font-size:\s*0\.75rem/s);
  assert.match(css, /home-reference-hero-copy\s*>\s*p[^{]*\{[^}]*font-size:\s*0\.75rem/s);
  assert.match(css, /home-reference-hero-copy\s*>\s*span[^{]*\{[^}]*font-size:\s*clamp\(0\.75rem,/s);
  assert.match(css, /home-reference-entry-copy[\s\S]*?font-size:\s*(?:clamp\()?0\.75rem/);
  for (const page of ["profile", "gallery", "library"]) {
    assert.match(globals, new RegExp(`data-${page}-page="ready"[\\s\\S]*?font-size:\\s*0\\.75rem`));
  }
});

test("focus visibility and reduced motion remain explicit global contracts", () => {
  const globals = source("../../../app/globals.css");
  const css = source("../../../app/atelier.css");

  assert.match(globals, /:focus-visible\s*\{[^}]*outline:\s*2px solid/s);
  assert.doesNotMatch(globals, /:focus-visible\s*\{[^}]*outline:\s*(?:0|none)/s);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(globals, /animation-duration:\s*0\.01ms !important/);
});
