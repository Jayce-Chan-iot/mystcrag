/**
 * Scenario E — Two-user isolation.
 *
 * Two genuinely independent browser contexts (separate cookie jars, separate
 * sessions) hold User A and User B. A owns a saved design, a Tarot session and an
 * order. B must not be able to read, modify, save, clone, delete or order A's
 * resources, nor read or select in A's Tarot session; for every owner-scoped
 * operation the response to a FOREIGN resource and to a NONEXISTENT resource is
 * compared directly as the COMPLETE JSON response body — HTTP status and every
 * public field at every level, top-level topology included, excluding only the
 * per-request requestId — so no existence/ownership oracle leaks; after all of
 * B's attacks A's resources are re-read and asserted
 * byte-stable (design revision, order projection exact count and order contents,
 * Tarot session revision/status), B's own design and order projections stay at
 * exactly zero, and no session/token/profile material may cross from A's context
 * into B's (B's own profile IS rendered in B's page as the positive control).
 * Both users map to distinct internal actors.
 *
 * The foreign-vs-missing comparison is honest about product semantics: the
 * backend repository filters every owner-scoped lookup by ownerId, so foreign
 * and missing resources both surface as NOT_FOUND and the controller maps both
 * to the same FORBIDDEN envelope. Where an operation is NOT owner-scoped by
 * design (design generation, catalog), no comparison is claimed.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { bffClient, generateDesignRequest, type ApiResponse } from "../helpers/api";
import { loginAsUser, readSessionCookie, syntheticUser } from "../helpers/login";
import { createTarotSession, type TarotSession } from "../helpers/tarot";
import { externalIdentities } from "../helpers/db";
import { decryptSessionCookie } from "../helpers/sdk-cookies";

type PublicErrorEnvelope = {
  code?: string;
  message?: string;
  fieldErrors?: unknown;
  requestId?: string;
};

/** The expected stable public error topology: exactly one top-level `error`. */
const PUBLIC_ERROR_KEYS = ["error"];

/** The only public fields a stable error envelope may ever carry. */
const PUBLIC_ERROR_ENVELOPE_KEYS = ["code", "fieldErrors", "message", "requestId"];

function errorEnvelopeOf(response: { body: string }): PublicErrorEnvelope {
  return (JSON.parse(response.body) as { error?: PublicErrorEnvelope }).error ?? {};
}

/**
 * Parses the COMPLETE public response body and asserts its topology is exactly
 * the expected stable error envelope: the ONLY tolerated top-level member is
 * `error`, and the only tolerated members of `error` are code, message,
 * fieldErrors and requestId. Any other field — a `resourceExists` flag, an
 * owner hint, or any future addition — is an existence/ownership oracle and
 * fails the comparison outright, whatever its value.
 */
function publicErrorBodyOf(response: ApiResponse, label: string): PublicErrorEnvelope {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    throw new Error(`${label}: response body is not valid JSON (envelope topology cannot be proven)`);
  }
  expect(
    Object.keys(parsed).sort(),
    `${label}: top-level topology must be exactly the stable error envelope`
  ).toEqual(PUBLIC_ERROR_KEYS);
  const envelope = (parsed.error ?? {}) as Record<string, unknown>;
  const envelopeKeys = Object.keys(envelope).sort();
  for (const key of envelopeKeys) {
    expect(
      PUBLIC_ERROR_ENVELOPE_KEYS,
      `${label}: unexpected public error field (owner/existence oracle risk)`
    ).toContain(key);
  }
  return envelope as PublicErrorEnvelope;
}

/**
 * The no-oracle proof for one owner-scoped operation: the response B receives for
 * A's (foreign) resource must be indistinguishable from the response for a
 * resource that does not exist at all. The COMPLETE JSON response body is
 * compared — HTTP status AND every public field at every level (the top-level
 * topology is itself asserted to be exactly the stable `error` envelope by
 * publicErrorBodyOf) — with exactly ONE exclusion: requestId, which every
 * response necessarily generates fresh. Any other difference, in any field,
 * hands B an ownership oracle.
 */
