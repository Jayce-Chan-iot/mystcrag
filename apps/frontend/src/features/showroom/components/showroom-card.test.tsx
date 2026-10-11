/**
 * TASK-COMMERCE-FE-VISUAL-001 — 商品展示卡 (showroom-card) presentation contract.
 *
 * Phase 1 Task 4 owns display components that never touch the commerce API. These
 * tests mount the real production component through `react-dom/server` and assert on
 * the rendered output: the approved reading slots in order, one whole-card semantic
 * link, honest handling of absent photography, absent rows instead of invented
 * placeholders, verbatim three-locale copy and a zero-I/O render.
 *
 * Every fixture string is test-only data: never approved product copy, never a real
 * 无野 price, never reachable from a public runtime. Geometry (44 px floor, image
 * ratio, overflow, reduced motion, focus) is measured in a real browser, not here.
 */

import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SHOWROOM_CARD_VISUAL_PENDING_LABEL,
  ShowroomCard,
  type ShowroomCardProps
} from "./showroom-card";

// `"jsx": "preserve"` makes tsx emit the classic runtime, so the @mystcrag/ui
// primitives need a React global. Same shim as star-system-states.test.tsx.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

const FULL_CARD: ShowroomCardProps = {
  name: "月白叠霜（测试夹具）",
  credit: "无野 · 玄圭星台一期（测试夹具）",
  material: "12 mm 冰种石英 · 黄铜隔珠（测试夹具）",
  price: "¥1,280",
  region: "仅可展示于中国大陆",
  availability: "暂未开放线上购买",
  visual: {
    src: "/test-only/approved-work.jpg",
    alt: "测试夹具：单圈手串平铺于米白台面，十二毫米浅色珠与一枚金属隔珠"
  },
  // Only a caller-supplied destination; Task 4 wires no storefront route.
  href: "/test-only/work"
};

const ENCODED_FIXTURE_SRC = "%2Ftest-only%2Fapproved-work.jpg";

const LOCALIZED_FIXTURES = {
  "zh-CN": {
    name: "月白叠霜 · 玄圭星台一期手工串制十二毫米冰种与黄铜隔珠限定款（测试夹具）",
    credit: "设计师无野 · 合作系列「观星成串」第一段创作说明与材料署名（测试夹具）",
    availability: "本作品目前仅在中国大陆地区经核准展示，暂未开放线上购买"
  },
  "zh-TW": {
    name: "月白疊霜 · 玄圭星臺一期手工串製十二毫米冰種與黃銅隔珠限定款（測試夾具）",
    credit: "設計師無野 · 合作系列「觀星成串」第一段創作說明與材料署名（測試夾具）",
    availability: "本作品目前僅在中國大陸地區經核准展示，暫未開放線上購買"
  },
  "en-US": {
    name: "Moon Frost No.1 — hand-strung 12 mm icy quartz with brass spacers, limited observatory edition (fixture)",
    credit: "Designer Wuye · Star Observatory series, first creative note and material credit (fixture)",
    availability: "Approved for display in China mainland only; online purchase is not open yet"
  }
} as const;

const PURCHASE_VOCABULARY = [
  /加入购物车/,
  /加入购物袋/,
  /添加到购物车/,
  /立即购买/,
  /立即支付/,
  /去结算/,
  /结算/,
  /下单/,
  /有货/,
  /现货/,
  /库存/,
  /售罄/,
  /预计送达/,
  /送达/,
  /退货/,
  /售后/,
  /折扣/,
  /优惠/,
  /包邮/,
  /\bAdd to (cart|bag)\b/i,
  /\bBuy now\b/i,
  /\bcheckout\b/i,
  /\bpre-?order\b/i,
  /\bIn stock\b/i,
  /\bSold out\b/i,
  /\bDelivered in\b/i,
  /\bfree shipping\b/i
];

const FORBIDDEN_CLAIMS = [
  /保证/,
  /疗效/,
  /功效/,
  /招财/,
  /转运/,
  /辟邪/,
  /命中注定/,
  /\bguarantee\b/i,
  /\bhealing\b/i
];

const SLOT_ORDER = ["name", "credit", "material", "price", "availability"] as const;

function render(props: ShowroomCardProps): string {
  return renderToStaticMarkup(<ShowroomCard {...props} />);
}

function visibleText(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]*>/g, ""));
}

