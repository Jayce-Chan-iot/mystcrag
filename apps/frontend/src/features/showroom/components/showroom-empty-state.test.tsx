/**
 * TASK-COMMERCE-FE-VISUAL-001 — 诚实空态 (showroom-empty-state) contract.
 *
 * The curated showroom has no approved 无野 photography, no per-item licence record,
 * no reviewed three-locale copy and no human-confirmed price. Task 4 must therefore
 * publish an honest empty state through the existing shared `SystemState` primitive:
 * zero product cards, zero purchase affordances, zero invented availability.
 *
 * The tests below render the real component for every reason and for both action
 * kinds, and fail if any product, price, stock, delivery or after-sales signal leaks.
 */

import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ShowroomEmptyState,
  showroomEmptyStateCopy,
  type ShowroomEmptyReason
} from "./showroom-empty-state";
import type { SystemStateAction } from "../../../../components/page-scaffold";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const REASONS = [
  "no_products",
  "media_pending",
  "license_pending",
  "content_pending",
  "region_unavailable"
] as const satisfies readonly ShowroomEmptyReason[];

const ACTIONS: Record<"none" | "button" | "link", SystemStateAction | undefined> = {
  none: undefined,
  button: { kind: "button", label: "重新载入本页", onAction: () => {} },
  link: { kind: "link", label: "开始一次创作", href: "/diy" }
};

const PURCHASE_VOCABULARY = [
  /加入购物车/,
  /加入购物袋/,
  /添加到购物车/,
  /立即购买/,
  /立即支付/,
  /去结算/,
  /结算/,
  /下单/,
  /购物车/,
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

function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, "");
}

function controlCount(markup: string): number {
  return (markup.match(/<(a|button)\b/g) ?? []).length;
}

test("every showroom empty state renders the shared system-state primitive", () => {
  for (const reason of REASONS) {
    const markup = renderToStaticMarkup(<ShowroomEmptyState reason={reason} action={ACTIONS.link} />);
    assert.match(markup, /data-star-status-panel="info"/, `${reason} must reuse the shared @mystcrag/ui status panel`);
    assert.match(markup, /data-star-system-state="empty"/, `${reason} must publish as the canonical empty state`);
    assert.match(markup, /role="status"/, `${reason} is informational and must stay a polite status`);
    assert.match(markup, new RegExp(`data-showroom-empty-state="${reason}"`), `${reason} must record why nothing is shown`);
  }
});

test("a zero-product showroom emits no product card, no image and no price", () => {
  for (const reason of REASONS) {
    for (const kind of ["none", "button", "link"] as const) {
      const markup = renderToStaticMarkup(<ShowroomEmptyState reason={reason} action={ACTIONS[kind]} />);
      const text = visibleText(markup);
      assert.doesNotMatch(markup, /data-showroom-card=/, `${reason}/${kind} must not fake a product card`);
      assert.doesNotMatch(markup, /<img\b|background-image/, `${reason}/${kind} must not fake photography`);
      assert.doesNotMatch(text, /[¥$]|NT\$|\bCNY\b|\bTWD\b/, `${reason}/${kind} must not publish a price`);
      for (const pattern of PURCHASE_VOCABULARY) {
        assert.doesNotMatch(text, pattern, `${reason}/${kind} must not imply ${pattern}`);
      }
    }
  }
});

