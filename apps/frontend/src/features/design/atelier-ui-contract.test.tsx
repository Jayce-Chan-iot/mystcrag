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
  assert.match(css, /@media \(min-width: 1024px\) and \(max-height: 640px\)/);
  assert.match(tarotCss, /@media \(min-width: 768px\) and \(max-height: 800px\)/);
  for (const surface of ["home", "questionnaire", "design-results", "tarot-setup", "tarot-draw", "tarot-result", "diy-workbench"]) {
    assert.match(css, new RegExp(`data-atelier-surface="${surface}"`));
  }
  assert.doesNotMatch(css, /(?:^|[;{]\s*)zoom\s*:/m);
  assert.doesNotMatch(css, /(?:html|body)[^{]*\{[^}]*transform:\s*scale\(/s);

  const shortWorkbenchRule = css.match(
    /@media \(min-width: 1024px\) and \(max-height: 640px\)\s*\{[\s\S]*?\n\}/
  )?.[0];
  assert.ok(shortWorkbenchRule, "diy workbench must declare a 1024x640 density rule");
  assert.match(shortWorkbenchRule, /data-atelier-surface="diy-workbench"/);
  assert.doesNotMatch(shortWorkbenchRule, /zoom\s*:/);
  assert.doesNotMatch(shortWorkbenchRule, /transform:\s*scale\(/);
  assert.doesNotMatch(shortWorkbenchRule, /data-atelier-surface="(home|questionnaire|design-results|tarot-setup|tarot-draw|tarot-result)"/);
});

test("the reference-accurate home and questionnaire expose the photographed composition and six-step rail", () => {
  const home = source("../../../app/page.tsx");
  const questionnaire = source("../questionnaire/components/questionnaire-wizard.tsx");

  assert.match(home, /data-reference-home-hero="true"/);
  assert.match(home, /data-reference-entry-image="true"/);
  assert.match(home, /\/home\/hero-bracelet\.webp/);
  assert.match(home, /\/home\/entry-ai\.webp/);
  assert.match(home, /\/home\/entry-tarot\.webp/);
  assert.match(home, /\/home\/entry-diy-loose-tray\.webp/);
  assert.doesNotMatch(home, /BraceletPreview/);
  assert.doesNotMatch(home, /function BraceletArtwork/);
  assert.match(questionnaire, /data-questionnaire-stepper="true"/);
  assert.match(questionnaire, /QUESTIONNAIRE_STEPS\.map/);
});

test("the homepage uses framed media, separated creation cards and motion-safe feedback", () => {
  const home = source("../../../app/page.tsx");
  const css = source("../../../app/atelier.css");

  assert.match(home, /image:\s*"\/home\/entry-diy-loose-tray\.webp"/);
  assert.match(home, /尚未穿线的散珠/);
  assert.match(home, /className="home-reference-hero-media"/);
  assert.doesNotMatch(home, /image:\s*"\/home\/entry-diy\.webp"/);
  assert.match(css, /\.home-reference-shell\s*\{[^}]*padding:\s*clamp\(/s);
  assert.doesNotMatch(css, /\.home-reference-shell\s*\{[^}]*height:\s*calc\(100dvh/s);
  assert.match(css, /\.home-reference-hero\s*\{[^}]*border-radius:\s*1\.5rem/s);
  assert.match(css, /\.home-reference-paths\s*\{[^}]*gap:\s*clamp\([^;]*1\.5rem/s);
  assert.match(css, /\.home-reference-card-link\s*\{[^}]*border-radius:\s*1\.5rem/s);
  assert.match(css, /\.home-reference-card-link:is\(:hover,\s*:focus-visible\)[^{]*\{[^}]*transform:\s*translateY\(-4px\)\s+scale\(1\.025\)/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.home-reference-card-link[^}]*transition:\s*none/s);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.home-reference-paths\s*\{[^}]*grid-template-columns:\s*1fr/s);
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
  assert.match(editor, /\u6210\u54c1\u624b\u56f4\u4e0e\u5c3a\u5bf8/);
  assert.match(editor, /<WearFitSummary/);
  assert.doesNotMatch(editor, /\u9884\u8ba1\u9002\u914d\u624b\u56f4|\u5f53\u524d\u7ec4\u5408\u957f\u5ea6/);
  assert.match(editor, /\u6536\u7f29\u6210\u4e32/);
  assert.match(editor, /\u6563\u5f00\u5230\u6258\u76d8/);
  assert.doesNotMatch(editor, /\u5e38\u7528\u6c34\u6676/);
  assert.doesNotMatch(editor, /\u5df2\u9009\u6c34\u6676/);
  assert.doesNotMatch(editor, /\u270e/);
});

test("desktop keeps one catalog product collection and drops the duplicate bead shelf", () => {
  const editor = source("./components/diy-editor.tsx");

  assert.equal((editor.match(/data-desktop-catalog-grid="true"/g) ?? []).length, 1);
  assert.doesNotMatch(editor, /data-material-preview-strip/);
  assert.doesNotMatch(editor, /\u5df2\u9009\u7528\u7684\u73e0\u5b50/);
  assert.doesNotMatch(editor, /desktop-material-shelf-title/);
  assert.doesNotMatch(editor, /grid-rows-\[minmax\(0,1fr\)_11\.25rem\]/);
  assert.match(editor, /grid-cols-\[22\.5rem_minmax\(0,1fr\)_14\.5rem\]/);
});

test("toolrail destinations are real actions or profile links, never dead buttons", () => {
  const editor = source("./components/diy-editor.tsx");

  assert.match(editor, /aria-current="page"[\s\S]*?\u6c34\u6676\u5e93[\s\S]*?<\/span>/);
  assert.doesNotMatch(editor, /<button[^>]*aria-current="page"/);
  assert.doesNotMatch(editor, /\["\u5386\u53f2\u65b9\u6848", false\]/);
  assert.doesNotMatch(editor, /\["\u6211\u7684\u6536\u85cf", false\]/);
  assert.match(editor, /href="\/profile\?tab=designs"/);
  assert.match(editor, /href="\/profile\?tab=favorites"/);
  assert.match(editor, /\u642d\u914d\u63a8\u8350/);
  assert.match(editor, /data-workbench-toolrail="true"[\s\S]*?void loadSuggestions\(\)/);
  assert.match(editor, /data-workbench-toolrail="true"[\s\S]*?href="\/profile\?tab=designs"/);
  assert.match(editor, /data-workbench-toolrail="true"[\s\S]*?href="\/profile\?tab=favorites"/);
});

test("desktop inspector scrolls internally and keeps price/clear/complete sticky at the bottom", () => {
  const editor = source("./components/diy-editor.tsx");

  assert.match(editor, /data-desktop-inspector="true"/);
  assert.match(editor, /data-desktop-inspector-footer="true"/);
  assert.match(editor, /sticky bottom-0/);
  const inspectorTag = editor.match(/<aside\b[^>]*data-desktop-inspector="true"[^>]*>/)?.[0]
    ?? editor.match(/<aside\b[^>]*data-desktop-inspector="true"/)?.[0];
  assert.ok(inspectorTag, "desktop inspector aside must be present");
  assert.match(inspectorTag, /overflow-y-auto/);
  const footerTag = editor.match(/<div\b[^>]*data-desktop-inspector-footer="true"[^>]*>/)?.[0]
    ?? editor.match(/<div\b[^>]*data-desktop-inspector-footer="true"/)?.[0];
  assert.ok(footerTag, "desktop inspector footer must be present");
  assert.match(footerTag, /sticky bottom-0/);
  assert.match(editor, /\u6e05\u7a7a\u8bbe\u8ba1/);
  assert.match(editor, /\u5b8c\u6210\u8bbe\u8ba1/);
});

test("workbench notices live in a dedicated status region outside stage control collision", () => {
  const editor = source("./components/diy-editor.tsx");

  assert.match(editor, /data-workbench-status-region="true"/);
  assert.match(editor, /data-workbench-status-region="true"[\s\S]*?data-workbench-announcer="true"/);
  assert.match(editor, /data-workbench-announcer="true"[^>]*aria-live="polite"|aria-live="polite"[^>]*data-workbench-announcer="true"/);
  const statusRegionTag = editor.match(/<div\b[^>]*data-workbench-status-region="true"[^>]*>/)?.[0];
  assert.ok(statusRegionTag, "dedicated workbench status region must be present");
  assert.doesNotMatch(statusRegionTag, /aria-live=/);
  assert.doesNotMatch(editor, /absolute left-8 right-8 top-4 z-40/);
  assert.doesNotMatch(editor, /absolute left-8 right-8 top-4 z-30/);
  assert.doesNotMatch(editor, /absolute left-8 top-4 z-30 rounded-full/);
});
