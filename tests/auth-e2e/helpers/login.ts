/**
 * Real-browser login/logout flows for AUTH-006.
 *
 * Login always drives the genuine UI: click the header 登录 button, let the browser
 * walk the full OIDC Authorization Code + PKCE redirect chain through the synthetic
 * provider (via the CONNECT relay), and land back authenticated. Nothing is mocked
 * and no cookie is injected — the SDK sets the session cookie itself.
 */

import { expect, type Page } from "@playwright/test";

import { SESSION_COOKIE_NAME } from "./sdk-cookies";
import { setNextUser, type SyntheticUser } from "./provider-admin";
import { stackState } from "./run-state";

export type SessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
};

export async function readSessionCookie(page: Page): Promise<SessionCookie | null> {
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE_NAME);
  if (!session) return null;
  return {
    name: session.name,
    value: session.value,
    domain: session.domain,
    path: session.path,
    httpOnly: session.httpOnly,
    secure: session.secure,
    sameSite: session.sameSite
  };
}

export async function requireSessionCookie(page: Page): Promise<SessionCookie> {
  const cookie = await readSessionCookie(page);
  expect(cookie, "the SDK must have set the session cookie after callback").not.toBeNull();
  return cookie!;
}

/**
 * Replaces the browser's session cookie with a (forged) value while keeping the exact
 * attributes the SDK used. The forged cookie travels through the SAME browser jar,
 * BFF and SDK code path as a genuine one.
 */
export async function setSessionCookieValue(page: Page, value: string): Promise<void> {
  const current = await readSessionCookie(page);
  if (!current) {
    throw new Error("Cannot replace the session cookie: the browser holds none.");
  }
  const { urls } = await stackState();
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value,
      url: urls.frontend,
      httpOnly: current.httpOnly,
      secure: current.secure,
      sameSite: current.sameSite === "Strict" ? "Strict" : current.sameSite === "None" ? "None" : "Lax"
    }
  ]);
}

/**
 * Blocks Next.js router prefetch (Link background RSC GETs). With rolling sessions the
 * SDK re-issues the session cookie on EVERY page-route request, so any background
 * prefetch between two cookie reads changes the value. Tests that assert an exact
 * cookie value must run without that noise; aborting prefetch never weakens them —
 * the assertions still cover every request the test itself makes.
 */
export async function suppressRouterPrefetch(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    if (route.request().headers()["next-router-prefetch"] === "1") {
      return route.abort();
    }
    return route.continue();
  });
}

/** Full real login: click the UI button and wait for the authenticated header. */
export async function loginAsUser(
  page: Page,
  user: SyntheticUser,
  options: { startAt?: string } = {}
): Promise<SessionCookie> {
  await setNextUser(user);
  await page.goto(options.startAt ?? "/");
  await page.getByRole("button", { name: "登录" }).first().click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible({ timeout: 30_000 });
  return requireSessionCookie(page);
}

/** Full real logout: click 退出 in the header, follow the top-level POST + 303 chain. */
export async function logoutViaUi(page: Page): Promise<void> {
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("button", { name: "登录" }).first()).toBeVisible({ timeout: 30_000 });
}

/** A stable synthetic identity unique to this run (no real tenant, no real user). */
export function syntheticUser(sub: string, name: string): SyntheticUser {
  return {
    sub,
    name,
    email: `${sub}@auth006.internal`,
    emailVerified: true
  };
}
