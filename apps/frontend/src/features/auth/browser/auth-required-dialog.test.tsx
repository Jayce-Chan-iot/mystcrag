import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AUTH_REQUIRED_COPY,
  AuthRequiredDialog,
  dismissDialog,
  initialLoginHref,
  isDialogDismissKey,
  nextTabIndex,
  resolveReturnFocusTarget,
  restoreFocusTo,
  SERVER_SAFE_LOGIN_HREF
} from "./auth-required-dialog";
import { resolveAuthPromptMode } from "./session-client";

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
  assert.match(source, /previouslyFocusedRef\.current = document\.activeElement/);
  assert.match(source, /resolveReturnFocusTarget\(returnFocusRef, previouslyFocusedRef\.current\)/);
  assert.match(source, /restoreFocusTo\(resolveReturnFocusTarget\(returnFocusRef, previouslyFocusedRef\.current\)\)/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /nextTabIndex\(/);
  assert.match(source, /isDialogDismissKey\(event\.key\)/);
  // No secret material may be referenced in source or reach rendered output.
  assert.doesNotMatch(source, /__NEXT_PUBLIC|access_token|Bearer/i);
});

test("dialog never leaks secret or token material into SSR markup", () => {
  const markup = renderToStaticMarkup(<AuthRequiredDialog onDismiss={noop} />);
  assert.doesNotMatch(markup, /__NEXT_PUBLIC|access_token|Bearer|desktop-secret/i);
});

// --- Issue 3: every dismissal path explicitly restores focus (behavioral) ---

test("restoreFocusTo calls focus() only on a focusable element", () => {
  const focused: string[] = [];
  const trigger = { focus: () => { focused.push("trigger"); } };
  assert.equal(restoreFocusTo(trigger), true);
  assert.deepEqual(focused, ["trigger"]);
  assert.equal(restoreFocusTo(null), false);
  assert.equal(restoreFocusTo(undefined), false);
  assert.equal(restoreFocusTo({}), false);
  assert.equal(restoreFocusTo({ focus: 1 }), false);
});

test("resolveReturnFocusTarget prefers an explicit returnFocusRef over activeElement fallback", () => {
  const trigger = { focus: () => {} };
  const body = { focus: () => {} };
  assert.equal(resolveReturnFocusTarget({ current: trigger as HTMLElement }, body as HTMLElement), trigger);
  assert.equal(resolveReturnFocusTarget({ current: null }, body as HTMLElement), body);
  assert.equal(resolveReturnFocusTarget(undefined, body as HTMLElement), body);
  assert.equal(resolveReturnFocusTarget(null, null), null);
});

test("dismissDialog closes, restores focus to the trigger and then fires onDismiss in order", () => {
  const calls: string[] = [];
  const trigger = { focus: () => { calls.push("focus"); } };
  dismissDialog(
    () => { calls.push("close"); },
    trigger,
    () => { calls.push("onDismiss"); }
  );
  assert.deepEqual(calls, ["close", "focus", "onDismiss"]);
});

test("dismissDialog always fires onDismiss even when no element can be restored", () => {
  let onDismissCalls = 0;
  dismissDialog(() => {}, null, () => { onDismissCalls += 1; });
  assert.equal(onDismissCalls, 1);
});

test("dismissDialog closes, restores focus and fires onDismiss in order (Button/Escape/mask path)", () => {
  const calls: string[] = [];
  const setOpenCalls: boolean[] = [];
  const handler = () => dismissDialog(
    () => { setOpenCalls.push(false); calls.push("close"); },
    { focus: () => { calls.push("focus"); } },
    () => { calls.push("onDismiss"); }
  );
  handler();
  assert.deepEqual(calls, ["close", "focus", "onDismiss"]);
  assert.deepEqual(setOpenCalls, [false]);
});

test("a dialog dismiss with no onDismiss performs no business retry", () => {
  let externalCalls = 0;
  const close = () => { externalCalls += 1; };
  const handler = () => dismissDialog(close, { focus: () => {} });
  handler();
  assert.equal(externalCalls, 1, "dialog only closes; no onDismiss/retry is invoked");
});

test("a dialog dismiss still restores focus when onDismiss is absent", () => {
  const focused: string[] = [];
  dismissDialog(() => {}, { focus: () => { focused.push("trigger"); } });
  assert.deepEqual(focused, ["trigger"]);
});

// --- Issue 4: a fresh mount re-opens the dialog, so a new 401 can surface again ---

test("a freshly rendered dialog starts open, so a later 401 remount reopens it", () => {
  const markup = renderToStaticMarkup(<AuthRequiredDialog onDismiss={noop} />);
  assert.match(markup, /data-auth-required-dialog="true"/);
  assert.ok(markup.length > 0, "dialog renders (open=true) on a fresh mount");
});

// --- Issue 5: the default login href is hydration-stable ---

test("initial login href is the fixed server-safe default when no prop is supplied", () => {
  assert.equal(initialLoginHref(), SERVER_SAFE_LOGIN_HREF);
  assert.equal(initialLoginHref("/auth/login?returnTo=%2Fcustom"), "/auth/login?returnTo=%2Fcustom");
});

test("default dialog SSRs the fixed server-safe href so hydration cannot mismatch", () => {
  const markup = renderToStaticMarkup(<AuthRequiredDialog onDismiss={noop} />);
  assert.ok(markup.includes(`href="${SERVER_SAFE_LOGIN_HREF}"`), markup);
  assert.ok(!markup.includes("buildLoginHref"), "no window-derived href may leak into SSR output");
});

// --- Shared session snapshot classification (TASK-AUTH-010) ---

test("only the explicit desktop session capability selects desktop recovery", () => {
  assert.equal(resolveAuthPromptMode({ status: "authenticated", session: {
    authenticated: true,
    user: { displayName: "本地演示用户" },
    logoutAvailable: false
  }}), "desktop-recovery");
  assert.equal(resolveAuthPromptMode({ status: "unauthenticated", session: {
    authenticated: false
  }}), "auth0");
  assert.equal(resolveAuthPromptMode({ status: "authenticated", session: {
    authenticated: true,
    user: { displayName: "普通用户" }
  }}), "auth0");
});

test("session-client source never classifies desktop mode from displayName or secrets", () => {
  const source = readFileSync(new URL("./session-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /displayName\s*===|displayName\.includes|includes\(["']本地演示/);
  assert.doesNotMatch(source, /__NEXT_PUBLIC|access_token|Bearer|issuer|subject|secret/i);
  assert.match(source, /logoutAvailable === false/);
  assert.match(source, /export function resolveAuthPromptMode/);
  assert.match(source, /export async function fetchSessionSnapshot/);
  assert.match(source, /export type SessionState/);
  assert.match(source, /export type SessionSnapshot/);
});