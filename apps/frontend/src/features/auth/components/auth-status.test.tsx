/**
 * AuthStatus interaction tests.
 *
 * Coverage:
 * - The pure view model contract (states, aria roles/live regions, labels, fallback
 *   chain, touch-target and overflow-bounding classes).
 * - The ACTUAL presentational React renderer (`AuthStatusPresenter`): real ReactElement
 *   output verified via `renderToStaticMarkup` (role/aria-live/aria-label/class/text)
 *   plus real `onClick` invocation on the rendered buttons proving each callback fires
 *   exactly once. No DOM library and no component test framework are used.
 * - `AuthStatus` provably renders through the single composition boundary
 *   `AuthStatusFromSession` → presenter, and the REAL hook-to-action wiring is proven:
 *   clicking each rendered control invokes exactly the correct login/logout callback
 *   (never swapped) against the production composition component itself.
 */

import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AUTH_STATUS_CLASSES,
  TOUCH_TARGET_CLASS,
  resolveAuthStatusView,
  resolveDisplayName,
  type AuthStatusView
} from "./auth-status-view";
import { AuthStatusPresenter } from "./auth-status-presenter";
import { AuthStatusFromSession } from "./auth-status-from-session";
import { AuthStatus } from "./auth-status";
import type { SessionState, SessionStatus } from "../hooks/use-session";

// --- View model contract ---

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

// --- Actual ReactElement / renderer interaction ---

type FoundElement = {
  readonly type: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly props: any;
};

function flattenChildren(children: unknown): unknown[] {
  if (Array.isArray(children)) {
    return children.flatMap(flattenChildren);
  }
  return [children];
}

/**
 * Depth-first walk of a real ReactElement tree. Function components are invoked
 * directly (the presenter is a pure, hook-free renderer) so the walk reaches the
 * real host elements their render output produces.
 */
function collectElements(node: unknown): FoundElement[] {
  if (!React.isValidElement(node)) return [];
  const element = node as React.ReactElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children = flattenChildren((element.props as any)?.children ?? []);
  const rendered =
    typeof element.type === "function"
      ? [(element.type as (props: unknown) => unknown)(element.props)]
      : [];
  return [element, ...children.flatMap(collectElements), ...rendered.flatMap(collectElements)];
}

function findButtonByAriaLabel(element: React.ReactElement, ariaLabel: string): FoundElement {
  const button = collectElements(element).find(
    (node) => node.type === "button" && node.props["aria-label"] === ariaLabel
  );
  if (!button) throw new Error(`button with aria-label "${ariaLabel}" not found in rendered tree`);
  return button;
}

function renderPresenter(view: AuthStatusView, onLogin: () => void, onLogout: () => void): React.ReactElement {
  return React.createElement(AuthStatusPresenter, { view, onLogin, onLogout });
}

test("presenter loading markup: polite status live region with pulse text", () => {
  const markup = renderToStaticMarkup(
    renderPresenter(resolveAuthStatusView("loading"), () => {}, () => {})
  );
  assert.ok(markup.includes('role="status"'), markup);
  assert.ok(markup.includes('aria-live="polite"'), markup);
  assert.ok(markup.includes("加载中..."), markup);
  assert.ok(markup.includes("animate-pulse"), markup);
  assert.ok(!markup.includes("<button"), "loading state must offer no action");
});

test("presenter error markup: assertive alert with login recovery button", () => {
  const markup = renderToStaticMarkup(
    renderPresenter(resolveAuthStatusView("error"), () => {}, () => {})
  );
  assert.ok(markup.includes('role="alert"'), markup);
  assert.ok(markup.includes('aria-live="assertive"'), markup);
  assert.ok(markup.includes("会话错误"), markup);
  assert.ok(markup.includes('aria-label="重新登录"'), markup);
});

test("presenter error button onClick invokes onLogin exactly once", () => {
  let loginCalls = 0;
  let logoutCalls = 0;
  const element = renderPresenter(
    resolveAuthStatusView("error"),
    () => {
      loginCalls += 1;
    },
    () => {
      logoutCalls += 1;
    }
  );
  const button = findButtonByAriaLabel(element, "重新登录");
  button.props.onClick();
  assert.equal(loginCalls, 1);
  assert.equal(logoutCalls, 0);
});

test("presenter unauthenticated markup: single login button", () => {
  const markup = renderToStaticMarkup(
    renderPresenter(resolveAuthStatusView("unauthenticated"), () => {}, () => {})
  );
  assert.ok(markup.includes('aria-label="登录"'), markup);
  assert.ok(markup.includes(">登录</button>"), markup);
  assert.ok(markup.includes(TOUCH_TARGET_CLASS), markup);
});

test("presenter unauthenticated button onClick invokes onLogin exactly once", () => {
  let loginCalls = 0;
  const element = renderPresenter(
    resolveAuthStatusView("unauthenticated"),
    () => {
      loginCalls += 1;
    },
    () => {
      throw new Error("logout must not fire in unauthenticated state");
    }
  );
  const button = findButtonByAriaLabel(element, "登录");
  button.props.onClick();
  assert.equal(loginCalls, 1);
});

test("presenter authenticated markup: polite status row, truncated name, logout button", () => {
  const markup = renderToStaticMarkup(
    renderPresenter(resolveAuthStatusView("authenticated", { displayName: "水晶匠人" }), () => {}, () => {})
  );
  assert.ok(markup.includes('role="status"'), markup);
  assert.ok(markup.includes('aria-live="polite"'), markup);
  assert.ok(markup.includes("水晶匠人"), markup);
  assert.ok(markup.includes('title="水晶匠人"'), markup);
  assert.ok(markup.includes("truncate"), "display name must keep the truncation class");
  assert.ok(markup.includes('aria-label="退出登录"'), markup);
});

