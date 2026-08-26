import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_STATUS_CLASSES,
  TOUCH_TARGET_CLASS,
  resolveAuthStatusView,
  resolveDisplayName
} from "./auth-status-view";

test("loading state renders a polite live region without any action", () => {
  const view = resolveAuthStatusView("loading");
  assert.equal(view.state, "loading");
  assert.equal(view.role, "status");
  assert.equal(view.ariaLive, "polite");
  assert.equal(view.text, "加载中...");
});

test("error state announces via an assertive alert and offers login recovery", () => {
  const view = resolveAuthStatusView("error");
  assert.equal(view.state, "error");
  assert.equal(view.role, "alert");
  assert.equal(view.ariaLive, "assertive");
  assert.equal(view.text, "会话错误");
  assert.equal(view.action.kind, "login");
  assert.equal(view.action.label, "重新登录");
  assert.equal(view.action.ariaLabel, "重新登录");
});

test("unauthenticated state exposes a single login control with accessible label", () => {
  const view = resolveAuthStatusView("unauthenticated");
  assert.equal(view.state, "unauthenticated");
  assert.equal(view.action.kind, "login");
  assert.equal(view.action.label, "登录");
  assert.equal(view.action.ariaLabel, "登录");
});

test("authenticated state keeps the status live region and offers logout", () => {
  const view = resolveAuthStatusView("authenticated", { displayName: "张三" });
  assert.equal(view.state, "authenticated");
  assert.equal(view.role, "status");
  assert.equal(view.ariaLive, "polite");
  assert.equal(view.displayName, "张三");
  assert.equal(view.action.kind, "logout");
  assert.equal(view.action.label, "退出");
  assert.equal(view.action.ariaLabel, "退出登录");
});

test("every action control carries the 44px mobile touch target", () => {
  for (const state of ["loading", "error", "unauthenticated", "authenticated"] as const) {
    const view = resolveAuthStatusView(state, { displayName: "用户" });
    if (view.state === "loading") continue;
    assert.ok(
      view.action.className.includes(TOUCH_TARGET_CLASS),
      `${view.state} action must keep ${TOUCH_TARGET_CLASS}`
    );
  }
  assert.equal(TOUCH_TARGET_CLASS, "min-h-11");
});

test("authenticated row and display name keep the overflow-bounding class contract", () => {
  const view = resolveAuthStatusView("authenticated", { displayName: "名字" });
  if (view.state !== "authenticated") throw new Error("expected authenticated view");
  assert.equal(view.rowClassName, AUTH_STATUS_CLASSES.row);
  assert.ok(view.rowClassName.includes("min-w-0"), "row must shrink instead of overflowing");
  assert.ok(view.displayNameClassName.includes("truncate"), "display name must truncate");
  assert.ok(view.displayNameClassName.includes("min-w-0"), "display name must shrink");
  assert.ok(view.displayNameClassName.includes("max-w-[10rem]"), "display name must be width-bounded");
});

test("display name fallback chain: displayName → email → neutral label", () => {
  assert.equal(resolveDisplayName({ displayName: "张三", email: "a@b.c" }), "张三");
  assert.equal(resolveDisplayName({ displayName: "", email: "a@b.c" }), "a@b.c");
  assert.equal(resolveDisplayName({ displayName: "   ", email: "a@b.c" }), "a@b.c");
  assert.equal(resolveDisplayName({ displayName: "", email: "" }), "用户");
  assert.equal(resolveDisplayName(undefined), "用户");
  assert.equal(resolveDisplayName(null), "用户");
});