/** `next/image` and React escape text/attributes; compare against the decoded string. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function controlTags(markup: string): Array<{ tag: string; attrs: string }> {
  const found: Array<{ tag: string; attrs: string }> = [];
  for (const match of markup.matchAll(/<(a|button)\b([^>]*)>/g)) {
    found.push({ tag: match[1] as string, attrs: match[2] as string });
  }
  return found;
}

/** Author markup only: `next/image` legitimately adds its own inline layout style. */
function authoredElements(markup: string): string[] {
  return markup
    .replace(/<img\b[^>]*\/?>/g, "")
    .match(/<[a-z]+[^>]*>/g)
    ?.filter((tag) => !tag.includes("data-nimg")) ?? [];
}

function without(props: ShowroomCardProps, ...keys: Array<keyof ShowroomCardProps>): ShowroomCardProps {
  const copy = { ...props } as Record<string, unknown>;
  for (const key of keys) {
    delete copy[key];
  }
  return copy as ShowroomCardProps;
}

function withFetchSentry(body: () => void): void {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const probe = (() => {
    calls += 1;
    return Promise.reject(new Error("showroom display components must not call the network"));
  }) as unknown as typeof fetch;
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: probe });
  try {
    assert.equal(typeof document, "undefined", "these tests run with no DOM, so no browser global may be required");
    assert.equal(typeof window, "undefined", "these tests run with no DOM, so no browser global may be required");
    body();
    assert.equal(calls, 0, "a display card must never request an API during render");
  } finally {
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: originalFetch });
  }
}

test("a fully specified card renders the approved display slots in reading order", () => {
  const markup = render(FULL_CARD);
  const frameIndex = markup.indexOf(ENCODED_FIXTURE_SRC);
  assert.ok(frameIndex > 0, "the approved frame must be the first painted content");

  let previous = frameIndex;
  for (const slot of SLOT_ORDER) {
    const index = markup.indexOf(`data-showroom-card-slot="${slot}"`);
    assert.ok(index > 0, `card must render the ${slot} slot`);
    assert.ok(index > previous, `card must keep ${slot} after the previous display slot`);
    previous = index;
  }

  // Region is an explicit display line and must never be inferred from interface language.
  const priceIndex = markup.indexOf('data-showroom-card-price="true"');
  const marketIndex = markup.indexOf('data-showroom-card-market="true"');
  assert.ok(priceIndex > 0, "the price line must carry its own measured span");
  assert.ok(marketIndex > priceIndex, "region must read after the region price line");

  const text = visibleText(markup);
  for (const value of [
    FULL_CARD.name,
    FULL_CARD.credit,
    FULL_CARD.material!,
    FULL_CARD.price!,
    FULL_CARD.region!,
    FULL_CARD.availability!
  ]) {
    assert.ok(text.includes(value), `the ${value} line must be emitted verbatim`);
  }
});

