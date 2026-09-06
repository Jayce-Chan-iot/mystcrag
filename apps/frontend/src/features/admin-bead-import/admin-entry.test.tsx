import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import AdminEntryPage from "../../../app/admin/page";

const FORBIDDEN_CLAIMS = ["功效", "疗效", "治疗", "保证", "转运", "招财", "辟邪", "旺财"];
const FORBIDDEN_LEAKS = [
  "archiveKey",
  "asset-archive",
  "x-admin-key",
  "MYSTCRAG_ASSET_ADMIN_KEY",
  "ASSET_ADMIN_API_KEY",
  "MYSTCRAG_BACKEND_ORIGIN",
  "127.0.0.1",
  "/Users/",
  "localhost"
];

const PAGE_SOURCE = readFileSync(join(__dirname, "../../../app/admin/page.tsx"), "utf8");

function markup(): string {
  return renderToStaticMarkup(<AdminEntryPage />);
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("the admin home offers both consoles as parallel entries", () => {
  const html = markup();
  assert.equal(countOf(html, `href="/admin/knowledge"`), 1);
  assert.equal(countOf(html, `href="/admin/bead-import"`), 1);
  assert.equal(countOf(html, "<li"), 2, "both entries sit in one list, side by side");
  assert.equal(countOf(html, "<a "), 2, "no entry may be nested inside the other");
  assert.ok(html.includes(">知识管理<"));
  assert.ok(html.includes(">珠子素材入库<"));
});

test("the bead import entry never routes through the knowledge console", () => {
  const html = markup();
  const knowledgeEntry = html.slice(html.indexOf(`href="/admin/knowledge"`));
  const beadEntry = knowledgeEntry.slice(0, knowledgeEntry.indexOf("</li>"));
  assert.ok(!beadEntry.includes("/admin/bead-import"));
  assert.ok(!html.includes("/admin/knowledge/bead-import"));
});

test("the entry page states that the two consoles do not share a session", () => {
  const html = markup();
  assert.ok(html.includes("互不共享"), "operators must know the consoles authenticate separately");
  assert.ok(html.includes("独立登录"));
});

test("the entry page renders on the server and reads no credential or cookie", () => {
  assert.ok(!PAGE_SOURCE.includes(`"use client"`));
  assert.ok(!PAGE_SOURCE.includes("next/headers"));
  assert.ok(!PAGE_SOURCE.includes("cookies("));
  assert.ok(!PAGE_SOURCE.includes("process.env"));
  assert.ok(!PAGE_SOURCE.includes("console-access"));
  assert.ok(!PAGE_SOURCE.includes("admin-auth"));
});

test("both entries are keyboard targets with a visible focus ring and a touch-sized hit area", () => {
  assert.ok(PAGE_SOURCE.includes("focus-visible:"), "every entry needs a visible focus indicator");
  assert.ok(PAGE_SOURCE.includes("min-h-11"), "entries must stay reachable on a phone");
  const html = markup();
  assert.ok(html.includes("<h1"));
  assert.ok(html.includes("aria-labelledby") || html.includes("<h1"), "the page needs one named heading");
});

test("the entry page survives a phone viewport without a fixed-width layout", () => {
  assert.ok(!/<table/.test(PAGE_SOURCE));
  assert.ok(PAGE_SOURCE.includes("min-w-0"));
  assert.ok(PAGE_SOURCE.includes("grid-cols-1"));
  assert.ok(PAGE_SOURCE.includes("sm:grid-cols-2"));
  for (const match of PAGE_SOURCE.matchAll(/(?:min-)?w-\[(\d+)px\]/g)) {
    assert.ok(Number(match[1]) <= 320, `${match[0]} overflows a 390px viewport`);
  }
});

test("no entry copy leaks a secret, an internal origin or a storage path", () => {
  const html = markup();
  for (const forbidden of [...FORBIDDEN_LEAKS, ...FORBIDDEN_CLAIMS]) {
    assert.ok(!PAGE_SOURCE.includes(forbidden), `source must not mention ${forbidden}`);
    assert.ok(!html.includes(forbidden), `markup must not mention ${forbidden}`);
  }
});
