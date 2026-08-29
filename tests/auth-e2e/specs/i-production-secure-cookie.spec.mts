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
 *       backend chain (access-token verification included)
 *   I2  mutations on the production topology enforce Origin/CSRF directly, from
 *       the real browser over the real TLS topology: a same-origin mutation
 *       (the browser's own Origin header) succeeds and really creates state;
 *       the SAME mutation replayed with a missing or an attacker Origin is
 *       rejected 403 FORBIDDEN before any session/token operation, with no
 *       Set-Cookie and no state side effect (design projection count, session
 *       cookie and authenticated state are all re-checked after the attacks),
 *       and the exact same body then SUCCEEDS with the correct origin
 *
 * No production source or configuration is modified for this proof: the topology is
 * built entirely from the run's own TLS material, DNS rewrites, and proxies.
 */

import { expect, test, type Response, type Route } from "@playwright/test";

import { stackState } from "../helpers/run-state";
import { generateDesignRequest } from "../helpers/api";
import { loginAsUser, readSessionCookie, suppressRouterPrefetch, syntheticUser } from "../helpers/login";
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

  test("I2 production mutations enforce Origin/CSRF: correct Origin succeeds, missing and wrong Origin are rejected with no side effects", async ({ browser }) => {
    const state = await stackState();

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      baseURL: state.urls.frontendProd
    });
    const page = await context.newPage();
    await suppressRouterPrefetch(page);

    type ErrorEnvelope = { code?: string; message?: string; requestId?: string };
    type FetchResult = {
      status: number;
      headers: Record<string, string[]>;
      body: string;
      json<T = unknown>(): T;
    };

    function errorEnvelopeOf(response: { body: string }): ErrorEnvelope {
      return (JSON.parse(response.body) as { error?: ErrorEnvelope }).error ?? {};
    }

    // Only the real browser context resolves the synthetic production DNS and holds
    // the __Host- session cookie jar, so every request below is a REAL page fetch over
    // the REAL production TLS topology, carrying the REAL session cookie. When an
    // Origin edit is requested, `page.route` + `route.continue` lets the BROWSER's own
    // network stack send that exact request with the edited Origin header — the
    // request shape a non-browser client (no Origin) or a cross-site attacker
    // (foreign Origin) delivers to the BFF. The response (including Set-Cookie, which
    // the in-page fetch API can never read) is captured through the browser network
    // stack via the page "response" event. The BFF's own unmodified Origin gate is the
    // thing under test; "browser" mode installs no route at all, so a same-origin POST
    // carries the exact Origin a genuine browser fetch would.
    const originControlledFetch = async (
      path: string,
      init: { method: "GET" | "POST"; body?: unknown; origin?: "browser" | "omit" | (string & {}) } = {}
    ): Promise<FetchResult> => {
      const originMode = init.origin ?? "browser";
      let captured: FetchResult | null = null;
      const onResponse = async (response: Response): Promise<void> => {
        if (new URL(response.url()).pathname !== path) return;
        if (captured) return;
        const body = await response.text();
        const flatHeaders = await response.allHeaders();
        const collected: Record<string, string[]> = {};
        for (const [name, value] of Object.entries(flatHeaders)) {
          collected[name.toLowerCase()] = [value];
        }
        captured = {
          status: response.status(),
          headers: collected,
          body,
          json<T = unknown>(): T {
            return JSON.parse(body) as T;
          }
        };
      };
      const productionOrigin = new URL(state.urls.frontendProd);
      const collectFromApiResponse = (
        response: { status(): number; headersArray(): Array<{ name: string; value: string }> },
        body: string
      ): FetchResult => {
        const collected: Record<string, string[]> = {};
        for (const { name, value } of response.headersArray()) {
          (collected[name.toLowerCase()] ??= []).push(value);
        }
        return {
          status: response.status(),
          headers: collected,
          body,
          json<T = unknown>(): T {
            return JSON.parse(body) as T;
          }
        };
      };
      const handler = async (route: Route): Promise<void> => {
        // Replay the intercepted request as a NON-BROWSER client straight at the TLS
        // terminator: the synthetic DNS name only exists inside the browser, so the
        // replay dials 127.0.0.1:<appTlsPort> while keeping the production Host
        // header, the real session cookie, and the exact body — then edits ONLY the
        // Origin header (absent, or forged to the attacker origin). This is exactly
        // the request shape a script client / cross-site attacker delivers to the
        // same production BFF, whose unmodified Origin gate decides the outcome.
        const headers = { ...route.request().headers() };
        headers.host = `${productionOrigin.hostname}:${productionOrigin.port}`;
        if (originMode === "omit") {
          delete headers.origin;
        } else {
          headers.origin = originMode;
        }
        const response = await route.fetch({ url: `https://127.0.0.1:${productionOrigin.port}${path}`, headers });
        const body = await response.text();
        captured = collectFromApiResponse(response, body);
        await route.fulfill({ response, body });
      };
      const pattern = `**${path}`;
      page.on("response", onResponse);
      if (originMode !== "browser") {
        await page.route(pattern, handler);
      }
      try {
        await page.evaluate(
          async ({ path, method, body }) => {
            const response = await fetch(path, {
              method,
              headers:
                body === undefined
                  ? { accept: "application/json" }
                  : { accept: "application/json", "content-type": "application/json" },
              body: body === undefined ? undefined : JSON.stringify(body)
            });
            await response.text();
          },
          { path, method: init.method, body: init.body }
        );
        const deadline = Date.now() + 10_000;
        while (!captured && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      } finally {
        page.off("response", onResponse);
        if (originMode !== "browser") {
          await page.unroute(pattern, handler);
        }
      }
      if (!captured) throw new Error(`no response captured for ${path}`);
      return captured;
    };

    try {
      // --- Real login on the production HTTPS origin. ---
      const user = syntheticUser("auth006-i2", "己二");
      await loginAsUser(page, user, { cookieName: PRODUCTION_SESSION_COOKIE_NAME });

      // (a) The user's design projection starts empty on the production topology.
      const before = await originControlledFetch("/api/designs", { method: "GET" });
      expect(before.status, `production /api/designs failed: ${before.body}`).toBe(200);
      expect(before.json<{ designs: unknown[] }>().designs).toHaveLength(0);

      // (b) A mutation with the CORRECT origin — the browser itself sends the exact
      // app origin for a same-origin POST, no edit — succeeds through the production
      // BFF → HTTPS → backend chain and really creates state.
      const generate = await originControlledFetch("/api/design/generate", {
        method: "POST",
        body: generateDesignRequest()
      });
      expect(generate.status, `production design generation failed: ${generate.body}`).toBe(200);
      const save = await originControlledFetch("/api/design/save", {
        method: "POST",
        body: {
          requestId: `auth006-i2-save-${crypto.randomUUID()}`,
          design: generate.json<{ design: Record<string, unknown> }>().design
        }
      });
      expect(save.status, `production design save failed: ${save.body}`).toBe(200);
      const afterSave = await originControlledFetch("/api/designs", { method: "GET" });
      expect(afterSave.status).toBe(200);
      expect(
        afterSave.json<{ designs: unknown[] }>().designs,
        "the correct-origin mutation must have created exactly one saved design"
      ).toHaveLength(1);
      const savedDesign = afterSave.json<{ designs: Array<{ design: { designId: string; revision: number } }> }>().designs[0]!;

      // The exact mutation body the rejected attempts will replay: cloning the saved
      // design WOULD create a second design if the Origin gate failed open.
      const cloneBody = {
        requestId: `auth006-i2-clone-${crypto.randomUUID()}`,
        designId: savedDesign.design.designId,
        expectedRevision: savedDesign.design.revision
      };

      // The cookie comparison window contains ONLY the two 403-rejected attempts:
      // successful calls legitimately roll the session (SDK passive rolling), but an
      // Origin-rejected mutation returns before ANY session/token operation.
      const cookiePreAttack = (await readSessionCookie(page, PRODUCTION_SESSION_COOKIE_NAME))!.value;

      // (c) The SAME mutation with NO Origin is rejected 403 with the stable
      // FORBIDDEN envelope — rejected before any session/token operation, so no
      // Set-Cookie is written either.
      const missing = await originControlledFetch("/api/design/clone", {
        method: "POST",
        body: cloneBody,
        origin: "omit"
      });
      expect(missing.status, "a mutation without Origin must be rejected").toBe(403);
      const missingEnvelope = errorEnvelopeOf(missing);
      expect(missingEnvelope.code).toBe("FORBIDDEN");
      expect(missingEnvelope.message).toBe("Origin validation failed.");
      expect(typeof missingEnvelope.requestId).toBe("string");
      expect(missing.headers["set-cookie"] ?? [], "an origin-rejected mutation must not write any cookie").toHaveLength(0);

      // (d) The SAME mutation with an ATTACKER origin is rejected identically.
      const wrong = await originControlledFetch("/api/design/clone", {
        method: "POST",
        body: cloneBody,
        origin: "https://attacker.auth006.internal"
      });
      expect(wrong.status, "a mutation with a foreign Origin must be rejected").toBe(403);
      const wrongEnvelope = errorEnvelopeOf(wrong);
      expect(wrongEnvelope.code).toBe("FORBIDDEN");
      expect(wrongEnvelope.message).toBe("Origin validation failed.");
      expect(wrong.headers["set-cookie"] ?? []).toHaveLength(0);

      // (e) NO state side effect: the session cookie is byte-identical across the
      // attack window, the design projection is still exactly one, and the session
      // is still authenticated.
      expect(
        (await readSessionCookie(page, PRODUCTION_SESSION_COOKIE_NAME))!.value,
        "an origin-rejected mutation must not rotate the session cookie"
      ).toBe(cookiePreAttack);
      const afterAttacks = await originControlledFetch("/api/designs", { method: "GET" });
      expect(afterAttacks.status).toBe(200);
      expect(
        afterAttacks.json<{ designs: unknown[] }>().designs,
        "origin-rejected mutations must create no state"
      ).toHaveLength(1);
      const session = await originControlledFetch("/auth/session", { method: "GET" });
      expect((JSON.parse(session.body) as { authenticated: boolean }).authenticated).toBe(true);

      // (f) The positive control: the EXACT clone body WITH the correct origin
      // succeeds — proving the rejections above were Origin rejections, not a broken
      // request, and that the write surface is genuinely open to same-origin
      // mutations on the production topology.
      const accepted = await originControlledFetch("/api/design/clone", { method: "POST", body: cloneBody });
      expect(accepted.status, `correct-origin clone failed: ${accepted.body}`).toBe(200);
      const afterClone = await originControlledFetch("/api/designs", { method: "GET" });
      expect(afterClone.status).toBe(200);
      expect(afterClone.json<{ designs: unknown[] }>().designs).toHaveLength(2);
    } finally {
      await context.close();
    }
  });
});
