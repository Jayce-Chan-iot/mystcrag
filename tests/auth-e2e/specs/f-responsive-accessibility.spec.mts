/**
 * Scenario F — Responsive / accessibility.
 *
 * Real browser interaction at both required viewports (1440×900 desktop and
 * 375×812 mobile), never screenshots-only:
 *   F1  desktop: keyboard-only login AND logout (Tab + Enter through the whole OIDC
 *       chain), authenticated aria contract (role=status / aria-live=polite),
 *       no horizontal overflow in anonymous and authenticated states
 *   F2  mobile: real tap login/logout, login and logout touch targets ≥ 44×44 px,
 *       no horizontal overflow in anonymous and authenticated states
 *   F3  aria state machine through the real component: loading (role=status,
 *       aria-live=polite), error (role=alert, aria-live=assertive) with a
 *       keyboard-operable 重新登录 recovery action that really navigates to /auth/login
 *
 * Loading and error states are exercised by delaying/aborting ONLY the browser-side
 * /auth/session fetch (page.route) — the server stack itself is never mocked.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { syntheticUser } from "../helpers/login";
import { setNextUser } from "../helpers/provider-admin";

const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;
const MOBILE_VIEWPORT = { width: 375, height: 812 } as const;
const MIN_TOUCH_TARGET_PX = 44;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(
    overflow.scrollWidth,
    `the page must not scroll horizontally (${overflow.scrollWidth} > ${overflow.clientWidth})`
  ).toBeLessThanOrEqual(overflow.clientWidth);
}

/** Reaches a control with pure keyboard Tab navigation and proves it is focusable. */
async function focusByKeyboard(page: Page, control: Locator): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await control.evaluate((element) => document.activeElement === element)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("The primary auth action was never reached by keyboard Tab navigation");
}

async function expectTouchTargetAtLeast44px(control: Locator, label: string): Promise<void> {
  const box = await control.boundingBox();
  expect(box, `${label} must be rendered with a measurable box`).not.toBeNull();
  expect(box!.height, `${label} touch target height must be ≥ 44px`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  expect(box!.width, `${label} touch target width must be ≥ 44px`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
}

test.describe("F. responsive / accessibility", () => {
  test("F1 desktop 1440×900: keyboard-only login and logout, aria contract, no overflow", async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const page = await context.newPage();
    try {
      await setNextUser(syntheticUser("auth006-f1", "方一"));
      await page.goto("/");

      // Anonymous state: the primary auth action is visible and reachable.
      const login = page.getByRole("button", { name: "登录" }).first();
      await expect(login).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Keyboard-only login: Tab to the button, Enter to activate — the full OIDC
      // Authorization Code + PKCE chain runs from a keyboard-initiated interaction.
      await focusByKeyboard(page, login);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible({ timeout: 30_000 });

      // Authenticated aria contract: polite live region announcing the signed-in user.
      const status = page.getByRole("status").filter({ hasText: "方一" });
      await expect(status).toBeVisible();
      await expect(status).toHaveAttribute("aria-live", "polite");

      const logout = page.getByRole("button", { name: "退出登录" });
      await expect(logout).toBeVisible();
      await expect(logout).toHaveAttribute("aria-label", "退出登录");
      await expectNoHorizontalOverflow(page);

      // Keyboard-only logout: the top-level POST form is submitted from the keyboard.
      await focusByKeyboard(page, logout);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "登录" }).first()).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalOverflow(page);
    } finally {
      await context.close();
    }
  });

  test("F2 mobile 375×812: tap login/logout, 44px touch targets, no overflow", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE_VIEWPORT, hasTouch: true });
    const page = await context.newPage();
    try {
      await setNextUser(syntheticUser("auth006-f2", "方二"));
      await page.goto("/");

      // Anonymous state on the mobile header.
      const login = page.getByRole("button", { name: "登录" }).first();
      await expect(login).toBeVisible();
      await expectTouchTargetAtLeast44px(login, "the anonymous 登录 button");
      await expectNoHorizontalOverflow(page);

      // Real tap through the full OIDC chain.
      await login.tap();
      await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible({ timeout: 30_000 });

      const logout = page.getByRole("button", { name: "退出登录" });
      await expectTouchTargetAtLeast44px(logout, "the authenticated 退出 button");
      await expectNoHorizontalOverflow(page);

      await logout.tap();
      await expect(page.getByRole("button", { name: "登录" }).first()).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalOverflow(page);
    } finally {
      await context.close();
    }
  });

  test("F3 loading and error states expose the correct aria contract with a keyboard-operable recovery", async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const page = await context.newPage();
    try {
      // Loading state: hold the browser-side /auth/session fetch while the page renders.
      let releaseSession: (() => void) | undefined;
      await page.route("**/auth/session", async (route) => {
        await new Promise<void>((resolve) => {
          releaseSession = resolve;
        });
        await route.continue();
      });
      await page.goto("/");

      const loading = page.getByRole("status").filter({ hasText: "加载中" });
      await expect(loading, "the session fetch is in flight, so the loading state must render").toBeVisible();
      await expect(loading).toHaveAttribute("aria-live", "polite");

      releaseSession!();
      await expect(page.getByRole("button", { name: "登录" }).first()).toBeVisible({ timeout: 15_000 });
      await page.unroute("**/auth/session");

      // Error state: the browser-side session fetch fails (network abort).
      await page.route("**/auth/session", (route) => route.abort());
      await page.goto("/");

      // Next.js's route announcer also carries role="alert"; filter to the app's own
      // error region so the locator stays strict-mode-safe.
      const alert = page.getByRole("alert").filter({ hasText: "会话错误" });
      await expect(alert).toBeVisible();
      await expect(alert).toHaveAttribute("aria-live", "assertive");
      await expect(alert).toContainText("会话错误");

      const retry = page.getByRole("button", { name: "重新登录" });
      await expect(retry).toBeVisible();

      // The error recovery action is keyboard-operable and really starts a login.
      // /auth/login only exists as a server-side 303 hop in the OIDC chain, so the
      // proof is the chain's END state: after unrouting, keyboard-Enter on the
      // recovery button completes the real login and lands authenticated.
      await setNextUser(syntheticUser("auth006-f3", "方三"));
      await page.unroute("**/auth/session");
      await focusByKeyboard(page, retry);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });
});
