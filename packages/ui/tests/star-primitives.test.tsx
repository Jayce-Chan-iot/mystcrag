import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const ROOT = new URL("../", import.meta.url);

function read(rel: string): string {
  const url = new URL(rel, ROOT);
  if (!existsSync(url)) {
    assert.fail(`missing file: ${rel}`);
  }
  return readFileSync(url, "utf8");
}

function readOptional(rel: string): string | null {
  const url = new URL(rel, ROOT);
  return existsSync(url) ? readFileSync(url, "utf8") : null;
}

const REQUIRED_COLOR_TOKENS = [
  "--star-canvas",
  "--star-ink",
  "--star-paper",
  "--star-paper-muted",
  "--star-brass",
  "--star-amethyst",
  "--star-moon",
  "--star-line",
  "--star-danger",
  "--star-warning",
  "--star-success"
] as const;

const REQUIRED_METRIC_TOKENS = [
  "--star-space-1",
  "--star-space-2",
  "--star-space-3",
  "--star-space-4",
  "--star-radius-sm",
  "--star-radius-md",
  "--star-radius-lg",
  "--star-shadow-1",
  "--star-shadow-2",
  "--star-motion-fast",
  "--star-motion-base",
  "--star-motion-slow"
] as const;

function countTokenDefinitions(css: string, token: string): number {
  const pattern = new RegExp(`(?:^|[;{\\s])${token}\\s*:`, "g");
  return (css.match(pattern) ?? []).length;
}

test("required star color tokens are defined exactly once in the token source", () => {
  const css = read("../../apps/frontend/app/styles/star-tokens.css");
  for (const token of REQUIRED_COLOR_TOKENS) {
    assert.equal(
      countTokenDefinitions(css, token),
      1,
      `${token} must be defined exactly once in star-tokens.css (single source)`
    );
  }
});

test("spacing, radius, shadow and motion tokens are defined exactly once", () => {
  const css = read("../../apps/frontend/app/styles/star-tokens.css");
  for (const token of REQUIRED_METRIC_TOKENS) {
    assert.equal(
      countTokenDefinitions(css, token),
      1,
      `${token} must be defined exactly once in star-tokens.css`
    );
  }
});

test("InstrumentButton renders semantic elements for primary, secondary and quiet variants", async () => {
  const source = read("src/instrument-button.tsx");
  assert.match(source, /variant/);
  assert.match(source, /"primary"/);
  assert.match(source, /"secondary"/);
  assert.match(source, /"quiet"/);

  const { InstrumentButton } = await import("../src/instrument-button.tsx");
  for (const variant of ["primary", "secondary", "quiet"] as const) {
    const html = renderToStaticMarkup(
      <InstrumentButton variant={variant}>{`variant-${variant}`}</InstrumentButton>
    );
    assert.match(html, /<(?:button|a)\b/, `${variant} must render a semantic element`);
    assert.doesNotMatch(html, /^<div\b/, `${variant} must not render a div host`);
    assert.ok(html.includes(`variant-${variant}`), `${variant} must render its label`);
    assert.match(html, /data-star-instrument-button="(?:primary|secondary|quiet)"/);
  }
});

test("StatusPanel preserves the caller-supplied accurate role", async () => {
  const source = read("src/status-panel.tsx");
  assert.match(source, /role/);

  const { StatusPanel } = await import("../src/status-panel.tsx");

  const statusHtml = renderToStaticMarkup(
    <StatusPanel role="status" tone="info">
      ok
    </StatusPanel>
  );
  assert.match(statusHtml, /role="status"/);

  const alertHtml = renderToStaticMarkup(
    <StatusPanel role="alert" tone="danger">
      failed
    </StatusPanel>
  );
  assert.match(alertHtml, /role="alert"/);

  const regionHtml = renderToStaticMarkup(
    <StatusPanel role="region" tone="success" title="ready">
      done
    </StatusPanel>
  );
  assert.match(regionHtml, /role="region"/);
});