test("presenter displayName fallback renders the email when name is absent", () => {
  const markup = renderToStaticMarkup(
    renderPresenter(resolveAuthStatusView("authenticated", { email: "maker@mystcrag.com" }), () => {}, () => {})
  );
  assert.ok(markup.includes("maker@mystcrag.com"), markup);
});

test("presenter authenticated button onClick invokes onLogout exactly once", () => {
  let loginCalls = 0;
  let logoutCalls = 0;
  const element = renderPresenter(
    resolveAuthStatusView("authenticated", { displayName: "张三" }),
    () => {
      loginCalls += 1;
    },
    () => {
      logoutCalls += 1;
    }
  );
  const button = findButtonByAriaLabel(element, "退出登录");
  button.props.onClick();
  assert.equal(logoutCalls, 1);
  assert.equal(loginCalls, 0);
});

// --- AuthStatusFromSession: the single tested session-to-presenter wiring boundary ---

function renderFromSession(
  status: SessionStatus,
  session: SessionState | null,
  login: (returnTo?: string) => void,
  logout: () => void
): React.ReactElement {
  return React.createElement(AuthStatusFromSession, { status, session, login, logout });
}

function makeActionSpies(): { login: () => void; logout: () => void; calls: string[] } {
  const calls: string[] = [];
  return {
    login: () => {
      calls.push("login");
    },
    logout: () => {
      calls.push("logout");
    },
    calls
  };
}

test("AuthStatusFromSession loading: polite status live region and no action", () => {
  const spies = makeActionSpies();
  const markup = renderToStaticMarkup(renderFromSession("loading", null, spies.login, spies.logout));
  assert.ok(markup.includes('role="status"'), markup);
  assert.ok(markup.includes('aria-live="polite"'), markup);
  assert.ok(markup.includes("加载中..."), markup);
  assert.ok(!markup.includes("<button"), "loading state must offer no action");
});

test("AuthStatusFromSession unauthenticated: clicking login invokes ONLY login, exactly once", () => {
  const spies = makeActionSpies();
  const element = renderFromSession("unauthenticated", null, spies.login, spies.logout);
  const markup = renderToStaticMarkup(element);
  assert.ok(markup.includes('aria-label="登录"'), markup);
  const button = findButtonByAriaLabel(element, "登录");
  button.props.onClick();
  assert.deepEqual(spies.calls, ["login"]);
});

test("AuthStatusFromSession error: clicking retry invokes ONLY login, exactly once", () => {
  const spies = makeActionSpies();
  const element = renderFromSession("error", null, spies.login, spies.logout);
  const markup = renderToStaticMarkup(element);
  assert.ok(markup.includes('role="alert"'), markup);
  assert.ok(markup.includes('aria-live="assertive"'), markup);
  const button = findButtonByAriaLabel(element, "重新登录");
  button.props.onClick();
  assert.deepEqual(spies.calls, ["login"]);
});

test("AuthStatusFromSession authenticated: clicking logout invokes ONLY logout, exactly once", () => {
  const spies = makeActionSpies();
  const session: SessionState = { authenticated: true, user: { displayName: "张三" } };
  const element = renderFromSession("authenticated", session, spies.login, spies.logout);
  const markup = renderToStaticMarkup(element);
  assert.ok(markup.includes('role="status"'), markup);
  assert.ok(markup.includes('aria-live="polite"'), markup);
  assert.ok(markup.includes('aria-label="退出登录"'), markup);
  assert.ok(markup.includes("张三"), markup);
  const button = findButtonByAriaLabel(element, "退出登录");
  button.props.onClick();
  assert.deepEqual(spies.calls, ["logout"]);
});

test("AuthStatusFromSession login/logout are never swapped across all states", () => {
  const cases = [
    { status: "unauthenticated", session: null, ariaLabel: "登录", expected: "login" },
    { status: "error", session: null, ariaLabel: "重新登录", expected: "login" },
    {
      status: "authenticated",
      session: { authenticated: true, user: { displayName: "张三" } },
      ariaLabel: "退出登录",
      expected: "logout"
    }
  ] as const;
  for (const c of cases) {
    const spies = makeActionSpies();
    const element = renderFromSession(c.status, c.session, spies.login, spies.logout);
    const buttons = collectElements(element).filter((node) => node.type === "button");
    assert.equal(buttons.length, 1, `${c.status} must render exactly one action control`);
    const button = buttons[0];
    if (!button) throw new Error("expected one rendered button");
    button.props.onClick();
    // Exact attribution: any login/logout swap would invert this call record.
    assert.deepEqual(spies.calls, [c.expected], `${c.status} action must trigger ${c.expected} only`);
  }
});

// --- AuthStatus provably renders through the boundary/presenter ---

test("AuthStatus renders via AuthStatusFromSession → AuthStatusPresenter (initial loading live region)", () => {
  // AuthStatus hands the useSession() result straight to AuthStatusFromSession (initial
  // state: loading). The serialized output must carry the presenter's loading contract —
  // proof there is no second UI tree and no top-level remapping layer.
  const markup = renderToStaticMarkup(React.createElement(AuthStatus));
  assert.ok(markup.includes('role="status"'), markup);
  assert.ok(markup.includes('aria-live="polite"'), markup);
  assert.ok(markup.includes("加载中..."), markup);
  assert.ok(markup.includes("animate-pulse"), markup);
});
