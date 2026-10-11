/**
 * TASK-COMMERCE-FE-VISUAL-001 — 诚实空态 (showroom-empty-state) contract.
 *
 * The curated showroom has no approved 无野 photography, no per-item licence record,
 * no reviewed three-locale copy and no human-confirmed price, so Task 4 must publish
 * that fact through the shared `SystemState` primitive: zero product cards, zero
 * purchase affordances, zero invented availability.
 *
 * The wording itself belongs to the caller (the reviewed i18n message tables owned by
 * Task 7): this component only presents. The tests below therefore drive all five
 * reasons in simplified Chinese, traditional Chinese and english, and fail if the
 * component injects any text — or any hard-coded Simplified Chinese — of its own.
 */

import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ShowroomEmptyState,
  type ShowroomEmptyCopy,
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

/** Stand-ins for the reviewer-approved message tables the caller owns. */
const COPY: Record<"en-US" | "zh-CN" | "zh-TW", Record<ShowroomEmptyReason, ShowroomEmptyCopy>> = {
  "zh-CN": {
    content_pending: {
      message: "简体中文、繁体中文与英文的创作说明尚未完成人工审校，缺项期间不发布商品资料。",
      title: "本页作品仍在准备中"
    },
    license_pending: {
      message: "这些作品的展示授权——可展示区域、期限与允许的使用范围——尚未逐件确认。",
      title: "展示授权仍在确认中"
    },
    media_pending: {
      message: "尚无经核准的无野作品摄影可以展示，因此这里不放替代图片。",
      title: "作品影像尚在准备中"
    },
    no_products: {
      message: "玄矶精选正在准备第一批无野作品，本页暂不发布商品，也未开放线上购买。",
      title: "暂无可展示作品"
    },
    region_unavailable: {
      message: "当前选择的市场没有经核准可展示的作品。可展示区域与界面语言是分开的两件事。",
      title: "该区域暂不可展示"
    }
  },
  "zh-TW": {
    content_pending: {
      message: "簡體中文、繁體中文與英文的創作說明尚未完成人工審校，缺項期間不發布商品資料。",
      title: "本頁作品仍在準備中"
    },
    license_pending: {
      message: "這些作品的展示授權——可展示區域、期限與允許的使用範圍——尚未逐件確認。",
      title: "展示授權仍在確認中"
    },
    media_pending: {
      message: "尚無經核准的無野作品攝影可以展示，因此這裡不放替代圖片。",
      title: "作品影像仍在準備中"
    },
    no_products: {
      message: "玄磯精選正在準備第一批無野作品，本頁暫不發布商品，也未開放線上購買。",
      title: "暫無可展示作品"
    },
    region_unavailable: {
      message: "目前選擇的市場沒有經核准可展示的作品。可展示區域與介面語言是兩件不同的事。",
      title: "該區域暫不可展示"
    }
  },
  "en-US": {
    content_pending: {
      message:
        "The creative notes have not finished human review in Simplified Chinese, Traditional Chinese and English, so no listing is published yet.",
      title: "These works are still in preparation"
    },
    license_pending: {
      message:
        "The display licence for these works — approved market, term and permitted use — has not been confirmed item by item.",
      title: "Display licences are still being confirmed"
    },
    media_pending: {
      message:
        "No approved Wuye product photography is available yet, so this page shows no substitute imagery.",
      title: "Product photography is still being prepared"
    },
    no_products: {
      message:
        "The curated selection is preparing its first Wuye works. Nothing is published here and online purchase is not open.",
      title: "No works are available to display"
    },
    region_unavailable: {
      message:
        "This market has no approved works to display. The display market and the interface language are separate decisions.",
      title: "Not available in this region"
    }
  }
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
  return decodeEntities(markup.replace(/<[^>]*>/g, ""));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function controlCount(markup: string): number {
  return (markup.match(/<(a|button)\b/g) ?? []).length;
}

function render(
  locale: keyof typeof COPY,
  reason: ShowroomEmptyReason,
  action?: SystemStateAction
): string {
  return renderToStaticMarkup(
    <ShowroomEmptyState action={action} copy={COPY[locale][reason]} reason={reason} />
  );
}

test("every reason in every locale renders the shared system-state primitive with the caller's copy", () => {
  for (const locale of Object.keys(COPY) as Array<keyof typeof COPY>) {
    for (const reason of REASONS) {
      const markup = render(locale, reason, ACTIONS.link);
      const copy = COPY[locale][reason];
      assert.match(markup, /data-star-status-panel="info"/, `${locale}/${reason} must reuse the shared status panel`);
      assert.match(markup, /data-star-system-state="empty"/, `${locale}/${reason} must publish as the canonical empty state`);
      assert.match(markup, /role="status"/, `${locale}/${reason} is informational and must stay polite`);
      assert.match(markup, new RegExp(`data-showroom-empty-state="${reason}"`), `${locale}/${reason} must record why nothing is shown`);
      assert.ok(visibleText(markup).includes(copy.title), `${locale}/${reason} title must render verbatim`);
      assert.ok(visibleText(markup).includes(copy.message), `${locale}/${reason} message must render verbatim`);
    }
  }
});

test("the empty state owns no wording: rendered text is exactly the caller's copy plus its action", () => {
  for (const locale of Object.keys(COPY) as Array<keyof typeof COPY>) {
    for (const reason of REASONS) {
      const copy = COPY[locale][reason];
      const withoutAction = visibleText(render(locale, reason)).replace(/\s+/g, "");
      assert.equal(
        withoutAction,
        `${copy.title}${copy.message}`.replace(/\s+/g, ""),
        `${locale}/${reason} must not add any text of its own`
      );

      const withLink = visibleText(render(locale, reason, ACTIONS.link)).replace(/\s+/g, "");
      assert.equal(
        withLink,
        `${copy.title}${copy.message}${ACTIONS.link!.label}`.replace(/\s+/g, ""),
        `${locale}/${reason} must add only the caller's action label`
      );
    }
  }
});

test("no built-in Simplified Chinese leaks into traditional or english display copy", () => {
  const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  for (const reason of REASONS) {
    const simplified = COPY["zh-CN"][reason];
    const english = render("en-US", reason);
    const traditional = render("zh-TW", reason);

    assert.doesNotMatch(visibleText(english), cjk, `${reason} must render no CJK text in en-US`);
    assert.ok(!english.includes(simplified.title), `${reason} must not fall back to the simplified title`);
    assert.ok(!english.includes(simplified.message), `${reason} must not fall back to the simplified message`);
    assert.ok(!traditional.includes(simplified.title), `${reason} must not fall back to the simplified title in zh-TW`);
    assert.ok(!traditional.includes(simplified.message), `${reason} must not fall back to the simplified message in zh-TW`);
  }
});

test("a zero-product showroom emits no product card, no image and no price", () => {
  for (const locale of Object.keys(COPY) as Array<keyof typeof COPY>) {
    for (const reason of REASONS) {
      for (const kind of ["none", "button", "link"] as const) {
        const markup = render(locale, reason, ACTIONS[kind]);
        const text = visibleText(markup);
        assert.doesNotMatch(markup, /data-showroom-card=/, `${locale}/${reason}/${kind} must not fake a product card`);
        assert.doesNotMatch(markup, /<img\b|background-image/, `${locale}/${reason}/${kind} must not fake photography`);
        assert.doesNotMatch(text, /[¥$]|NT\$|\bCNY\b|\bTWD\b/, `${locale}/${reason}/${kind} must not publish a price`);
        for (const pattern of PURCHASE_VOCABULARY) {
          assert.doesNotMatch(text, pattern, `${locale}/${reason}/${kind} must not imply ${pattern}`);
        }
        for (const pattern of FORBIDDEN_CLAIMS) {
          assert.doesNotMatch(text, pattern, `${locale}/${reason}/${kind} must not claim ${pattern}`);
        }
      }
    }
  }
});

test("an empty state offers at most one real next action and never a dead control", () => {
  for (const reason of REASONS) {
    assert.equal(controlCount(render("zh-CN", reason)), 0, `${reason} without a caller action must not render a placeholder button`);

    const linked = render("zh-CN", reason, ACTIONS.link);
    assert.equal(controlCount(linked), 1, `${reason} must expose exactly one action`);
    assert.match(linked, /开始一次创作/, `${reason} must render the caller's label verbatim`);
    assert.match(linked, /href="\/diy"/, `${reason} must render the caller's real destination`);
    assert.doesNotMatch(linked, /href="(\/shop|\/designers|\/collections|\/cart|\/checkout)/, `${reason} must not wire a storefront route`);

    const buttoned = render("zh-CN", reason, ACTIONS.button);
    assert.equal(controlCount(buttoned), 1, `${reason} button action must also be a single control`);
    assert.match(buttoned, /<button\b[^>]*type="button"/, `${reason} must render a native keyboard-activatable button that cannot submit a form`);
  }
});

test("an empty state is a stable honest state, not a skeleton", () => {
  const markup = render("zh-CN", "no_products", ACTIONS.link);
  assert.doesNotMatch(markup, /aria-busy/, "an empty state is not a pending request");
  assert.doesNotMatch(markup, /animate-|keyframes|skeleton|pulse/, "no fake skeleton may prop up the layout");
  assert.doesNotMatch(markup, /url\(/, "no texture may be painted");
  assert.doesNotMatch(markup, /<h[12]\b/, "the empty state must not steal the page heading");
});

test("rendering an empty state performs no I/O, needs no browser global and leaves copy untouched", () => {
  const copy = structuredClone(COPY["zh-CN"].media_pending);
  const snapshot = structuredClone(COPY["zh-CN"].media_pending);
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
    renderToStaticMarkup(<ShowroomEmptyState copy={copy} reason="media_pending" />);
    assert.equal(calls, 0, "a display empty state must never request an API during render");
  } finally {
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: originalFetch });
  }
  assert.deepEqual(copy, snapshot, "the component must only read the copy it was handed");
});

test("the empty-state module exposes presentation only — no copy table, DTO, schema or fetcher", async () => {
  const moduleKeys = Object.keys(await import("./showroom-empty-state")).sort();
  assert.deepEqual(
    moduleKeys,
    ["ShowroomEmptyState"],
    "the empty state must not own wording, a second product contract or an API helper"
  );
});
