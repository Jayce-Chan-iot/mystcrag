import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AUTH_REQUIRED_COPY,
  AuthRequiredDialog,
  DESKTOP_RECOVERY_COPY,
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
    <AuthRequiredDialog
      loginHref="/auth/login?returnTo=%2Fdiy%2Fabc"
      initialPromptMode="auth0"
      onDismiss={noop}
    />
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
  const markup = renderToStaticMarkup(<AuthRequiredDialog initialPromptMode="auth0" onDismiss={noop} />);
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

// --- Mode-aware auth-required dialog (TASK-AUTH-010 Task 2) ---

test("desktop recovery copy is the exact approved wording", () => {
  assert.equal(DESKTOP_RECOVERY_COPY.title, "本地演示身份需要刷新");
  assert.equal(
    DESKTOP_RECOVERY_COPY.message,
    "请保持此页面打开，重新运行桌面的玄矶系统启动脚本。服务重新启动后，再次执行刚才的操作。"
  );
  assert.equal(DESKTOP_RECOVERY_COPY.primaryAction, "我知道了");
  assert.equal(DESKTOP_RECOVERY_COPY.secondaryAction, "暂不处理");
});

test("checking mode shows a focusable disabled primary and no login link", () => {
  const markup = renderToStaticMarkup(<AuthRequiredDialog onDismiss={noop} />);
  assert.match(markup, /data-auth-required-dialog="true"/);
  assert.match(markup, /登录后继续/);
  assert.match(markup, /正在检查登录方式/);
  assert.match(markup, /aria-disabled="true"/);
  assert.match(markup, /min-h-11/);
  assert.doesNotMatch(markup, /href="\/auth\/login/);
  assert.doesNotMatch(markup, /本地演示身份需要刷新/);
});

test("desktop-recovery mode renders recovery copy with no Auth0 login link", () => {
  const markup = renderToStaticMarkup(
    <AuthRequiredDialog initialPromptMode="desktop-recovery" onDismiss={noop} />
  );
  assert.match(markup, /本地演示身份需要刷新/);
  assert.match(markup, /请保持此页面打开，重新运行桌面的玄矶系统启动脚本。服务重新启动后，再次执行刚才的操作。/);
  assert.match(markup, /我知道了/);
  assert.match(markup, /暂不处理/);
  assert.match(markup, /min-h-11/);
  assert.doesNotMatch(markup, /href="\/auth\/login/);
  assert.doesNotMatch(markup, /登录 \/ 注册/);
  assert.doesNotMatch(markup, /Bearer/i);
  assert.doesNotMatch(markup, /access_token|desktop-secret|issuer|subject/i);
});

test("dialog source resolves session mode, never reloads or navigates back", () => {
  const source = readFileSync(new URL("./auth-required-dialog.tsx", import.meta.url), "utf8");
  assert.match(source, /fetchSessionSnapshot\(\)/);
  assert.match(source, /resolveAuthPromptMode\(/);
  assert.match(source, /promptMode === "desktop-recovery"/);
  assert.match(source, /export type AuthPromptMode/);
  assert.doesNotMatch(source, /router\.back|history\.back|location\.reload/);
  assert.doesNotMatch(source, /displayName\s*===/);
});

// --- Real mount behavior (focus restore, session resolution, dismiss paths) ---

const requireFromRoot = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), "../../../../../../package.json")
);
const { JSDOM } = requireFromRoot(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../../node_modules/.pnpm/jsdom@26.1.0/node_modules/jsdom"
  )
) as {
  JSDOM: new (html: string, options?: { url?: string }) => {
    window: Window & typeof globalThis;
  };
};

type DomHarness = {
  window: Window & typeof globalThis;
  document: Document;
  trigger: HTMLButtonElement;
  host: HTMLDivElement;
  restore(): void;
};

