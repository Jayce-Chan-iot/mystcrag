/**
 * Scenario B — Session lifecycle.
 *
 * Proves the SDK cookie session contract through the real stack:
 *   B1  login establishes the encrypted HttpOnly cookie with the exact required attributes
 *   B2  a page refresh restores the authenticated state (no re-login)
 *   B3  rolling sessions extend the idle expiry on use (real SDK Set-Cookie)
 *   B4  rolling can NEVER extend the 7-day absolute expiry (forged createdAt anchor)
 *   B5  no token material ever reaches the browser surface
 *       (JS/HTML/RSC payload/localStorage/sessionStorage/IndexedDB/URL/document.cookie)
 */

import { expect, test, type Page } from "@playwright/test";

import { bffClient } from "../helpers/api";
import { loginAsUser, readSessionCookie, requireSessionCookie, suppressRouterPrefetch, syntheticUser } from "../helpers/login";
import { decryptSessionCookie } from "../helpers/sdk-cookies";

const INACTIVITY_SECONDS = 28800;
const ABSOLUTE_SECONDS = 604800;

type SessionProjection = {
  authenticated: boolean;
  user?: { displayName?: string; email?: string };
  idleExpiresAt?: string;
  absoluteExpiresAt?: string;
};

async function sessionProjection(page: Page): Promise<SessionProjection> {
  const response = await bffClient(page).session();
  expect(response.status, `/auth/session must answer 200 (got ${response.status} ${response.body})`).toBe(200);
  return response.json<SessionProjection>();
}