test("ConstellationDivider decoration is aria-hidden and non-interactive", async () => {
  const source = read("src/constellation-divider.tsx");
  assert.match(source, /aria-hidden/);

  const { ConstellationDivider } = await import("../src/constellation-divider.tsx");
  const html = renderToStaticMarkup(<ConstellationDivider />);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /tabIndex/, "divider must not be focusable");

  const css = read("../../apps/frontend/app/styles/star-components.css");
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /star-constellation/);
});

test("interactive primitives encode a 44px minimum target", () => {
  const css = read("../../apps/frontend/app/styles/star-components.css");
  assert.match(css, /2\.75rem/);

  const buttonCss = css.match(
    /\[data-star-instrument-button\][^{]*\{[^}]*min-(?:height|width)\s*:\s*2\.75rem/s
  );
  assert.ok(buttonCss, "instrument button rules must encode a 2.75rem (44px) floor");

  const statusCss =
    css.match(/\[data-star-status-panel\][\s\S]*?(?:button|a|input)[^{]*\{[^}]*min-height:\s*2\.75rem/s) ??
    css.match(/star-status[\s\S]*?(?:button|a|input)[^{]*\{[^}]*min-height:\s*2\.75rem/s);
  assert.ok(statusCss, "status panel interactive controls must encode a 44px floor");
});

test("StarSurface exposes ink, paper and lacquer tones", async () => {
  const source = read("src/star-surface.tsx");
  assert.match(source, /"ink"/);
  assert.match(source, /"paper"/);
  assert.match(source, /"lacquer"/);

  const { StarSurface } = await import("../src/star-surface.tsx");
  for (const tone of ["ink", "paper", "lacquer"] as const) {
    const html = renderToStaticMarkup(<StarSurface tone={tone}>body</StarSurface>);
    assert.match(html, new RegExp(`data-star-surface-tone="${tone}"`));
  }
});

test("primitives contain no product copy and no route imports", () => {
  for (const file of [
    "src/star-surface.tsx",
    "src/instrument-button.tsx",
    "src/constellation-divider.tsx",
    "src/status-panel.tsx",
    "src/index.ts"
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /from\s+["']next\//, `${file} must not import Next.js route modules`);
    assert.doesNotMatch(source, /href\s*[:=]\s*["']\//, `${file} must not hardcode route hrefs`);
    assert.doesNotMatch(
      source,
      /["'][^"']*(?:玄矶|Mystcrag|手串|开光|转运|治愈|招财)[^"']*["']/,
      `${file} must not embed product copy`
    );
    assert.doesNotMatch(
      source,
      /["'][^"']*(?:AI 设计|星台问卦|DIY 创作|作品画廊)[^"']*["']/,
      `${file} must not embed navigation labels`
    );
  }
});

test("decorative vectors avoid occult, medical and pseudo-text motifs", () => {
  const source = read("src/constellation-divider.tsx");
  assert.doesNotMatch(source, /pentagram|hexagram|sigil|talisman|zodiac/i);
  assert.doesNotMatch(source, /<text[\s\S]*?>[^<]*[一-鿿]/, "no pseudo-CJK glyph labels inside decoration");
  assert.match(source, /circle|line|path|rect|polyline/i);
});

test("package test script uses tsx and discovers TSX suites", () => {
  const pkg = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.ok(pkg.scripts?.test, "package.json must define a test script");
  assert.match(pkg.scripts.test, /\btsx\b/);
  assert.match(pkg.scripts.test, /tests\/\*\.test\.tsx|tests\/star-primitives\.test\.tsx/);
  assert.ok(pkg.devDependencies?.tsx, "tsx must be a development dependency of @mystcrag/ui");

  assert.ok(existsSync(new URL("tests/star-primitives.test.tsx", ROOT)));
  const nested = readOptional("tests/star-primitives.test.tsx");
  assert.ok(nested && nested.includes("star"), "the TSX suite must be loadable source");
});
