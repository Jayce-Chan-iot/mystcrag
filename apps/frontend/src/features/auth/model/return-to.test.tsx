/**
 * returnTo path validation tests.
 *
 * Coverage:
 * - Valid same-origin relative paths
 * - Undefined/null/empty fallback
 * - Absolute URL rejection
 * - Protocol-relative rejection
 * - Backslash rejection
 * - Control character rejection
 * - Encoded authority/scheme bypass
 * - Double-encoded attacks
 * - Malformed encoding rejection
 * - Unicode path acceptance
 */

import assert from "node:assert/strict";
import test from "node:test";

import { validateReturnTo } from "./return-to";

test("valid same-origin relative paths are accepted", () => {
  assert.equal(validateReturnTo("/"), "/");
  assert.equal(validateReturnTo("/diy"), "/diy");
  assert.equal(validateReturnTo("/diy/abc123"), "/diy/abc123");
  assert.equal(validateReturnTo("/profile?tab=orders"), "/profile?tab=orders");
  assert.equal(validateReturnTo("/gallery#featured"), "/gallery#featured");
  assert.equal(validateReturnTo("/path/to/resource?key=value&other=123"), "/path/to/resource?key=value&other=123");
});

test("undefined, null, and empty values fall back to /", () => {
  assert.equal(validateReturnTo(undefined), "/");
  assert.equal(validateReturnTo(null), "/");
  assert.equal(validateReturnTo(""), "/");
});

test("absolute URLs are rejected", () => {
  assert.equal(validateReturnTo("https://evil.com"), "/");
  assert.equal(validateReturnTo("http://localhost:3000"), "/");
  assert.equal(validateReturnTo("https://example.com/path"), "/");
  assert.equal(validateReturnTo("ftp://files.example.com"), "/");
  assert.equal(validateReturnTo("javascript:alert(1)"), "/");
  assert.equal(validateReturnTo("data:text/html,<script>alert(1)</script>"), "/");
});

test("protocol-relative URLs are rejected", () => {
  assert.equal(validateReturnTo("//evil.com"), "/");
  assert.equal(validateReturnTo("//example.com/path"), "/");
  assert.equal(validateReturnTo("///triple-slash"), "/");
});

test("backslashes are rejected", () => {
  assert.equal(validateReturnTo("\\evil.com"), "/");
  assert.equal(validateReturnTo("/path\\to\\resource"), "/");
  assert.equal(validateReturnTo("\\\\server\\share"), "/");
});

test("control characters are rejected", () => {
  assert.equal(validateReturnTo("/path\x00null"), "/");
  assert.equal(validateReturnTo("/path\nwith\nnewlines"), "/");
  assert.equal(validateReturnTo("/path\twith\ttabs"), "/");
  assert.equal(validateReturnTo("/path\x7fwith\x7fdel"), "/");
});

test("paths not starting with / are rejected", () => {
  assert.equal(validateReturnTo("path"), "/");
  assert.equal(validateReturnTo("diy"), "/");
  assert.equal(validateReturnTo("profile?tab=orders"), "/");
});

test("encoded authority bypass is rejected", () => {
  assert.equal(validateReturnTo("%2F%2Fevil.com"), "/");
  assert.equal(validateReturnTo("/%2F%2Fevil.com"), "/");
  assert.equal(validateReturnTo("%5C%5Cevil.com"), "/");
});

test("encoded scheme bypass is rejected", () => {
  assert.equal(validateReturnTo("%6Aavascript:alert(1)"), "/");
});

test("query parameters with encoded external URLs are preserved as-is", () => {
  // The query parameter value is part of the path, not a redirect target
  assert.equal(validateReturnTo("/path?redirect=%68ttps://evil.com"), "/path?redirect=%68ttps://evil.com");
});

test("double-encoded attacks are rejected", () => {
  assert.equal(validateReturnTo("%252F%252Fevil.com"), "/");
  assert.equal(validateReturnTo("/%252F%252Fevil.com"), "/");
});

test("malformed encoding is rejected", () => {
  assert.equal(validateReturnTo("%E0%A4%A"), "/");
  assert.equal(validateReturnTo("/path%invalid"), "/");
});

test("valid paths with query and hash are accepted", () => {
  assert.equal(validateReturnTo("/search?q=水晶&sort=popular"), "/search?q=水晶&sort=popular");
  assert.equal(validateReturnTo("/design/abc#preview"), "/design/abc#preview");
  assert.equal(validateReturnTo("/path?key=value#hash"), "/path?key=value#hash");
});

test("paths with unicode characters are accepted", () => {
  assert.equal(validateReturnTo("/水晶"), "/水晶");
  assert.equal(validateReturnTo("/设计/手串"), "/设计/手串");
  assert.equal(validateReturnTo("/path?name=玄矶"), "/path?name=玄矶");
});