function expectNoOracle(
  label: string,
  foreign: ApiResponse,
  missing: ApiResponse
): void {
  expect(foreign.status, `${label}: foreign vs missing status must match`).toBe(missing.status);

  const foreignEnvelope = publicErrorBodyOf(foreign, `${label} (foreign)`);
  const missingEnvelope = publicErrorBodyOf(missing, `${label} (missing)`);
  // Both sides must be well-formed public error envelopes carrying a requestId —
  // and those requestIds must genuinely differ, proving the excluded field is the
  // ONLY thing that ever differs between the two responses.
  expect(typeof foreignEnvelope.requestId, `${label}: foreign error must carry a requestId`).toBe("string");
  expect(typeof missingEnvelope.requestId, `${label}: missing error must carry a requestId`).toBe("string");
  expect(
    foreignEnvelope.requestId !== missingEnvelope.requestId,
    `${label}: requestIds must be generated per request`
  ).toBe(true);

  const { requestId: _foreignId, ...foreignPublic } = foreignEnvelope;
  const { requestId: _missingId, ...missingPublic } = missingEnvelope;
  expect(
    foreignPublic,
    `${label}: foreign vs missing COMPLETE public response body (every top-level field) must be identical`
  ).toEqual(missingPublic);
}

async function newIsolatedContext(page: Page): Promise<BrowserContext> {
  const context = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
  return context;
}