test.describe("B. session lifecycle", () => {
  test("B1 login sets the encrypted HttpOnly session cookie with the required attributes", async ({ page }) => {
    const cookie = await loginAsUser(page, syntheticUser("auth006-b1", "白一"));

    expect(cookie.name).toBe("mystcrag_session");
    expect(cookie.httpOnly, "the session cookie must be HttpOnly").toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(cookie.path).toBe("/");
    expect(cookie.secure, "loopback HTTP test origin must NOT set Secure (environment-matched flag)").toBe(false);

    // Host-only proof: the raw Set-Cookie written by the SDK carries no Domain attribute.
    const response = await bffClient(page).session();
    const setCookies = response.headers["set-cookie"] ?? [];
    const sessionSetCookie = setCookies.find((value) => value.startsWith("mystcrag_session="));
    expect(sessionSetCookie, "rolling must re-write the session cookie").toBeDefined();
    expect(sessionSetCookie!.toLowerCase()).not.toContain("domain=");

    // The value really is the SDK's encrypted JWE: it decrypts with the run session secret.
    const payload = await decryptSessionCookie(cookie.value);
    expect(payload, "the cookie must be the SDK-encrypted session, not plaintext").not.toBeNull();
    expect(payload!.user.sub).toBe("auth006-b1");
    expect(payload!.tokenSet.accessToken, "the session payload holds the BFF-held access token").toBeTruthy();
  });

  test("B2 page refresh restores the authenticated state without a new login", async ({ page }) => {
    const user = syntheticUser("auth006-b2", "白二");
    await loginAsUser(page, user);

    await page.reload();
    await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible({ timeout: 30_000 });

    const projection = await sessionProjection(page);
    expect(projection.authenticated).toBe(true);
    expect(projection.user?.displayName).toBe("白二");
  });

  test("B3 rolling session use extends the idle expiry", async ({ page }) => {
    await loginAsUser(page, syntheticUser("auth006-b3", "白三"));

    const first = await sessionProjection(page);
    expect(first.authenticated).toBe(true);
    expect(first.idleExpiresAt).toBeDefined();
    expect(first.absoluteExpiresAt).toBeDefined();

    const firstIdle = Date.parse(first.idleExpiresAt!) / 1000;
    const now = Math.floor(Date.now() / 1000);
    expect(firstIdle - now, "idle window must be ~8h").toBeGreaterThan(INACTIVITY_SECONDS - 120);
    expect(firstIdle - now, "idle window must not exceed 8h by much").toBeLessThan(INACTIVITY_SECONDS + 60);

    await page.waitForTimeout(2500);

    const second = await sessionProjection(page);
    const secondIdle = Date.parse(second.idleExpiresAt!) / 1000;
    expect(secondIdle, "rolling must move the idle expiry forward").toBeGreaterThan(firstIdle);

    // The rolling response really carries a fresh Max-Age on the session cookie.
    const response = await bffClient(page).session();
    const setCookies = response.headers["set-cookie"] ?? [];
    const sessionSetCookie = setCookies.find((value) => /^mystcrag_session(__\d+)?=/.test(value));
    expect(sessionSetCookie).toBeDefined();
    const maxAge = /Max-Age=(\d+)/i.exec(sessionSetCookie!);
    expect(maxAge, "rolling Set-Cookie must carry Max-Age").toBeDefined();
    expect(Number(maxAge![1])).toBeGreaterThan(INACTIVITY_SECONDS - 120);
  });

  test("B4 rolling can never extend the absolute expiry", async ({ page }) => {
    await suppressRouterPrefetch(page);
    const cookie = await loginAsUser(page, syntheticUser("auth006-b4", "白四"));
    await page.waitForLoadState("networkidle");
    const before = await requireSessionCookie(page);

    // Absolute anchor: created 7 days minus 1 hour ago → the absolute ceiling is in 1h.
    const now = Math.floor(Date.now() / 1000);
    const forged = await (await import("../helpers/sdk-cookies")).forgeSessionCookie(cookie.value, {
      createdAt: now - ABSOLUTE_SECONDS + 3600,
      expiresAt: now + 7200,
      tokenExpiresAt: now + 7200
    });
    const { setSessionCookieValue } = await import("../helpers/login");
    await setSessionCookieValue(page, forged);
    expect((await readSessionCookie(page))!.value).not.toBe(before.value);

    const projection = await sessionProjection(page);
    expect(projection.authenticated, "the still-decryptable session must project authenticated").toBe(true);

    const idle = Date.parse(projection.idleExpiresAt!) / 1000;
    const absolute = Date.parse(projection.absoluteExpiresAt!) / 1000;
    expect(idle - now, "rolling must cap the idle window at the 1h absolute remainder, not 8h").toBeLessThan(3600 + 120);
    expect(idle).toBeLessThanOrEqual(absolute + 5);
  });

  test("B5 no token material reaches any browser surface", async ({ page }) => {
    const cookie = await loginAsUser(page, syntheticUser("auth006-b5", "白五"));
    const payload = await decryptSessionCookie(cookie.value);
    expect(payload).not.toBeNull();

    const secrets = [
      payload!.tokenSet.accessToken ?? "",
      payload!.tokenSet.refreshToken ?? "",
      payload!.tokenSet.idToken ?? "",
      cookie.value
    ].filter((value) => value.length >= 16);

    // document.cookie: HttpOnly proof — the session cookie is invisible to page JavaScript.
    const documentCookie = await page.evaluate(() => document.cookie);
    expect(documentCookie).not.toContain("mystcrag_session");

    // HTML + RSC payload (page.content() includes the flight data script tags).
    const html = await page.content();
    for (const secret of secrets) {
      expect(html, "token/cookie value must not appear in HTML or RSC payload").not.toContain(secret);
    }
    expect(html, "the app must not expose a public access-token env var").not.toContain("MYSTCRAG_ACCESS_TOKEN");

    // localStorage / sessionStorage.
    const storage = await page.evaluate(() => {
      const dump: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)!;
        dump.push(`${key}=${localStorage.getItem(key) ?? ""}`);
      }
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i)!;
        dump.push(`${key}=${sessionStorage.getItem(key) ?? ""}`);
      }
      return dump;
    });
    for (const entry of storage) {
      for (const secret of secrets) {
        expect(entry, "token/cookie value must not appear in web storage").not.toContain(secret);
      }
    }

    // IndexedDB (best-effort exhaustive scan of every database/store/value).
    const indexedDbDump = await page.evaluate(async () => {
      const chunks: string[] = [];
      const databases = await indexedDB.databases();
      for (const { name } of databases) {
        if (!name) continue;
        await new Promise<void>((resolve) => {
          const openRequest = indexedDB.open(name);
          openRequest.onsuccess = () => {
            const db = openRequest.result;
            const storeNames = [...db.objectStoreNames];
            const tx = storeNames.length > 0 ? db.transaction(storeNames, "readonly") : null;
            for (const storeName of storeNames) {
              const getAll = tx!.objectStore(storeName).getAll();
              getAll.onsuccess = () => {
                chunks.push(JSON.stringify(getAll.result ?? null));
              };
            }
            (tx ?? { oncomplete: null }).oncomplete = () => {
              db.close();
              resolve();
            };
          };
          openRequest.onerror = () => resolve();
        });
      }
      return chunks;
    });
    for (const chunk of indexedDbDump) {
      for (const secret of secrets) {
        expect(chunk, "token/cookie value must not appear in IndexedDB").not.toContain(secret);
      }
    }

    // URL: the landing URL carries no code/state/token query.
    expect(new URL(page.url()).search, "the final URL must be clean of auth protocol parameters").toBe("");
    for (const secret of secrets) {
      expect(page.url(), "token/cookie value must not appear in the URL").not.toContain(secret);
    }
  });
});
