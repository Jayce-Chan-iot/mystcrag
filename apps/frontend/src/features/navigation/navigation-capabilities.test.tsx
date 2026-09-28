import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage, { getCreationPaths, getHeroCapabilityLabel } from "../../../app/page";
import { getMainNavigation } from "../../../app/navigation";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const DISABLED = { tarotEnabled: false, oracleEnabled: false } as const;
const TAROT_ONLY = { tarotEnabled: true, oracleEnabled: false } as const;

function withTarotFlag<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.MYSTCRAG_TAROT_ENABLED;
  try {
    if (value === undefined) delete process.env.MYSTCRAG_TAROT_ENABLED;
    else process.env.MYSTCRAG_TAROT_ENABLED = value;
    return run();
  } finally {
    if (previous === undefined) delete process.env.MYSTCRAG_TAROT_ENABLED;
    else process.env.MYSTCRAG_TAROT_ENABLED = previous;
  }
}

test("Tarot-disabled creation paths expose exactly the available destinations", () => {
  const paths = getCreationPaths(DISABLED);

  assert.deepEqual(paths.map((path) => path.id), ["ai", "diy"]);
  assert.deepEqual(paths.map((path) => path.href), ["/ai-design", "/diy"]);
  assert.ok(paths.every((path) => !path.href.includes("#")), "creation paths must not contain hash-only destinations");
});

test("Tarot-enabled creation paths add the real Tarot route without dropping the others", () => {
  const paths = getCreationPaths(TAROT_ONLY);

  assert.deepEqual(paths.map((path) => path.id), ["ai", "tarot", "diy"]);
  assert.equal(paths.find((path) => path.id === "tarot")?.href, "/tarot/setup");
});

test("Hero capability label never promises a disabled Tarot entry", () => {
  const disabled = getHeroCapabilityLabel(DISABLED);

  assert.equal(disabled, "AI 设计 · DIY 创作");
  assert.doesNotMatch(disabled, /塔罗/);
  assert.match(getHeroCapabilityLabel(TAROT_ONLY), /塔罗引导/);
});

test("main navigation drops the dead hash destination and mirrors the enabled capabilities", () => {
  const disabled = getMainNavigation(DISABLED);

  assert.deepEqual(disabled, [
    { href: "/ai-design", label: "AI 设计" },
    { href: "/diy", label: "DIY 创作" },
    { href: "/gallery", label: "作品画廊" }
  ]);
  assert.ok(disabled.every((item) => !item.href.includes("#")), "main navigation must not contain hash-only destinations");
  assert.deepEqual(getMainNavigation(TAROT_ONLY).slice(0, 3), [
    { href: "/ai-design", label: "AI 设计" },
    { href: "/tarot/setup", label: "塔罗引导" },
    { href: "/diy", label: "DIY 创作" }
  ]);
});

test("disabled homepage keeps no Tarot promise or dead hash link and reports its card count", () => {
  const markup = withTarotFlag(undefined, () => renderToStaticMarkup(<HomePage />));

  assert.doesNotMatch(markup, /塔罗/);
  assert.doesNotMatch(markup, /#inspiration/);
  assert.equal((markup.match(/data-creation-path=/g) ?? []).length, 2);
  assert.match(markup, /data-creation-count="2"/);
});

test("enabled homepage advertises Tarot and reports three cards", () => {
  const markup = withTarotFlag("true", () => renderToStaticMarkup(<HomePage />));

  assert.match(markup, /塔罗引导/);
  assert.equal((markup.match(/data-creation-path=/g) ?? []).length, 3);
  assert.match(markup, /data-creation-count="3"/);
});

test("mobile navigation exposes only real destinations", () => {
  const source = readFileSync(new URL("../../../components/mobile-bottom-nav.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /#inspiration/);
  assert.doesNotMatch(source, /grid-cols-5/);
  for (const label of ["首页", "DIY", "作品画廊", "我的"]) {
    assert.match(source, new RegExp(label));
  }
});
