/**
 * Scenario C — Logout / expiry / revocation.
 *
 * Proves the full session termination surface through the real stack:
 *   C1  POST /auth/logout (right Origin) → 303 upstream logout, local session cleared
 *   C2  GET /auth/logout → 405, never mutates cookies
 *   C3  missing/wrong Origin on logout → 403, cookie untouched
 *   C4  repeated logout stays idempotent
 *   C5  idle-expired session → anonymous + cleared, protected API 401
 *   C6  absolute-expired session → rolling cannot resurrect it, protected API 401
 *   C7  refresh invalid_grant (revoked) → 401 + session cleared
 *   C8  provider token-endpoint outage → stable 500, session PRESERVED, recovery works
 *   C9  Backend 401 (unusable token) → session cleared
 *   C10 Backend 403 → session PRESERVED (no wrong logout)
 */

import { expect, test, type Page } from "@playwright/test";

import { bffClient, type ApiResponse } from "../helpers/api";
import { loginAsUser, readSessionCookie, setSessionCookieValue, suppressRouterPrefetch, syntheticUser } from "../helpers/login";
import { forgeSessionCookie } from "../helpers/sdk-cookies";
import { revokeRefreshTokens, setProviderOutage } from "../helpers/provider-admin";
import { stackState } from "../helpers/run-state";
import { waitForAccessTokenExpiry } from "../helpers/timing";

function errorEnvelopeOf(response: ApiResponse): { code?: string; message?: string } {
  const parsed = JSON.parse(response.body) as { error?: { code?: string; message?: string } };
  return parsed.error ?? {};
}

async function setCookiesFor(page: Page): Promise<string[]> {
  const response = await bffClient(page).session();
  return response.headers["set-cookie"] ?? [];
}

function clearingCookies(setCookies: string[]): string[] {
  return setCookies.filter((value) => /^mystcrag_session/.test(value) && /Max-Age=0/i.test(value));
}

