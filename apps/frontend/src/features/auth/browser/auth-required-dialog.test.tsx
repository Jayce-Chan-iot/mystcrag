import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AUTH_REQUIRED_COPY,
  AuthRequiredDialog,
  isDialogDismissKey,
  nextTabIndex
} from "./auth-required-dialog";

const noop = () => undefined;

test("dismiss key is Escape only", () => {
  assert.equal(isDialogDismissKey("Escape"), true);
  assert.equal(isDialogDismissKey("Enter"), false);
  assert.equal(isDialogDismissKey("Tab"), false);
});

test("focus trap wraps forward and backward without escaping", () => {
  assert.equal(nextTabIndex("Tab", false, 0, 2), 1);
  assert.equal(nextTabIndex("Tab", false, 1, 2), 0);
  assert.equal(nextTabIndex("Tab", true, 0, 2), 1);
  assert.equal(nextTabIndex("Tab", true, 1, 2), 0);
  assert.equal(nextTabIndex("Tab", false, 0, 1), 0);
});

test("dialog renders one accessible, labelled dialog with approved copy and 44px actions", () => {
  const markup = renderToStaticMarkup(
    <AuthRequiredDialog loginHref="/auth/login?returnTo=%2Fdiy%2Fabc" onDismiss={noop} />
  );

  assert.equal((markup.match(/role="dialog"/g) ?? []).length, 1);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-labelledby="/);
  assert.match(markup, /aria-describedby="/);
  assert.match(markup, /登录后继续/);
  assert.match(markup, /登录或注册后，你可以保存设计、继续抽牌并同步个人作品。/);
  assert.match(markup, /登录 \/ 注册/);
  assert.match(markup, /暂不登录/);
  assert.match(markup, /href="\/auth\/login\?returnTo=%2Fdiy%2Fabc"/);
  // Both actions are at least 44px tall.
  assert.match(markup, /min-h-11/);
  // Exactly the configured copy, no stray inheritance.
  assert.equal(AUTH_REQUIRED_COPY.title, "登录后继续");
  assert.equal(AUTH_REQUIRED_COPY.primaryAction, "登录 / 注册");
  assert.equal(AUTH_REQUIRED_COPY.secondaryAction, "暂不登录");
});

test("dialog wires initial focus, restoration, trap and Escape to pure helpers", () => {
  const source = readFileSync(new URL("./auth-required-dialog.tsx", import.meta.url), "utf8");
  assert.match(source, /primaryRef\.current\?\.focus\(\)/);
  assert.match(source, /const previouslyFocused = document\.activeElement/);
  assert.match(source, /previouslyFocused\.focus\(\)/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /nextTabIndex\(/);
  assert.match(source, /isDialogDismissKey\(event\.key\)/);
  assert.doesNotMatch(source, /__NEXT_PUBLIC|desktop|access_token|Bearer/i);
});