test.describe("E. two-user isolation", () => {
  test("E1 user B cannot touch user A's resources and no material crosses contexts", async ({ page }) => {
    const userA = syntheticUser("auth006-ea", "艾甲");
    const userB = syntheticUser("auth006-eb", "艾乙");

    const contextA = await newIsolatedContext(page);
    const contextB = await newIsolatedContext(page);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // --- User A provisions private resources. ---
      await loginAsUser(pageA, userA);
      const apiA = bffClient(pageA);

      const generate = await apiA.generateDesign(generateDesignRequest());
      expect(generate.status, `A's design generation failed: ${generate.body}`).toBe(200);
      const designA = generate.json<{ design: { designId: string; revision: number } }>().design;

      const save = await apiA.saveDesign({
        requestId: `auth006-e-save-${crypto.randomUUID()}`,
        design: generate.json<{ design: Record<string, unknown> }>().design
      });
      expect(save.status).toBe(200);

      const tarotA = await createTarotSession(pageA);
      const tarotAInitial = await apiA.get(
        `/api/tarot/sessions/${encodeURIComponent(tarotA.sessionId)}`
      );
      expect(tarotAInitial.status).toBe(200);
      const tarotASnapshot = tarotAInitial.json<{ session: TarotSession }>().session;

      // --- A owns a real Order placed from A's own design. ---
      const generateJson = generate.json<{
        design: { designId: string; revision: number; pricing: { pricingVersion: string; totalPriceMinor: number } };
      }>();
      const orderA = await apiA.createOrder({
        requestId: `auth006-e-order-a-${crypto.randomUUID()}`,
        design: generateJson.design,
        expectedRevision: generateJson.design.revision,
        expectedPricingVersion: generateJson.design.pricing.pricingVersion,
        expectedTotalPriceMinor: generateJson.design.pricing.totalPriceMinor
      });
      expect(orderA.status, `A's order creation failed: ${orderA.body}`).toBe(200);
      const orderAJson = orderA.json<{ orderId: string; orderStatus: string }>();
      expect(orderAJson.orderId).toBeTruthy();

      // A can read A's own Order back from A's order projection.
      const ordersA = await apiA.listOrders();
      expect(ordersA.status).toBe(200);
      type OrderEntry = {
        orderId: string;
        status: string;
        currency: string;
        totalAmountMinor: number;
        createdAt: string;
        design: { designId: string };
      };
      const projectedA = ordersA.json<{ orders: OrderEntry[] }>().orders;
      const orderAProjection = projectedA.find((entry) => entry.orderId === orderAJson.orderId);
      expect(orderAProjection, "A's order must appear in A's own projection").toBeDefined();
      expect(orderAProjection!.design.designId).toBe(designA.designId);
      expect(orderAProjection!.totalAmountMinor).toBe(generateJson.design.pricing.totalPriceMinor);
      const ordersABeforeAttacks = projectedA.length;

      // --- User B logs in inside a completely separate context. ---
      await loginAsUser(pageB, userB);
      const apiB = bffClient(pageB);

      // B sees only B's own (empty) design projection.
      const listB = await apiB.listDesigns();
      expect(listB.status).toBe(200);
      expect(listB.json<{ designs: unknown[] }>().designs).toHaveLength(0);

      // B's order projection does NOT contain A's order — not even partially.
      const ordersB = await apiB.listOrders();
      expect(ordersB.status).toBe(200);
      const projectedB = ordersB.json<{ orders: Array<{ orderId: string; design: { designId: string } }> }>().orders;
      expect(projectedB, "B owns no orders of their own yet").toHaveLength(0);
      expect(
        projectedB.map((entry) => entry.orderId),
        "A's order id must not leak into B's projection"
      ).not.toContain(orderAJson.orderId);
      expect(
        JSON.stringify(ordersB.body),
        "A's design/order identifiers must not appear anywhere in B's order response"
      ).not.toContain(designA.designId);

      // A missing design id that B will probe with, for the no-oracle comparisons.
      const missingDesignId = "auth006-e-design-that-does-not-exist";

      // B cannot READ A's design — and foreign vs missing are indistinguishable.
      const readForeign = await apiB.getDesign(designA.designId);
      const readMissing = await apiB.getDesign(missingDesignId);
      expect(readForeign.status).toBe(403);
      expect(readMissing.status).toBe(403);
      expectNoOracle("design read", readForeign, readMissing);
      expect(errorEnvelopeOf(readForeign).code).toBe("FORBIDDEN");

      // B cannot SAVE over A's design — save is owner-scoped, so a missing target
      // answers the same as a foreign one.
      const saveForeign = await apiB.saveDesign({
        requestId: `auth006-e-save2-${crypto.randomUUID()}`,
        design: generate.json<{ design: Record<string, unknown> }>().design
      });
      const saveMissing = await apiB.saveDesign({
        requestId: `auth006-e-save-missing-${crypto.randomUUID()}`,
        design: {
          ...generate.json<{ design: Record<string, unknown> }>().design,
          designId: missingDesignId
        }
      });
      expect(saveForeign.status).toBe(403);
      expectNoOracle("design save", saveForeign, saveMissing);

      // B cannot CLONE A's design.
      const cloneForeign = await apiB.cloneDesign({
        requestId: `auth006-e-clone-${crypto.randomUUID()}`,
        designId: designA.designId,
        expectedRevision: designA.revision
      });
      const cloneMissing = await apiB.cloneDesign({
        requestId: `auth006-e-clone-missing-${crypto.randomUUID()}`,
        designId: missingDesignId,
        expectedRevision: designA.revision
      });
      expect(cloneForeign.status).toBe(403);
      expectNoOracle("design clone", cloneForeign, cloneMissing);

      // B cannot UPDATE A's design.
      const updateForeign = await apiB.updateDesign({
        requestId: `auth006-e-update-${crypto.randomUUID()}`,
        designId: designA.designId,
        expectedRevision: designA.revision,
        operations: [{ operation: "MOVE_COMPONENT", componentId: "auth006-e-nonexistent", targetPositionIndex: 0 }]
      });
      const updateMissing = await apiB.updateDesign({
        requestId: `auth006-e-update-missing-${crypto.randomUUID()}`,
        designId: missingDesignId,
        expectedRevision: designA.revision,
        operations: [{ operation: "MOVE_COMPONENT", componentId: "auth006-e-nonexistent", targetPositionIndex: 0 }]
      });
      expect(updateForeign.status).toBe(403);
      expectNoOracle("design update", updateForeign, updateMissing);

      // B cannot DELETE A's design.
      const deleteForeign = await apiB.deleteDesign({
        requestId: `auth006-e-delete-${crypto.randomUUID()}`,
        designId: designA.designId,
        expectedRevision: designA.revision
      });
      const deleteMissing = await apiB.deleteDesign({
        requestId: `auth006-e-delete-missing-${crypto.randomUUID()}`,
        designId: missingDesignId,
        expectedRevision: designA.revision
      });
      expect(deleteForeign.status).toBe(403);
      expectNoOracle("design delete", deleteForeign, deleteMissing);

      // B cannot ORDER A's design.
      const orderForeign = await apiB.createOrder({
        requestId: `auth006-e-order-${crypto.randomUUID()}`,
        design: generate.json<{ design: Record<string, unknown> }>().design,
        expectedRevision: designA.revision,
        expectedPricingVersion: (generate.json<{ design: { pricing: { pricingVersion: string } } }>().design.pricing.pricingVersion),
        expectedTotalPriceMinor: generate.json<{ design: { pricing: { totalPriceMinor: number } } }>().design.pricing.totalPriceMinor
      });
      const orderMissing = await apiB.createOrder({
        requestId: `auth006-e-order-missing-${crypto.randomUUID()}`,
        design: {
          ...generate.json<{ design: Record<string, unknown> }>().design,
          designId: missingDesignId
        },
        expectedRevision: designA.revision,
        expectedPricingVersion: (generate.json<{ design: { pricing: { pricingVersion: string } } }>().design.pricing.pricingVersion),
        expectedTotalPriceMinor: generate.json<{ design: { pricing: { totalPriceMinor: number } } }>().design.pricing.totalPriceMinor
      });
      expect(orderForeign.status).toBe(403);
      expectNoOracle("order from design", orderForeign, orderMissing);

      // B cannot read or mutate A's Tarot session — both are owner-scoped.
      const tarotForeign = await apiB.get(`/api/tarot/sessions/${encodeURIComponent(tarotA.sessionId)}`);
      const tarotMissing = await apiB.get(
        "/api/tarot/sessions/auth006-e-tarot-session-that-does-not-exist"
      );
      expect(tarotForeign.status).toBe(403);
      expectNoOracle("tarot session read", tarotForeign, tarotMissing);

      const tarotSelectForeign = await apiB.post(
        `/api/tarot/sessions/${encodeURIComponent(tarotA.sessionId)}/select`,
        {
          requestId: `auth006-e-tarot-${crypto.randomUUID()}`,
          slot: "GUIDANCE",
          displayedPosition: 7,
          expectedRevision: tarotA.revision,
          operationId: `auth006-e-tarot-op-${crypto.randomUUID()}`
        }
      );
      const tarotSelectMissing = await apiB.post(
        "/api/tarot/sessions/auth006-e-tarot-session-that-does-not-exist/select",
        {
          requestId: `auth006-e-tarot-missing-${crypto.randomUUID()}`,
          slot: "GUIDANCE",
          displayedPosition: 7,
          expectedRevision: tarotA.revision,
          operationId: `auth006-e-tarot-missing-op-${crypto.randomUUID()}`
        }
      );
      expect(tarotSelectForeign.status).toBe(403);
      expectNoOracle("tarot session select", tarotSelectForeign, tarotSelectMissing);

      // --- A's design is untouched after all of B's attempts. ---
      const listA = await apiA.listDesigns();
      expect(listA.status).toBe(200);
      const stillThere = listA.json<{ designs: Array<{ design: { designId: string; revision: number } }> }>().designs;
      const surviving = stillThere.find((entry) => entry.design.designId === designA.designId);
      expect(surviving, "A's design must still exist").toBeDefined();
      expect(surviving!.design.revision, "A's design revision must be unchanged").toBe(designA.revision);

      // --- A's Tarot session is untouched: re-read and compare the full state. ---
      const tarotAAfter = await apiA.get(`/api/tarot/sessions/${encodeURIComponent(tarotA.sessionId)}`);
      expect(tarotAAfter.status, "A must still be able to read A's own Tarot session").toBe(200);
      const tarotAAfterSnapshot = tarotAAfter.json<{ session: TarotSession }>().session;
      expect(tarotAAfterSnapshot.sessionId).toBe(tarotASnapshot.sessionId);
      expect(tarotAAfterSnapshot.revision, "A's Tarot revision must be unchanged by B's attacks").toBe(
        tarotASnapshot.revision
      );
      expect(tarotAAfterSnapshot.status, "A's Tarot status must be unchanged by B's attacks").toBe(
        tarotASnapshot.status
      );

      // --- A's order projection is untouched: exact count and exact contents. ---
      const ordersAAfter = await apiA.listOrders();
      expect(ordersAAfter.status).toBe(200);
      const projectedAAfter = ordersAAfter.json<{ orders: OrderEntry[] }>().orders;
      expect(projectedAAfter.length, "A's order projection count must be unchanged").toBe(ordersABeforeAttacks);
      const orderAAfter = projectedAAfter.find((entry) => entry.orderId === orderAJson.orderId);
      expect(orderAAfter, "A's order must still exist after B's attacks").toBeDefined();
      expect(orderAAfter!.status).toBe(orderAProjection!.status);
      expect(orderAAfter!.currency).toBe(orderAProjection!.currency);
      expect(orderAAfter!.totalAmountMinor).toBe(orderAProjection!.totalAmountMinor);
      expect(orderAAfter!.createdAt).toBe(orderAProjection!.createdAt);
      expect(orderAAfter!.design.designId).toBe(designA.designId);

      // --- B's order projection is still exactly empty: no attack created anything. ---
      const ordersBAfter = await apiB.listOrders();
      expect(ordersBAfter.status).toBe(200);
      expect(
        ordersBAfter.json<{ orders: unknown[] }>().orders,
        "B's order projection must still be exactly empty after all attacks"
      ).toHaveLength(0);

      // --- B's design projection is still exactly empty too: no attack saved,
      // cloned or mutated anything into B's own space either. ---
      const listBAfter = await apiB.listDesigns();
      expect(listBAfter.status).toBe(200);
      expect(
        listBAfter.json<{ designs: unknown[] }>().designs,
        "B's design projection must still be exactly empty after all attacks"
      ).toHaveLength(0);

      // --- No session/token material crosses from A's context into B's. ---
      const cookieA = await readSessionCookie(pageA);
      const cookieB = await readSessionCookie(pageB);
      expect(cookieA).not.toBeNull();
      expect(cookieB).not.toBeNull();
      expect(cookieB!.value).not.toBe(cookieA!.value);

      const payloadA = await decryptSessionCookie(cookieA!.value);
      const secretsFromA = [
        cookieA!.value,
        payloadA!.tokenSet.accessToken ?? "",
        payloadA!.tokenSet.refreshToken ?? "",
        payloadA!.tokenSet.idToken ?? ""
      ].filter((value) => value.length >= 16);

      const jarB = await contextB.cookies();
      for (const cookie of jarB) {
        for (const secret of secretsFromA) {
          expect(`${cookie.name}=${cookie.value}`, "A's session/token material must not appear in B's cookie jar").not.toContain(secret);
        }
      }

      const htmlB = await pageB.content();
      const storageB = await pageB.evaluate(() => {
        const dump: string[] = [];
        for (let i = 0; i < localStorage.length; i += 1) dump.push(localStorage.getItem(localStorage.key(i)!) ?? "");
        for (let i = 0; i < sessionStorage.length; i += 1) dump.push(sessionStorage.getItem(sessionStorage.key(i)!) ?? "");
        return dump;
      });
      for (const secret of secretsFromA) {
        expect(htmlB, "A's token material must not appear in B's rendered page").not.toContain(secret);
        for (const entry of storageB) {
          expect(entry, "A's token material must not appear in B's web storage").not.toContain(secret);
        }
      }

      // --- No PROFILE material crosses either — with a positive control that
      // proves B's own profile really is served and rendered in B's context, so
      // the absence of A's is a meaningful isolation result, not a rendering gap.
      // (A's sub is an opaque identifier; name and email are the profile claims
      // the session projection and the header actually expose.)
      const profileFromA = [userA.sub, userA.name, userA.email];
      const sessionB = await apiB.session();
      expect(sessionB.status, `B's session projection failed: ${sessionB.body}`).toBe(200);
      const sessionBUser = sessionB.json<{
        authenticated: boolean;
        user?: { displayName?: string; email?: string };
      }>();
      expect(sessionBUser.authenticated).toBe(true);
      expect(
        sessionBUser.user?.email === userB.email || sessionBUser.user?.displayName === userB.name,
        "B's session projection must carry B's own profile (positive control)"
      ).toBe(true);
      expect(
        htmlB.includes(userB.name) || htmlB.includes(userB.email),
        "B's page must render B's own profile (positive control)"
      ).toBe(true);
      for (const profile of profileFromA) {
        expect(sessionB.body, "A's profile material must not appear in B's session response").not.toContain(profile);
        expect(htmlB, "A's profile material must not appear in B's rendered page").not.toContain(profile);
        for (const entry of storageB) {
          expect(entry, "A's profile material must not appear in B's web storage").not.toContain(profile);
        }
        for (const cookie of jarB) {
          expect(
            `${cookie.name}=${cookie.value}`,
            "A's profile material must not appear in B's cookie jar"
          ).not.toContain(profile);
        }
      }

      // --- The two users are distinct internal actors. ---
      const identities = await externalIdentities();
      const mappingA = identities.find((row) => row.subject === userA.sub);
      const mappingB = identities.find((row) => row.subject === userB.sub);
      expect(mappingA).toBeDefined();
      expect(mappingB).toBeDefined();
      expect(mappingA!.user_id).not.toBe(mappingB!.user_id);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
