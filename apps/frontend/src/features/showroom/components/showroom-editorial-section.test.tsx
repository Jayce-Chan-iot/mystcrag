/**
 * TASK-COMMERCE-FE-VISUAL-001 — 编辑式内容区 (showroom-editorial-section) contract.
 *
 * The approved typography direction (benchmark §3.1/§4.4, spec §3.1) requires the
 * narrative regions to alternate work imagery, person/craft evidence and short prose
 * instead of stacking same-size cards, and to keep the reading order
 * kicker → heading → lede → alternating blocks → one action → work cards.
 *
 * These tests mount the real component and assert on rendered output. The alternation
 * geometry itself is measured in a real browser; here we pin the structure, the
 * explicit-prop contract, the single action, and the absence of any commerce signal.
 */

import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ShowroomEditorialSection,
  type ShowroomEditorialBlock,
  type ShowroomEditorialSectionProps
} from "./showroom-editorial-section";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const BLOCKS: readonly ShowroomEditorialBlock[] = [
  {
    kind: "figure",
    src: "/test-only/approved-craft.jpg",
    alt: "测试夹具：手工串制工作台的俯拍，米白台面与金属工具",
    caption: "工作现场（测试夹具）"
  },
  {
    kind: "prose",
    heading: "关于这一段（测试夹具）",
    body: "这一段说明材质、结构与作者的工作方式，只写可以核验的事实。"
  },
  {
    kind: "figure",
    src: "/test-only/approved-portrait.jpg",
    alt: "测试夹具：设计师双手与半成品手串的局部照片",
    caption: "作者与作品（测试夹具）"
  },
  {
    kind: "prose",
    body: "第二段回到作品本身，只写可核验的事实，不写产地、可持续性或工艺声明之外的承诺。"
  }
];

const SECTION: ShowroomEditorialSectionProps = {
  eyebrow: "玄圭星台 · 观星成串（测试夹具）",
  title: "设计师与系列（测试夹具）",
  lede: "先看作品，再讲故事；两个入口都在同一屏内可被发现。",
  blocks: BLOCKS,
  action: { label: "查看全部精选作品", href: "/test-only/overview" }
};

const LOCALIZED_FIXTURES = {
  "zh-CN": {
    title: "设计师与合作系列 · 玄圭星台一期精选作品与创作说明（测试夹具）",
    lede: "先看真实作品摄影，再读经人工审校的创作说明与材料结构，最后进入两个可选动作之一。"
  },
  "zh-TW": {
    title: "設計師與合作系列 · 玄圭星臺一期精選作品與創作說明（測試夾具）",
    lede: "先看真實作品攝影，再讀經人工審校的創作說明與材料結構，最後進入兩個可選動作之一。"
  },
  "en-US": {
    title: "Designers & Collections — Star Observatory series, reviewed notes and approved photography (fixture)",
    lede: "Approved work imagery first, then human-reviewed material notes, then one clear next step."
  }
} as const;

const PURCHASE_VOCABULARY = [
  /加入购物车/,
  /加入购物袋/,
  /立即购买/,
  /立即支付/,
  /去结算/,
  /结算/,
  /下单/,
  /购物车/,
  /现货/,
  /库存/,
  /售罄/,
  /送达/,
  /退货/,
  /售后/,
  /折扣/,
  /优惠/,
  /包邮/,
  /\bAdd to (cart|bag)\b/i,
  /\bBuy now\b/i,
  /\bcheckout\b/i,
  /\bIn stock\b/i,
  /\bfree shipping\b/i
];

const FORBIDDEN_CLAIMS = [
  /保证/,
  /疗效/,
  /功效/,
  /招财/,
  /转运/,
  /辟邪/,
  /\bguarantee\b/i,
  /\bhealing\b/i
];

function render(props: ShowroomEditorialSectionProps, children?: React.ReactNode): string {
  return renderToStaticMarkup(
    <ShowroomEditorialSection {...props}>
      {children ?? null}
    </ShowroomEditorialSection>
  );
}