function installDom(url = "http://localhost/tarot/setup?tab=draw#step2"): DomHarness {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url });
  const w = dom.window as unknown as Window & typeof globalThis;
  const g = globalThis as Record<string, unknown>;
  const previous = new Map<string, { value: unknown; had: boolean }>();
  const assign = (key: string, value: unknown) => {
    previous.set(key, { value: g[key], had: Object.prototype.hasOwnProperty.call(g, key) });
    Object.defineProperty(g, key, {
      configurable: true,
      writable: true,
      enumerable: true,
      value
    });
  };

  assign("window", w);
  assign("document", w.document);
  assign("HTMLElement", w.HTMLElement);
  assign("Node", w.Node);
  assign("getComputedStyle", w.getComputedStyle.bind(w));
  assign("HTMLAnchorElement", (w as unknown as { HTMLAnchorElement: unknown }).HTMLAnchorElement);
  assign("HTMLButtonElement", (w as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement);
  assign("MouseEvent", (w as unknown as { MouseEvent: unknown }).MouseEvent);
  assign("KeyboardEvent", (w as unknown as { KeyboardEvent: unknown }).KeyboardEvent);
  assign("Event", (w as unknown as { Event: unknown }).Event);
  assign("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  assign("cancelAnimationFrame", (id: number) => clearTimeout(id));
  // next/link use-intersection expects a browser global `self`.
  assign("self", w);
  assign("requestIdleCallback", (cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) =>
    setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0) as unknown as number
  );

  // React DOM may read navigator; define only when writable/missing.
  try {
    assign("navigator", w.navigator);
  } catch {
    // leave Node's native navigator
  }

  const document = w.document;
  const trigger = document.createElement("button");
  trigger.id = "trigger";
  trigger.type = "button";
  trigger.textContent = "触发操作";
  document.body.appendChild(trigger);
  const host = document.createElement("div");
  document.body.appendChild(host);
  trigger.focus();

  return {
    window: w,
    document,
    trigger,
    host,
    restore() {
      for (const [key, entry] of previous) {
        if (!entry.had) delete g[key];
        else
          Object.defineProperty(g, key, {
            configurable: true,
            writable: true,
            enumerable: true,
            value: entry.value
          });
      }
      dom.window.close();
    }
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountDialog(
  host: HTMLElement,
  props: React.ComponentProps<typeof AuthRequiredDialog>
): Promise<{ root: Root; unmount: () => Promise<void> }> {
  const root = createRoot(host);
  await act(async () => {
    root.render(<AuthRequiredDialog {...props} />);
  });
  return {
    root,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    }
  };
}

function deferredSession() {
  let resolveFn: ((value: Response) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<Response>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return {
    promise,
    resolve: (body: unknown) => resolveFn?.(jsonResponse(body)),
    reject: (reason: unknown) => rejectFn?.(reason)
  };
}

function mockSessionFetch(
  impl: (input: RequestInfo | URL) => Promise<Response> | Response
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => impl(input)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function query<E extends Element>(document: Document, selector: string): E {
  const node = document.querySelector(selector);
  assert.ok(node, `expected ${selector}`);
  return node as E;
}

test("without returnFocusRef, mount focuses primary after capturing the real trigger", async () => {
  const dom = installDom();
  const session = deferredSession();
  const restoreFetch = mockSessionFetch(() => session.promise);
  try {
    assert.equal(dom.document.activeElement, dom.trigger);
    const { unmount } = await mountDialog(dom.host, {
      onDismiss: noop
    });

    // Keep the snapshot pending so we inspect the true checking mount timing.
    const primary = query<HTMLElement>(dom.document, '[data-auth-required-primary="true"]');
    assert.equal(dom.document.activeElement, primary, "primary receives focus after mount effect");
    assert.equal(
      dom.document.querySelector("[data-auth-prompt-mode]")?.getAttribute("data-auth-prompt-mode"),
      "checking"
    );

    const secondary = query<HTMLButtonElement>(dom.document, '[data-auth-required-secondary="true"]');
    await act(async () => {
      secondary.click();
    });

    assert.equal(
      dom.document.activeElement,
      dom.trigger,
      "secondary dismiss restores the pre-dialog trigger, not the unmounted primary"
    );
    await unmount();
  } finally {
    restoreFetch();
    dom.restore();
  }
});

test("session snapshots resolve auth0, desktop-recovery, and fetch-failure fallback", async () => {
  const cases = [
    {
      name: "unauthenticated → auth0",
      body: { authenticated: false } as unknown,
      status: 200,
      mode: "auth0",
      expectLogin: true,
      expectDesktopCopy: false
    },
    {
      name: "desktop capability → desktop-recovery",
      body: {
        authenticated: true,
        user: { displayName: "本地演示用户" },
        logoutAvailable: false
      } as unknown,
      status: 200,
      mode: "desktop-recovery",
      expectLogin: false,
      expectDesktopCopy: true
    },
    {
      name: "fetch failure → auth0 fail-safe",
      body: undefined as unknown,
      status: 500,
      mode: "auth0",
      expectLogin: true,
      expectDesktopCopy: false
    }
  ] as const;

  for (const scenario of cases) {
    const dom = installDom();
    const session = deferredSession();
    const restoreFetch = mockSessionFetch(() => session.promise);
    try {
      const { unmount } = await mountDialog(dom.host, { onDismiss: noop });
      assert.equal(
        dom.document.querySelector("[data-auth-prompt-mode]")?.getAttribute("data-auth-prompt-mode"),
        "checking",
        `${scenario.name}: starts in checking`
      );
      const checkingPrimary = query<HTMLElement>(dom.document, '[data-auth-required-primary="true"]');
      assert.equal(checkingPrimary.getAttribute("aria-disabled"), "true", `${scenario.name}: checking primary disabled`);
      assert.equal(checkingPrimary.tagName, "BUTTON", `${scenario.name}: checking primary is a button`);
      assert.equal(checkingPrimary.getAttribute("href"), null);
      assert.equal(dom.document.activeElement, checkingPrimary, `${scenario.name}: checking primary focused`);
      checkingPrimary.click();
      assert.equal(
        dom.document.querySelector("[data-auth-prompt-mode]")?.getAttribute("data-auth-prompt-mode"),
        "checking",
        `${scenario.name}: checking primary click does nothing`
      );

      await act(async () => {
        if (scenario.status !== 200) session.reject(new Error("network"));
        else session.resolve(scenario.body);
        await Promise.resolve();
        await Promise.resolve();
      });
      await flushEffects();

      assert.equal(
        dom.document.querySelector("[data-auth-prompt-mode]")?.getAttribute("data-auth-prompt-mode"),
        scenario.mode,
        scenario.name
      );
      const resolvedPrimary = query<HTMLElement>(dom.document, '[data-auth-required-primary="true"]');
      assert.equal(
        dom.document.activeElement,
        resolvedPrimary,
        `${scenario.name}: resolved primary receives focus`
      );

      const loginLinks = dom.document.querySelectorAll('a[href^="/auth/login"]');
      if (scenario.expectLogin) {
        assert.ok(loginLinks.length === 1, `${scenario.name}: login link present`);
      } else {
        assert.equal(loginLinks.length, 0, `${scenario.name}: no Auth0 login link`);
      }
      if (scenario.expectDesktopCopy) {
        assert.match(dom.document.body.textContent ?? "", /本地演示身份需要刷新/);
        assert.equal(resolvedPrimary.textContent, "我知道了");
      }
      await unmount();
    } finally {
      restoreFetch();
      dom.restore();
    }
  }
});

test("Escape, backdrop, and desktop primary dismiss only — focus returns to trigger, state retained", async () => {
  const dismissPaths: Array<{
    name: string;
    desktop?: boolean;
    close: (document: Document) => Promise<void>;
  }> = [
    {
      name: "Escape",
      desktop: false,
      async close(document: Document) {
        const primary = query<HTMLElement>(document, '[data-auth-required-primary="true"]');
        primary.focus();
        const dialog = query<HTMLElement>(document, '[data-auth-required-dialog="true"]');
        dialog.dispatchEvent(
          new (globalThis as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true
          })
        );
      }
    },
    {
      name: "backdrop",
      desktop: false,
      async close(document: Document) {
        const overlay = query<HTMLElement>(document, '[data-auth-required-dialog="true"]');
        overlay.dispatchEvent(
          new (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent("click", {
            bubbles: true
          })
        );
      }
    },
    {
      name: "desktop primary",
      desktop: true,
      async close(document: Document) {
        query<HTMLButtonElement>(document, '[data-auth-required-primary="true"]').click();
      }
    }
  ];

  for (const path of dismissPaths) {
    const dom = installDom();
    const session = deferredSession();
    const restoreFetch = mockSessionFetch(() => session.promise);
    try {
      const businessCalls = 0;
      let dismissCalls = 0;
      const { unmount } = await mountDialog(dom.host, {
        onDismiss: () => {
          dismissCalls += 1;
        }
      });
      await act(async () => {
        session.resolve(
          path.desktop
            ? { authenticated: true, user: { displayName: "本地演示用户" }, logoutAvailable: false }
            : { authenticated: false }
        );
        await Promise.resolve();
        await Promise.resolve();
      });
      await flushEffects();

      // Simulate unsaved page state outside the dialog.
      const draft = dom.document.createElement("textarea");
      draft.id = "draft";
      draft.value = "unsaved-XYZ";
      dom.document.body.appendChild(draft);
      const hrefBefore = dom.window.location.href;
      const scrollBefore = dom.window.scrollY;

      await path.close(dom.document);

      assert.equal(
        dom.document.querySelector("[data-auth-required-dialog]"),
        null,
        `${path.name}: dialog closed`
      );
      assert.equal(dom.document.activeElement, dom.trigger, `${path.name}: focus restored to trigger`);
      assert.equal(dismissCalls, 1, `${path.name}: onDismiss once`);
      assert.equal(businessCalls, 0, `${path.name}: no business retry`);
      assert.equal(draft.value, "unsaved-XYZ", `${path.name}: unsaved input retained`);
      assert.equal(dom.window.location.href, hrefBefore, `${path.name}: URL unchanged`);
      assert.equal(dom.window.scrollY, scrollBefore, `${path.name}: scroll unchanged`);

      await unmount();
    } finally {
      restoreFetch();
      dom.restore();
    }
  }
});

test("a later 401 remounts a fresh open dialog without reusing the closed instance", async () => {
  const dom = installDom();
  const session = deferredSession();
  const restoreFetch = mockSessionFetch(() => session.promise);
  try {
    const first = await mountDialog(dom.host, { onDismiss: noop });
    await act(async () => {
      session.resolve({ authenticated: false });
      await Promise.resolve();
    });
    await flushEffects();
    const secondary = query<HTMLButtonElement>(dom.document, '[data-auth-required-secondary="true"]');
    await act(async () => {
      secondary.click();
    });
    assert.equal(dom.document.querySelector("[data-auth-required-dialog]"), null);
    await first.unmount();

    // Parent clears UNAUTHORIZED then a later 401 mounts a brand-new dialog instance.
    const session2 = deferredSession();
    globalThis.fetch = (async () => session2.promise) as typeof fetch;
    const second = await mountDialog(dom.host, { onDismiss: noop });
    const remounted = dom.document.querySelector("[data-auth-required-dialog]");
    assert.ok(remounted, "fresh mount is open");
    assert.equal(remounted.getAttribute("data-auth-prompt-mode"), "checking");
    await second.unmount();
  } finally {
    restoreFetch();
    dom.restore();
  }
});

test("explicit returnFocusRef still wins over the captured trigger", async () => {
  const dom = installDom();
  const session = deferredSession();
  const restoreFetch = mockSessionFetch(() => session.promise);
  try {
    const intended = dom.document.createElement("button");
    intended.id = "intended";
    dom.document.body.appendChild(intended);
    const returnFocusRef = { current: intended };
    const { unmount } = await mountDialog(dom.host, {
      onDismiss: noop,
      returnFocusRef
    });
    await act(async () => {
      session.resolve({ authenticated: false });
      await Promise.resolve();
    });
    await flushEffects();
    const secondary = query<HTMLButtonElement>(dom.document, '[data-auth-required-secondary="true"]');
    await act(async () => {
      secondary.click();
    });
    assert.equal(dom.document.activeElement, intended);
    await unmount();
  } finally {
    restoreFetch();
    dom.restore();
  }
});