test.describe("C. logout / expiry / revocation", () => {
  test("C1 POST /auth/logout with the app Origin clears the session and 303s upstream", async ({ page }) => {
    await suppressRouterPrefetch(page);
    await loginAsUser(page, syntheticUser("auth006-c1", "蔡一"));
    await page.waitForLoadState("networkidle");
    const api = bffClient(page);
    expect((await readSessionCookie(page))).not.toBeNull();

    const response = await api.logoutPost();
    expect(response.status).toBe(303);

    const state = await stackState();
    const location = response.headers["location"]?.[0] ?? "";
    expect(location.startsWith(state.urls.providerIssuer), "must redirect to the provider end-session endpoint").toBe(true);
    expect(location, "the logout URL must not embed token material").not.toMatch(/token|code=/i);

    const setCookies = response.headers["set-cookie"] ?? [];
    expect(clearingCookies(setCookies).length, "the session cookie must be cleared").toBeGreaterThan(0);

    const session = await api.session();
    const projection = JSON.parse(session.body) as { authenticated: boolean };
    expect(projection.authenticated).toBe(false);
  });

  test("C2 GET /auth/logout answers 405 and never touches cookies", async ({ page }) => {
    await suppressRouterPrefetch(page);
    await loginAsUser(page, syntheticUser("auth006-c2", "蔡二"));
    await page.waitForLoadState("networkidle");
    const api = bffClient(page);
    const cookieBefore = (await readSessionCookie(page))!.value;

    const response = await api.logoutGet();
    expect(response.status).toBe(405);
    expect((response.headers["allow"] ?? []).join(",")).toContain("POST");
    expect(errorEnvelopeOf(response).code).toBe("METHOD_NOT_ALLOWED");
    expect(response.headers["set-cookie"] ?? [], "405 must not write any cookie").toHaveLength(0);

    expect((await readSessionCookie(page))!.value, "the session cookie must be unchanged").toBe(cookieBefore);
    const session = await api.session();
    expect((JSON.parse(session.body) as { authenticated: boolean }).authenticated).toBe(true);
  });

  test("C3 logout without or with a wrong Origin is rejected 403 without cookie changes", async ({ page }) => {
    await suppressRouterPrefetch(page);
    await loginAsUser(page, syntheticUser("auth006-c3", "蔡三"));
    await page.waitForLoadState("networkidle");
    const api = bffClient(page);
    const cookieBefore = (await readSessionCookie(page))!.value;

    const missing = await api.logoutPost({ origin: "omit" });
    expect(missing.status).toBe(403);
    expect(errorEnvelopeOf(missing).code).toBe("FORBIDDEN");
    expect(missing.headers["set-cookie"] ?? []).toHaveLength(0);

    const wrong = await api.logoutPost({ origin: "https://attacker.auth006.internal" });
    expect(wrong.status).toBe(403);
    expect(errorEnvelopeOf(wrong).code).toBe("FORBIDDEN");
    expect(wrong.headers["set-cookie"] ?? []).toHaveLength(0);

    expect((await readSessionCookie(page))!.value, "a rejected logout must leave the session intact").toBe(cookieBefore);
    const session = await api.session();
    expect((JSON.parse(session.body) as { authenticated: boolean }).authenticated).toBe(true);
  });

  test("C4 repeated logout stays idempotent", async ({ page }) => {
    await suppressRouterPrefetch(page);
    await loginAsUser(page, syntheticUser("auth006-c4", "蔡四"));
    await page.waitForLoadState("networkidle");
    const api = bffClient(page);

    const first = await api.logoutPost();
    expect(first.status).toBe(303);

    const second = await api.logoutPost();
    expect(second.status, "a second logout must produce the same 303 sequence").toBe(303);

    const session = await api.session();
    expect((JSON.parse(session.body) as { authenticated: boolean }).authenticated).toBe(false);
  });

  test("C5 idle-expired session is anonymous, cleared, and the protected API answers 401", async ({ page }) => {
    await suppressRouterPrefetch(page);
    const cookie = await loginAsUser(page, syntheticUser("auth006-c5", "蔡五"));
    await page.waitForLoadState("networkidle");
    const api = bffClient(page);

    const now = Math.floor(Date.now() / 1000);
    const forged = await forgeSessionCookie(cookie.value, {
      expiresAt: now - 60,
      tokenExpiresAt: now - 60
    });
    await setSessionCookieValue(page, forged);

    const session = await api.session();
    expect(session.status).toBe(200);
    expect((JSON.parse(session.body) as { authenticated: boolean }).authenticated).toBe(false);
    expect(clearingCookies(session.headers["set-cookie"] ?? []).length, "the invalid cookie must be cleared").toBeGreaterThan(0);

    const designs = await api.listDesigns();
    expect(designs.status).toBe(401);
    expect(errorEnvelopeOf(designs).code).toBe("UNAUTHORIZED");
  });

  test("C6 absolute-expired session cannot be resurrected by rolling", async ({ page }) => {
    await suppressRouterPrefetch(page);
    const cookie = await loginAsUser(page, syntheticUser("auth006-c6", "蔡六"));
    await page.waitForLoadState("networkidle");
    const api = bffClient(page);

    // Decryptable cookie (JWE exp in the future) whose absolute anchor is 8 days old.
    const now = Math.floor(Date.now() / 1000);
    const forged = await forgeSessionCookie(cookie.value, {
      createdAt: now - 604800 - 3600,
      expiresAt: now + 3600,
      tokenExpiresAt: now + 3600
    });
    await setSessionCookieValue(page, forged);

    // First use: rolling writes Max-Age capped at 0 → the browser drops the cookie.
    await api.session();
    expect(await readSessionCookie(page), "the absolutely-expired cookie must not survive rolling").toBeNull();

    const session = await api.session();
    expect((JSON.parse(session.body) as { authenticated: boolean }).authenticated).toBe(false);

    const designs = await api.listDesigns();
    expect(designs.status).toBe(401);
  });

  test("C7 revoked refresh token (invalid_grant) clears the session", async ({ page }) => {
    const user = syntheticUser("auth006-c7", "蔡七");
    await loginAsUser(page, user);
    const api = bffClient(page);

    await revokeRefreshTokens(user.sub);
    await waitForAccessTokenExpiry();

    const designs = await api.listDesigns();
    expect(designs.status).toBe(401);
    expect(errorEnvelopeOf(designs).code).toBe("UNAUTHORIZED");

    const session = await api.session();
    expect((JSON.parse(session.body) as { authenticated: boolean }).authenticated).toBe(false);
    expect(await readSessionCookie(page), "the browser jar must no longer hold the session").toBeNull();
  });

  test("C8 provider token outage answers a stable 500 and preserves the session", async ({ page }) => {
    const user = syntheticUser("auth006-c8", "蔡八");
    await loginAsUser(page, user);
    const api = bffClient(page);

    try {
      await setProviderOutage("token");
      await waitForAccessTokenExpiry();

      const designs = await api.listDesigns();
      expect(designs.status, "an authorization-server outage must NOT be a 401 logout").toBe(500);
      expect(errorEnvelopeOf(designs).code).toBe("INTERNAL_ERROR");

      const cookie = await readSessionCookie(page);
      expect(cookie, "the still-decryptable session cookie must be preserved").not.toBeNull();

      const session = await api.session();
      expect((JSON.parse(session.body) as { authenticated: boolean }).authenticated).toBe(true);
    } finally {
      await setProviderOutage("off");
    }

    const recovered = await api.listDesigns();
    expect(recovered.status, "after the outage ends the same session must keep working").toBe(200);
  });

  test("C9 a Backend 401 clears the invalid session", async ({ page }) => {
    await suppressRouterPrefetch(page);
    const cookie = await loginAsUser(page, syntheticUser("auth006-c9", "蔡九"));
    await page.waitForLoadState("networkidle");
    const api = bffClient(page);

    // Session the SDK decrypts happily, carrying an access token the Backend must reject.
    const now = Math.floor(Date.now() / 1000);
    const forged = await forgeSessionCookie(cookie.value, {
      accessToken: "auth006-unusable-access-token",
      tokenExpiresAt: now + 3600
    });
    await setSessionCookieValue(page, forged);

    const designs = await api.listDesigns();
    expect(designs.status).toBe(401);
    expect(errorEnvelopeOf(designs).code).toBe("UNAUTHORIZED");
    expect(clearingCookies(designs.headers["set-cookie"] ?? []).length, "the invalid session must be cleared").toBeGreaterThan(0);

    const session = await api.session();
    expect((JSON.parse(session.body) as { authenticated: boolean }).authenticated).toBe(false);
  });

  test("C10 a Backend 403 does not log the user out", async ({ page }) => {
    await loginAsUser(page, syntheticUser("auth006-c10", "蔡十"));
    const api = bffClient(page);

    // Owner-scoped read of a design that does not exist → FORBIDDEN from the Backend.
    const forbidden = await api.getDesign("auth006-c10-missing-design");
    expect(forbidden.status).toBe(403);
    expect(errorEnvelopeOf(forbidden).code).toBe("FORBIDDEN");

    expect(await readSessionCookie(page), "a 403 must not clear the session").not.toBeNull();
    const session = await api.session();
    expect((JSON.parse(session.body) as { authenticated: boolean }).authenticated).toBe(true);

    const designs = await api.listDesigns();
    expect(designs.status, "the same session must still drive protected calls").toBe(200);
  });
});