test("a card exposes one whole-card semantic link and no other control", () => {
  const controls = controlTags(render(FULL_CARD));
  assert.equal(controls.length, 1, "the card must expose exactly one interactive destination");
  assert.equal(controls[0]!.tag, "a", "the single card control must be a link");
  assert.match(controls[0]!.attrs, new RegExp(`href="${FULL_CARD.href}"`), "the link must use the caller destination verbatim");
  assert.match(controls[0]!.attrs, /aria-label="/, "a whole-card link needs an accessible name");
  assert.doesNotMatch(controls[0]!.attrs, /tabindex=/, "the card link must stay in natural tab order");
});

test("a card with no destination renders no link and no purchase affordance", () => {
  const markup = render(without(FULL_CARD, "href"));
  assert.equal(controlTags(markup).length, 0, "an unlinkable card must not invent a destination or a button");
  assert.doesNotMatch(markup, /<a\b/, "no anchor may appear without a caller destination");
  assert.doesNotMatch(markup, /<button\b/, "no button may appear without a caller destination");
  assert.ok(visibleText(markup).includes(FULL_CARD.name), "the work must still read without a link");
});

test("absent price, region and material rows are omitted instead of faked", () => {
  const markup = render({
    name: FULL_CARD.name,
    credit: FULL_CARD.credit,
    availability: FULL_CARD.availability
  });
  const text = visibleText(markup);
  assert.doesNotMatch(text, /[¥$]|NT\$|\bCNY\b|\bTWD\b/, "no currency may appear without an approved price line");
  assert.doesNotMatch(text, /待定|暂未确定|价格待定|—/, "no placeholder price wording may be invented");
  assert.equal(text.includes(FULL_CARD.material!), false, "material must disappear when the caller has none");
  assert.equal(text.includes(FULL_CARD.region!), false, "region must disappear when the caller has none");
  assert.equal(text.includes(FULL_CARD.availability!), true, "approved lines stay visible");
  assert.equal(text.includes("0"), false, "an absent numeric field must not fall back to zero");
});

test("absent approved photography yields a labelled honest region, never a fake image", () => {
  const markup = render(without(FULL_CARD, "visual"));
  assert.doesNotMatch(markup, /<img\b/, "a card without approved photography must not draw an image");
  assert.doesNotMatch(markup, /background-image/, "a filled block may not impersonate product photography");
  assert.match(markup, /data-showroom-visual="pending"/, "the pending frame must be identifiable for measurement");
  assert.ok(visibleText(markup).includes(SHOWROOM_CARD_VISUAL_PENDING_LABEL), "the honest pending note must be readable text");
  assert.doesNotMatch(markup, /aria-hidden="true"[^>]*>[^<]*作品影像尚在准备中/, "the pending note must stay announced");
});

test("approved photography renders once through next/image with the reviewed alternative text", () => {
  const markup = render(FULL_CARD);
  assert.equal((markup.match(/<img\b/g) ?? []).length, 1, "one frame per card");
  assert.match(markup, new RegExp(`alt="${FULL_CARD.visual!.alt}"`), "the reviewed alt text must survive verbatim");
  assert.match(markup, new RegExp(`src="[^"]*${ENCODED_FIXTURE_SRC}`), "the source must be used verbatim");
  assert.match(markup, /sizes="\(?max-width/, "responsive widths must be declared instead of a 100vw guess");
  assert.doesNotMatch(markup, /rel="preload"/, "a below-the-fold card must not force a priority preload");
  assert.match(markup, /data-showroom-visual="ready"/, "a real frame must be distinguishable from the pending one");
  assert.ok(
    markup.indexOf('data-showroom-card-frame="true"') < markup.indexOf("<img"),
    "the image must sit inside the ratio-locked frame"
  );
});

test("the card paints no texture and carries no inline style of its own", () => {
  const markup = render(FULL_CARD);
  for (const tag of authoredElements(markup)) {
    assert.ok(!/\sstyle="/.test(tag), `authored element must not override the stylesheet: ${tag}`);
  }
  assert.doesNotMatch(markup, /url\(/, "no decorative texture, star map or stone pattern may be painted");
  assert.doesNotMatch(markup, /animate-|keyframes/, "no resident animation may be attached");
});

test("a card must not reuse the card-grid hook inside itself", () => {
  // Measured in the browser: a card that re-emits the grid hook makes the grid
  // rules apply to a span inside every card, which blew the 1440px track widths.
  const markup = render(FULL_CARD);
  assert.doesNotMatch(markup, /data-showroom-card-region/, "the card grid hook belongs to the caller's region, not to a card");
});

test("a card emits a card-level heading only and never implies a commercial action", () => {
  const markup = render(FULL_CARD);
  assert.doesNotMatch(markup, /<h[12]\b/, "page headings belong to the route, not to a display card");
  assert.match(markup, /<h3\b/, "the work name must read as a card-level heading");
  const text = visibleText(markup);
  for (const pattern of [...PURCHASE_VOCABULARY, ...FORBIDDEN_CLAIMS]) {
    assert.doesNotMatch(text, pattern, `card copy must not imply ${pattern}`);
  }
});

test("long simplified, traditional and english display copy survives verbatim without clipping", () => {
  for (const [locale, copy] of Object.entries(LOCALIZED_FIXTURES)) {
    const markup = render({ ...FULL_CARD, ...copy });
    const text = visibleText(markup);
    for (const value of Object.values(copy)) {
      assert.ok(text.includes(value), `${locale} copy must be emitted in full`);
    }
    assert.doesNotMatch(markup, /truncate|line-clamp|text-ellipsis|…/, `${locale} copy must not be clipped`);
    assert.doesNotMatch(text, /undefined|\[object Object\]/, `${locale} render must not leak unset props`);
  }
});

test("rendering a card performs no I/O, needs no browser global and leaves props untouched", () => {
  const props = structuredClone(FULL_CARD);
  const snapshot = structuredClone(FULL_CARD);
  withFetchSentry(() => {
    renderToStaticMarkup(<ShowroomCard {...props} />);
  });
  assert.deepEqual(props, snapshot, "a display component must only read its explicit props");
});

test("the card module exposes presentation only — no DTO, schema, fetcher or storefront route", async () => {
  const moduleKeys = Object.keys(await import("./showroom-card")).sort();
  assert.deepEqual(
    moduleKeys,
    ["SHOWROOM_CARD_VISUAL_PENDING_LABEL", "ShowroomCard"],
    "the card module must not grow a second product contract or an API helper"
  );

  const markup = render(FULL_CARD);
  for (const route of ["/shop", "/designers", "/collections", "/cart", "/checkout", "/store", "/api"]) {
    assert.equal(markup.includes(`href="${route}`), false, `Task 4 must not wire the storefront route ${route}`);
  }
});
