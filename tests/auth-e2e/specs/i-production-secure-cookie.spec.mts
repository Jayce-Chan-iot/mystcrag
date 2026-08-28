/**
 * Scenario I — Positive production secure-cookie proof.
 *
 * The main scenarios (A–H) prove the session contract on the loopback HTTP test
 * origin, where the environment classification is "test" and the cookie is the
 * plain `mystcrag_session`. That proves everything EXCEPT the production cookie
 * shape itself. This scenario drives the SAME production build and the SAME
 * backend through a REAL HTTPS topology:
 *
 *   browser ──HTTPS──▶ app.mystcrag.auth006.internal:<appTls>  (TLS reverse proxy)
 *                            └─HTTP─▶ next start, NODE_ENV=production
 *   BFF ─────HTTPS──▶ api.mystcrag.auth006.internal:<apiTls>   (TLS reverse proxy)
 *                            └─HTTP─▶ backend
 *
 * with a valid multi-SAN certificate, synthetic DNS, the production environment
 * classification, and the production config validator fully engaged (HTTPS
 * non-loopback app origin). What is proven positively:
 *
 *   I1  the session cookie on a valid production HTTPS origin is EXACTLY
 *       __Host-mystcrag_session · Secure · HttpOnly · SameSite=Lax · Path=/ ·
 *       host-only (no Domain attribute — a __Host- prefix forbids one)
 *   I2  browser JavaScript cannot read the session credential (document.cookie,
 *       localStorage, sessionStorage), and no chunked session cookie exists
 *   I3  the authenticated session survives a fresh navigation (session restore)
 *       and a protected call completes through the production BFF → HTTPS →
 *       backend chain (Origin/CSRF + access-token verification included)
 *
 * No production source or configuration is modified for this proof: the topology is
 * built entirely from the run's own TLS material, DNS rewrites, and proxies.
 */

import { expect, test } from "@playwright/test";

import { stackState } from "../helpers/run-state";
import { loginAsUser, syntheticUser } from "../helpers/login";
import { PRODUCTION_SESSION_COOKIE_NAME } from "../helpers/sdk-cookies";

test.describe("I. production secure-cookie proof", () => {
  test("I1 the production HTTPS origin issues the exact __Host- session cookie and restores the session", async ({ browser }) => {
    const state = await stackState();
    const productionOrigin = new URL(state.urls.frontendProd);
    const productionHost = productionOrigin.hostname;

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      baseURL: state.urls.frontendProd
    });
    const page = await context.newPage();

    try {
      // --- Real login on the production HTTPS origin (OIDC + PKCE via the relay). ---
      const user = syntheticUser("auth006-i1", "己一");
      const cookie = await loginAsUser(page, user, { cookieName: PRODUCTION_SESSION_COOKIE_NAME });

      // --- The exact production cookie contract. ---
      expect(cookie.name, "production environment classification must use the __Host- prefix").toBe(
        "__Host-mystcrag_session"
      );
      expect(cookie.secure, "__Host- cookies must be Secure").toBe(true);
      expect(cookie.httpOnly, "the session cookie must be HttpOnly").toBe(true);
      expect(cookie.sameSite, "the session cookie must be SameSite=Lax").toBe("Lax");
      expect(cookie.path, "the session cookie must be scoped to Path=/").toBe("/");
      expect(cookie.domain, "a __Host- cookie must be host-only (no Domain attribute)").toBe(productionHost);
      expect(cookie.domain.startsWith("."), "a __Host- cookie must never carry a parent domain").toBe(false);

      // --- No chunked session cookies exist (small enough payload). ---
      const cookies = await context.cookies();
      const sessionChunks = cookies.filter(
        (entry) => entry.name.startsWith("__Host-mystcrag_session__") || entry.name === "mystcrag_session"
      );
      expect(sessionChunks, "no legacy-name or chunk session cookies on the production origin").toHaveLength(0);

      // --- Browser JavaScript cannot read the session credential. ---
      const documentCookie = await page.evaluate(() => document.cookie);
      expect(documentCookie).not.toContain("__Host-mystcrag_session");
      expect(documentCookie).not.toContain(cookie.value);

      const storageDump = await page.evaluate(() => {
        const dump: string[] = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          dump.push(localStorage.getItem(localStorage.key(i)!) ?? "");
        }
        for (let i = 0; i < sessionStorage.length; i += 1) {
          dump.push(sessionStorage.getItem(sessionStorage.key(i)!) ?? "");
        }
        return dump;
      });
      for (const entry of storageDump) {
        expect(entry, "the session credential must not be in web storage").not.toContain(cookie.value);
      }

      // --- Session restore: a fresh navigation in the same context stays authenticated. ---
      const page2 = await context.newPage();
      await page2.goto("/");
      await expect(page2.getByRole("button", { name: "退出登录" })).toBeVisible({ timeout: 30_000 });

      // --- The protected surface answers through the production BFF → HTTPS → backend chain. ---
      const session = await page2.evaluate(async () => {
        const response = await fetch("/auth/session", { headers: { accept: "application/json" } });
        return { status: response.status, body: await response.text() };
      });
      expect(session.status, `production /auth/session failed: ${session.body}`).toBe(200);
      expect(session.body).toContain("\"authenticated\":true");

      const designs = await page2.evaluate(async () => {
        const response = await fetch("/api/designs", { headers: { accept: "application/json" } });
        return { status: response.status, body: await response.text() };
      });
      expect(designs.status, `production /api/designs failed: ${designs.body}`).toBe(200);
      expect(designs.body).toContain("designs");

      // The session cookie the restored page holds is the same production cookie.
      const cookiesAfterRestore = await context.cookies();
      const restoredCookie = cookiesAfterRestore.find((entry) => entry.name === PRODUCTION_SESSION_COOKIE_NAME);
      expect(restoredCookie, "the restored session still uses the __Host- cookie").toBeDefined();
      expect(restoredCookie!.secure).toBe(true);
      expect(restoredCookie!.httpOnly).toBe(true);
      expect(restoredCookie!.sameSite).toBe("Lax");
      expect(restoredCookie!.path).toBe("/");
    } finally {
      await context.close();
    }
  });
});