function visibleText(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]*>/g, ""));
}

/** `next/image` and React escape text nodes; compare against the decoded string. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function authoredElements(markup: string): string[] {
  return markup
    .replace(/<img\b[^>]*\/?>/g, "")
    .match(/<[a-z]+[^>]*>/g)
    ?.filter((tag) => !tag.includes("data-nimg")) ?? [];
}

function assertAscending(markup: string, sequence: readonly string[], label: string): void {
  let previous = -1;
  for (const needle of sequence) {
    const index = markup.indexOf(needle);
    assert.ok(index >= 0, `${label} must render ${needle}`);
    assert.ok(index > previous, `${label} must keep ${needle} after the previous slot`);
    previous = index;
  }
}

test("the editorial region keeps the approved reading order", () => {
  const markup = render(SECTION);
  assertAscending(
    markup,
    [
      SECTION.eyebrow!,
      SECTION.title,
      SECTION.lede!,
      'data-showroom-editorial-block="figure"',
      "工作现场（测试夹具）",
      "这一段说明材质、结构与作者的工作方式",
      "第二段回到作品本身",
      "查看全部精选作品"
    ],
    "editorial section"
  );
});

test("the section owns one h2 heading and names itself for assistive tech", () => {
  const markup = render(SECTION);
  assert.doesNotMatch(markup, /<h1\b/, "a display region must not compete with the page h1");
  assert.equal((markup.match(/<h2\b/g) ?? []).length, 1, "exactly one section heading");

  const sectionTag = markup.match(/<section\b[^>]*>/)?.[0] ?? "";
  const labelledBy = sectionTag.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(labelledBy, "the section must be programmatically labelled");
  const headingTag = markup.match(/<h2\b[^>]*>/)?.[0] ?? "";
  assert.equal(headingTag.match(/id="([^"]+)"/)?.[1], labelledBy, "the label must reference the rendered heading id");
});

test("narrative blocks alternate figure and prose instead of stacking same-size cards", () => {
  const markup = render({ ...SECTION, action: undefined });
  const kinds = [...markup.matchAll(/data-showroom-editorial-block="(figure|prose)"/g)].map((match) => match[1]);
  assert.deepEqual(kinds, ["figure", "prose", "figure", "prose"], "blocks must keep the caller order and kind");

  assert.equal((markup.match(/<figure\b/g) ?? []).length, 2, "each figure block is a real figure");
  assert.equal((markup.match(/<figcaption\b/g) ?? []).length, 2, "each figure carries a readable caption");
  assert.equal((markup.match(/<img\b/g) ?? []).length, 2, "one frame per figure block");
  for (const block of BLOCKS.filter((entry): entry is Extract<ShowroomEditorialBlock, { kind: "figure" }> => entry.kind === "figure")) {
    assert.match(markup, new RegExp(`alt="${block.alt}"`), "figure alt text must survive verbatim");
  }
  assert.match(markup, /src="[^"]*test-only/, "the caller source must be used verbatim");

  // No block may become a card: the shared surface tone appears only on the section root.
  assert.equal((markup.match(/data-star-surface-tone=/g) ?? []).length, 1, "narrative blocks must not each get a card skin");
  assert.doesNotMatch(markup, /data-showroom-card=/, "the editorial region must not fabricate product cards");
});

test("the work-card region appears only when the caller supplies cards", () => {
  const withoutChildren = render(SECTION);
  assert.doesNotMatch(withoutChildren, /data-showroom-card-region=/, "an empty region must not be emitted");

  const withChildren = render(
    { ...SECTION, blocks: undefined },
    <span>夹具作品卡内容</span>
  );
  assert.match(withChildren, /data-showroom-card-region="true"/, "the card region must come from the section itself");
  assert.ok(
    withChildren.indexOf("data-showroom-card-region") < withChildren.indexOf("夹具作品卡内容"),
    "the caller's cards must be rendered inside the card region"
  );
  assert.ok(
    withChildren.indexOf("夹具作品卡内容") > withChildren.indexOf("查看全部精选作品"),
    "the card region must follow the narrative and its action"
  );
});

test("the editorial region carries at most one action and never a storefront route", () => {
  const withAction = render(SECTION);
  assert.equal((withAction.match(/<(a|button)\b/g) ?? []).length, 1, "the narrative region exposes one next step");
  assert.match(withAction, /<a\b[^>]*href="\/test-only\/overview"/, "the action must use the caller destination verbatim");
  assert.match(withAction, /data-star-instrument-button="secondary"/, "the action must reuse the shared instrument button");

  const withoutAction = render({ ...SECTION, action: undefined });
  assert.equal((withoutAction.match(/<(a|button)\b/g) ?? []).length, 0, "no action, no placeholder control");

  for (const route of ["/shop", "/designers", "/collections", "/cart", "/checkout", "/store", "/api"]) {
    assert.equal(withAction.includes(`href="${route}`), false, `Task 4 must not wire the storefront route ${route}`);
  }
});

test("the editorial region publishes no commercial or metaphysical claim", () => {
  const text = visibleText(render(SECTION));
  for (const pattern of [...PURCHASE_VOCABULARY, ...FORBIDDEN_CLAIMS]) {
    assert.doesNotMatch(text, pattern, `editorial copy must not imply ${pattern}`);
  }
  assert.doesNotMatch(text, /[¥$]|NT\$|\bCNY\b|\bTWD\b/, "a narrative region must not carry a price line");
});

test("long simplified, traditional and english narrative copy survives verbatim", () => {
  for (const [locale, copy] of Object.entries(LOCALIZED_FIXTURES)) {
    const markup = render({ ...SECTION, ...copy, blocks: [BLOCKS[1]!] });
    const text = visibleText(markup);
    for (const value of Object.values(copy)) {
      assert.ok(text.includes(value), `${locale} copy must be emitted in full`);
    }
    assert.doesNotMatch(markup, /truncate|line-clamp|text-ellipsis|…/, `${locale} copy must not be clipped`);
    assert.doesNotMatch(text, /undefined|\[object Object\]/, `${locale} render must not leak unset props`);
  }
});

test("the editorial region paints no texture and carries no inline style of its own", () => {
  const markup = render(SECTION);
  for (const tag of authoredElements(markup)) {
    assert.ok(!/\sstyle="/.test(tag), `authored element must not override the stylesheet: ${tag}`);
  }
  assert.doesNotMatch(markup, /url\(|background-image/, "no dirty stone texture or resident star trail may be painted");
  assert.doesNotMatch(markup, /animate-|keyframes/, "no resident animation may be attached");
  assert.doesNotMatch(markup, /<article\b/, "narrative blocks must not be card articles");
});

test("rendering the editorial region performs no I/O and leaves props untouched", () => {
  const props = structuredClone({ ...SECTION, blocks: BLOCKS.map((block) => ({ ...block })) });
  const snapshot = structuredClone({ ...SECTION, blocks: BLOCKS.map((block) => ({ ...block })) });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (() => {
      calls += 1;
      return Promise.reject(new Error("editorial region must not call the network"));
    }) as unknown as typeof fetch
  });
  try {
    assert.equal(typeof document, "undefined", "these tests run with no DOM");
    render({ ...props, blocks: props.blocks });
    assert.equal(calls, 0, "a display region must never request an API during render");
  } finally {
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: originalFetch });
  }
  assert.deepEqual(props, snapshot, "an editorial region must only read its explicit props");
});

test("the editorial module exposes presentation only — no DTO, schema or fetcher", async () => {
  const moduleKeys = Object.keys(await import("./showroom-editorial-section")).sort();
  assert.deepEqual(moduleKeys, ["ShowroomEditorialSection"], "the editorial module must not grow a second product contract");
});