test("an empty state offers at most one real next action and never a dead control", () => {
  for (const reason of REASONS) {
    const bare = renderToStaticMarkup(<ShowroomEmptyState reason={reason} />);
    assert.equal(controlCount(bare), 0, `${reason} without a caller action must not render a placeholder button`);

    const linked = renderToStaticMarkup(<ShowroomEmptyState reason={reason} action={ACTIONS.link} />);
    assert.equal(controlCount(linked), 1, `${reason} must expose exactly one action`);
    assert.match(linked, /开始一次创作/, `${reason} must render the caller's label verbatim`);
    assert.match(linked, /href="\/diy"/, `${reason} must render the caller's real destination`);
    assert.doesNotMatch(linked, /href="(\/shop|\/designers|\/collections|\/cart|\/checkout)/, `${reason} must not wire a storefront route`);

    const buttoned = renderToStaticMarkup(<ShowroomEmptyState reason={reason} action={ACTIONS.button} />);
    assert.equal(controlCount(buttoned), 1, `${reason} button action must also be a single control`);
    assert.match(buttoned, /<button\b[^>]*type="button"/, `${reason} must render a native keyboard-activatable button that cannot submit a form`);
  }
});

test("each reason carries distinct honest copy that names what is missing", () => {
  const seen = new Set<string>();
  for (const reason of REASONS) {
    const copy = showroomEmptyStateCopy(reason);
    assert.ok(copy.title.length > 0 && copy.message.length > 0, `${reason} must carry real copy`);
    assert.ok(!seen.has(copy.title), `${reason} title must be distinct`);
    seen.add(copy.title);
    const text = `${copy.title}${copy.message}`;
    for (const pattern of FORBIDDEN_CLAIMS) {
      assert.doesNotMatch(text, pattern, `${reason} copy must not claim ${pattern}`);
    }
    assert.doesNotMatch(text, /暂未确定|待定|TBD|placeholder|lorem/i, `${reason} copy must be reviewed wording, not a draft marker`);
  }

  assert.match(showroomEmptyStateCopy("media_pending").message, /影像|摄影/, "media_pending must name the missing photography");
  assert.match(showroomEmptyStateCopy("license_pending").message, /授权/, "license_pending must name the missing licence");
  assert.match(showroomEmptyStateCopy("content_pending").message, /审校/, "content_pending must name the missing review");
  assert.match(
    showroomEmptyStateCopy("region_unavailable").message,
    /区域/,
    "region_unavailable must name the market decision"
  );
});

test("the region note keeps market and language separate and promises no conversion", () => {
  const copy = showroomEmptyStateCopy("region_unavailable");
  const text = `${copy.title}${copy.message}`;
  assert.match(text, /语言/, "the note must explain that language is not the market switch");
  assert.doesNotMatch(text, /会自动|即可切换|按语言|自动换汇/, "the note must not promise automatic currency or market switching");
});

test("the showroom empty state never leaks the gallery's design-specific default copy", () => {
  for (const reason of REASONS) {
    const markup = renderToStaticMarkup(<ShowroomEmptyState reason={reason} action={ACTIONS.link} />);
    assert.doesNotMatch(markup, /AI 问卷|三套设计|还没有可展示的设计/, `${reason} must override the design-catalog copy`);
  }
});

test("an empty state is a stable honest state, not a skeleton", () => {
  const markup = renderToStaticMarkup(<ShowroomEmptyState reason="no_products" action={ACTIONS.link} />);
  assert.doesNotMatch(markup, /aria-busy/, "an empty state is not a pending request");
  assert.doesNotMatch(markup, /animate-|keyframes|skeleton|pulse/, "no fake skeleton may撑 the layout");
  assert.doesNotMatch(markup, /url\(/, "no texture may be painted");
  assert.doesNotMatch(markup, /<h[12]\b/, "the empty state must not steal the page heading");
});

test("rendering an empty state performs no I/O and needs no browser global", () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (() => {
      calls += 1;
      return Promise.reject(new Error("empty state must not call the network"));
    }) as unknown as typeof fetch
  });
  try {
    assert.equal(typeof document, "undefined", "these tests run with no DOM");
    for (const reason of REASONS) {
      renderToStaticMarkup(<ShowroomEmptyState reason={reason} action={ACTIONS.link} />);
    }
    assert.equal(calls, 0, "a display empty state must never request an API during render");
  } finally {
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: originalFetch });
  }
});

test("the empty-state module exposes presentation only — no DTO, schema or fetcher", async () => {
  const moduleKeys = Object.keys(await import("./showroom-empty-state")).sort();
  assert.deepEqual(
    moduleKeys,
    ["ShowroomEmptyState", "showroomEmptyStateCopy"],
    "the empty state must not grow a second product contract or an API helper"
  );
});
