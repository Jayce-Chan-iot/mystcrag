import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("all active creation routes opt into the approved atelier visual world", () => {
  const surfaces = [
    ["../../../app/page.tsx", 'data-atelier-surface="home"'],
    ["../questionnaire/components/questionnaire-wizard.tsx", 'data-atelier-surface="questionnaire"'],
    ["./components/design-results.tsx", 'data-atelier-surface="design-results"'],
    ["../tarot/components/tarot-setup.tsx", 'data-atelier-surface="tarot-setup"'],
    ["../tarot/components/tarot-draw.tsx", 'data-atelier-surface="tarot-draw"'],
    ["../tarot/components/tarot-result.tsx", 'data-atelier-surface="tarot-result"'],
    ["./components/diy-editor.tsx", 'data-atelier-surface="diy-workbench"']
  ] as const;

  for (const [path, marker] of surfaces) {
    assert.match(source(path), new RegExp(marker), `${path} must use the atelier surface contract`);
  }
});

test("the global shell and placeholder pages share the atelier design system", () => {
  const layout = source("../../../app/layout.tsx");
  const globals = source("../../../app/globals.css");
  const scaffold = source("../../../components/page-scaffold.tsx");

  assert.match(layout, /data-atelier-header="true"/);
  assert.match(layout, /data-atelier-footer="true"/);
  assert.match(globals, /@import "\.\/atelier\.css"/);
  assert.match(scaffold, /data-atelier-surface="content-shell"/);
});

test("the replacement visual world has explicit desktop and mobile composition rules", () => {
  const css = source("../../../app/atelier.css");

  assert.match(css, /--atelier-ivory:/);
  assert.match(css, /\[data-atelier-surface="home"\]/);
  assert.match(css, /\[data-atelier-surface="questionnaire"\]/);
  assert.match(css, /\[data-atelier-surface="design-results"\]/);
  assert.match(css, /\[data-atelier-surface="tarot-draw"\]/);
  assert.match(css, /\[data-atelier-surface="diy-workbench"\]/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.match(
    css,
    /@media \(max-width: 767px\)[\s\S]*?\[data-tarot-setup-submit="true"\]\s*\{[^}]*position:\s*fixed/s
  );
});

test("short desktop viewports use route-specific density instead of scaling the application", () => {
  const css = source("../../../app/atelier.css");
  const tarotCss = source("../tarot/tarot.module.css");

  assert.match(css, /@media \(min-width: 768px\) and \(max-height: 800px\)/);
  assert.match(tarotCss, /@media \(min-width: 768px\) and \(max-height: 800px\)/);
  for (const surface of ["home", "questionnaire", "design-results", "tarot-setup", "tarot-draw", "tarot-result", "diy-workbench"]) {
    assert.match(css, new RegExp(`data-atelier-surface="${surface}"`));
  }
  assert.doesNotMatch(css, /(?:^|[;{]\s*)zoom\s*:/m);
  assert.doesNotMatch(css, /(?:html|body)[^{]*\{[^}]*transform:\s*scale\(/s);
});

test("the reference-accurate home and questionnaire expose the photographed composition and six-step rail", () => {
  const home = source("../../../app/page.tsx");
  const questionnaire = source("../questionnaire/components/questionnaire-wizard.tsx");

  assert.match(home, /data-reference-home-hero="true"/);
  assert.match(home, /data-reference-entry-image="true"/);
  assert.match(home, /\/home\/hero-bracelet\.webp/);
  assert.match(home, /\/home\/entry-ai\.webp/);
  assert.match(home, /\/home\/entry-tarot\.webp/);
  assert.match(home, /\/home\/entry-diy\.webp/);
  assert.doesNotMatch(home, /BraceletPreview/);
  assert.doesNotMatch(home, /function BraceletArtwork/);
  assert.match(questionnaire, /data-questionnaire-stepper="true"/);
  assert.match(questionnaire, /QUESTIONNAIRE_STEPS\.map/);
});

test("the desktop homepage keeps the hero above three creation paths in the first viewport", () => {
  const css = source("../../../app/atelier.css");
  const layout = source("../../../app/layout.tsx");

  assert.match(
    css,
    /\.home-reference-shell\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1\.35fr\)\s+minmax\(0,\s*1fr\)[^}]*height:\s*calc\(100dvh\s*-\s*3\.8125rem\)/s
  );
  assert.match(
    css,
    /\.home-reference-paths\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s
  );
  assert.doesNotMatch(css, /\.home-reference-shell\s*\{[^}]*grid-template-columns:\s*46%\s+54%/s);
  assert.match(layout, /sm:h-\[3\.75rem\]/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.home-reference-hero\s*\{[^}]*min-height:\s*min\(12\.75rem,\s*34dvh\)/);
});

test("the desktop workbench mirrors the reference catalog, tray, wrist and material regions", () => {
  const editor = source("./components/diy-editor.tsx");
  const css = source("../../../app/atelier.css");

  assert.match(editor, /data-desktop-catalog-grid="true"/);
  assert.match(editor, /data-workbench-toolrail="true"/);
  assert.match(editor, /data-tray-picker-overlay="true"/);
  assert.match(editor, /getTrayVisual\(option\.id\)\.src/);
  assert.doesNotMatch(css, /data-tray-picker-overlay[^}]+radial-gradient/s);
  assert.match(editor, /data-wrist-inspector="true"/);
  assert.match(editor, /data-material-preview-strip="true"/);
  assert.match(editor, /\u624b\u56f4\u4e0e\u5c3a\u5bf8/);
  assert.match(editor, /\u5e38\u7528\u6c34\u6676/);
});
