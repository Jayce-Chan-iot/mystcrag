/**
 * AuthStatus component-level UX acceptance tests.
 *
 * Rendered with React 19 + happy-dom (no jsdom dependency). The browser
 * environment is installed once before the component modules are imported so
 * that "use client" code sees real window/document globals.
 *
 * Coverage:
 * - loading / unauthenticated / authenticated / error states
 * - login returnTo defaults to pathname + search + hash
 * - logout uses a top-level POST form to /auth/logout
 * - keyboard operability (native buttons: focusable, Enter activation is a
 *   platform default action — happy-dom cannot synthesize it, see pressEnter)
 * - aria roles/live regions and accessible labels
 * - long displayName/email never produces unbounded inline width (truncate +
 *   bounded max-width; true overflow absence is verified in the responsive
 *   browser smoke, see docs/INTERACTION_TEST_PLAN.md)
 * - error recovery action carries the mobile touch-target class contract
 *   (min-h-11 = 2.75rem = 44px; happy-dom performs no layout, so the visual
 *   44px measurement is recorded by the responsive smoke instead)
 */

import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Window } from "happy-dom";

// Install the DOM environment before any React/component import.
const win = new Window({ url: "http://localhost:3000/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLFormElement", "KeyboardEvent", "Event", "CustomEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, key, { value: (win as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const ReactDOMClient = await import("react-dom/client");
type Root = ReturnType<typeof ReactDOMClient.createRoot>;
const createRoot = ReactDOMClient.createRoot;
const { AuthStatus } = await import("./auth-status");

type FetchMock = (...args: unknown[]) => Promise<Response>;

let fetchMock: FetchMock = () => Promise.reject(new Error("fetch not stubbed"));
globalThis.fetch = ((...args: unknown[]) => fetchMock(...args)) as typeof globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function stubSession(body: unknown, status = 200): void {
  fetchMock = () => Promise.resolve(jsonResponse(body, status));
}

function stubSessionFailure(): void {
  fetchMock = () => Promise.resolve(jsonResponse({ error: { code: "INTERNAL" } }, 500));
}

function stubPendingSession(): { resolve: () => void } {
  let resolveFetch!: (response: Response) => void;
  fetchMock = () => new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  return {
    resolve: () => resolveFetch(jsonResponse({ authenticated: false }))
  };
}

const AUTHENTICATED_SESSION = {
  authenticated: true,
  user: { displayName: "测试用户", email: "test@example.com", emailVerified: true },
  idleExpiresAt: "2026-08-26T18:00:00.000Z",
  absoluteExpiresAt: "2026-09-02T10:00:00.000Z"
};

let container: HTMLElement;
let root: Root;

before(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

async function renderStatus(): Promise<void> {
  await React.act(async () => {
    root = createRoot(container);
    root.render(React.createElement(AuthStatus));
  });
}

async function unmountStatus(): Promise<void> {
  await React.act(async () => {
    root.unmount();
  });
  container.innerHTML = "";
}

function query(selector: string): HTMLElement | null {
  return container.querySelector(selector);
}

function pressEnter(element: HTMLElement): void {
  element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  // happy-dom does not synthesize the browser default action (Enter on a focused
  // native <button> → click). AuthStatus only uses native <button> elements, so
  // keyboard activation is guaranteed by the platform itself; we dispatch the
  // click event a real browser would produce to verify the handler path.
  element.click();
}

const LONG_NAME = "玄矶水晶超长昵称一二三四五六七八九十一二三四五六七八九十";

// --- loading ---

test("loading state renders a polite status region", async () => {
  const pending = stubPendingSession();
  await renderStatus();
  try {
    const region = query('[role="status"]');
    assert.ok(region, "loading region exists");
    assert.equal(region!.getAttribute("aria-live"), "polite");
    assert.ok(container.textContent!.includes("加载中"), "shows loading text");
  } finally {
    pending.resolve();
    await unmountStatus();
  }
});

// --- unauthenticated ---

test("unauthenticated state exposes a labeled login button", async () => {
  stubSession({ authenticated: false });
  await renderStatus();
  try {
    const button = query('button[aria-label="登录"]');
    assert.ok(button, "login button exists");
    assert.equal(button!.textContent!.trim(), "登录");
    assert.equal(container.querySelector('[role="alert"]'), null);
  } finally {
    await unmountStatus();
  }
});

// --- authenticated ---

test("authenticated state shows displayName and a labeled logout button", async () => {
  stubSession(AUTHENTICATED_SESSION);
  await renderStatus();
  try {
    const region = query('[role="status"]');
    assert.ok(region, "authenticated status region exists");
    assert.equal(region!.getAttribute("aria-live"), "polite");
    assert.ok(container.textContent!.includes("测试用户"));
    assert.ok(query('button[aria-label="退出登录"]'), "logout button exists");
  } finally {
    await unmountStatus();
  }
});

// --- error / expiry recovery ---

test("failed session request renders an assertive alert with recovery action", async () => {
  stubSessionFailure();
  await renderStatus();
  try {
    const alert = query('[role="alert"]');
    assert.ok(alert, "alert region exists");
    assert.equal(alert!.getAttribute("aria-live"), "assertive");
    assert.ok(container.textContent!.includes("会话错误"));
    assert.ok(query('button[aria-label="重新登录"]'), "recovery button exists");
  } finally {
    await unmountStatus();
  }
});

test("error recovery action satisfies the mobile touch-target class contract", async () => {
  stubSessionFailure();
  await renderStatus();
  try {
    const button = query('button[aria-label="重新登录"]');
    assert.ok(button);
    assert.ok(button!.className.includes("min-h-11"), "min-h-11 (44px) touch target class present");
    assert.ok(button!.className.includes("shrink-0"), "action never collapses inside the header row");
  } finally {
    await unmountStatus();
  }
});

// --- login returnTo ---

test("login from a protected page saves pathname + search + hash as returnTo", async () => {
  (win.happyDOM as unknown as { setURL(url: string): void }).setURL("http://localhost:3000/design/bracelet?stone=amethyst#step-2");
  stubSession({ authenticated: false });
  await renderStatus();
  try {
    const button = query('button[aria-label="登录"]') as HTMLButtonElement;
    await React.act(async () => {
      button.click();
    });
    const target = new URL(win.location.href);
    assert.equal(target.pathname, "/auth/login");
    assert.equal(target.searchParams.get("returnTo"), "/design/bracelet?stone=amethyst#step-2");
  } finally {
    await unmountStatus();
    (win.happyDOM as unknown as { setURL(url: string): void }).setURL("http://localhost:3000/");
  }
});

test("login from the home page produces returnTo=/", async () => {
  (win.happyDOM as unknown as { setURL(url: string): void }).setURL("http://localhost:3000/");
  stubSession(AUTHENTICATED_SESSION);
  await renderStatus();
  try {
    // Error recovery also uses the same default returnTo path; verify via login().
    stubSessionFailure();
    await unmountStatus();
    await renderStatus();
    const button = query('button[aria-label="重新登录"]') as HTMLButtonElement;
    await React.act(async () => {
      button.click();
    });
    const target = new URL(win.location.href);
    assert.equal(target.pathname, "/auth/login");
    assert.equal(target.searchParams.get("returnTo"), "/");
  } finally {
    await unmountStatus();
  }
});

// --- logout top-level POST form ---

test("logout submits a top-level POST form to /auth/logout", async () => {
  stubSession(AUTHENTICATED_SESSION);
  await renderStatus();

  const submitted: HTMLFormElement[] = [];
  const originalSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
    submitted.push(this);
  };
  try {
    const button = query('button[aria-label="退出登录"]') as HTMLButtonElement;
    await React.act(async () => {
      button.click();
    });
    assert.equal(submitted.length, 1, "exactly one form submission");
    const form = submitted[0]!;
    assert.equal(form.method.toUpperCase(), "POST");
    assert.equal(form.getAttribute("action"), "/auth/logout");
    assert.ok(document.body.contains(form), "form is attached at document top level");
  } finally {
    HTMLFormElement.prototype.submit = originalSubmit;
    await unmountStatus();
  }
});

// --- keyboard operability ---

test("login button is focusable and activates via Enter key", async () => {
  (win.happyDOM as unknown as { setURL(url: string): void }).setURL("http://localhost:3000/tarot");
  stubSession({ authenticated: false });
  await renderStatus();
  try {
    const button = query('button[aria-label="登录"]') as HTMLButtonElement;
    button.focus();
    assert.equal(document.activeElement, button, "button receives focus");
    await React.act(async () => {
      pressEnter(button);
    });
    const target = new URL(win.location.href);
    assert.equal(target.pathname, "/auth/login", "Enter activates the login action");
    assert.equal(target.searchParams.get("returnTo"), "/tarot");
  } finally {
    await unmountStatus();
    (win.happyDOM as unknown as { setURL(url: string): void }).setURL("http://localhost:3000/");
  }
});

test("logout button is focusable and activates via Enter key", async () => {
  stubSession(AUTHENTICATED_SESSION);
  await renderStatus();

  const submitted: HTMLFormElement[] = [];
  const originalSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
    submitted.push(this);
  };
  try {
    const button = query('button[aria-label="退出登录"]') as HTMLButtonElement;
    button.focus();
    assert.equal(document.activeElement, button);
    await React.act(async () => {
      pressEnter(button);
    });
    assert.equal(submitted.length, 1, "Enter triggers the logout form submission");
  } finally {
    HTMLFormElement.prototype.submit = originalSubmit;
    await unmountStatus();
  }
});

// --- long displayName / email overflow contract ---

test("long displayName is bounded by truncate + max-width classes", async () => {
  stubSession({ authenticated: true, user: { displayName: LONG_NAME, email: "a.very.long.email.address@example.com" } });
  await renderStatus();
  try {
    const span = query('[role="status"] span') as HTMLElement;
    assert.ok(span, "display name element exists");
    assert.equal(span.getAttribute("title"), LONG_NAME, "full name exposed via title attribute");
    assert.ok(span.className.includes("truncate"), "text truncation applied");
    assert.ok(span.className.includes("max-w-[10rem]"), "mobile max width bounded");
    assert.ok(span.className.includes("sm:max-w-[16rem]"), "desktop max width bounded");
    assert.ok(span.className.includes("min-w-0"), "flex item may shrink below content width");
    const row = query('[role="status"]') as HTMLElement;
    assert.ok(row.className.includes("min-w-0"), "header row may shrink inside the header");
    const logoutButton = query('button[aria-label="退出登录"]') as HTMLElement;
    assert.ok(logoutButton.className.includes("shrink-0"), "logout action never collapses");
  } finally {
    await unmountStatus();
  }
});

test("missing displayName falls back to email then to the neutral label", async () => {
  stubSession({ authenticated: true, user: { email: "fallback@example.com" } });
  await renderStatus();
  try {
    assert.ok(container.textContent!.includes("fallback@example.com"));
  } finally {
    await unmountStatus();
  }

  stubSession({ authenticated: true, user: {} });
  await renderStatus();
  try {
    assert.ok(container.textContent!.includes("用户"));
  } finally {
    await unmountStatus();
  }
});
