/**
 * Scenario E — Two-user isolation.
 *
 * Two genuinely independent browser contexts (separate cookie jars, separate
 * sessions) hold User A and User B. A owns a saved design and a Tarot session.
 * B must not be able to read, modify, save, clone, delete or order A's resources,
 * nor read A's Tarot session; missing and other-owner responses must be
 * indistinguishable; and no session/token material may cross from A's context
 * into B's. Both users must map to distinct internal actors.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { bffClient, generateDesignRequest } from "../helpers/api";
import { loginAsUser, readSessionCookie, syntheticUser } from "../helpers/login";
import { createTarotSession } from "../helpers/tarot";
import { externalIdentities } from "../helpers/db";
import { decryptSessionCookie } from "../helpers/sdk-cookies";

function errorOf(response: { body: string }): { code?: string } {
  return (JSON.parse(response.body) as { error?: { code?: string } }).error ?? {};
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

      // B cannot READ A's design — and the response is indistinguishable from missing.
      const readForeign = await apiB.getDesign(designA.designId);
      const readMissing = await apiB.getDesign("auth006-e-design-that-does-not-exist");
      expect(readForeign.status).toBe(403);
      expect(readMissing.status).toBe(403);
      expect(errorOf(readForeign).code, "other-owner and missing must leak no difference").toBe(errorOf(readMissing).code);
      expect(errorOf(readForeign).code).toBe("FORBIDDEN");

      // B cannot SAVE over A's design.
      const saveForeign = await apiB.saveDesign({
        requestId: `auth006-e-save2-${crypto.randomUUID()}`,
        design: generate.json<{ design: Record<string, unknown> }>().design
      });
      expect(saveForeign.status).toBe(403);

      // B cannot CLONE, UPDATE or DELETE A's design.
      const cloneForeign = await apiB.cloneDesign({
        requestId: `auth006-e-clone-${crypto.randomUUID()}`,
        designId: designA.designId,
        expectedRevision: designA.revision
      });
      expect(cloneForeign.status).toBe(403);

      const updateForeign = await apiB.updateDesign({
        requestId: `auth006-e-update-${crypto.randomUUID()}`,
        designId: designA.designId,
        expectedRevision: designA.revision,
        operations: [{ operation: "MOVE_COMPONENT", componentId: "auth006-e-nonexistent", targetPositionIndex: 0 }]
      });
      expect(updateForeign.status).toBe(403);

      const deleteForeign = await apiB.deleteDesign({
        requestId: `auth006-e-delete-${crypto.randomUUID()}`,
        designId: designA.designId,
        expectedRevision: designA.revision
      });
      expect(deleteForeign.status).toBe(403);

      // B cannot ORDER A's design.
      const orderForeign = await apiB.createOrder({
        requestId: `auth006-e-order-${crypto.randomUUID()}`,
        design: generate.json<{ design: Record<string, unknown> }>().design,
        expectedRevision: designA.revision,
        expectedPricingVersion: (generate.json<{ design: { pricing: { pricingVersion: string } } }>().design.pricing.pricingVersion),
        expectedTotalPriceMinor: generate.json<{ design: { pricing: { totalPriceMinor: number } } }>().design.pricing.totalPriceMinor
      });
      expect(orderForeign.status).toBe(403);

      // B cannot read or mutate A's Tarot session.
      const tarotForeign = await apiB.get(`/api/tarot/sessions/${encodeURIComponent(tarotA.sessionId)}`);
      expect(tarotForeign.status).toBe(403);
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
      expect(tarotSelectForeign.status).toBe(403);

      // --- A's resources are untouched after all of B's attempts. ---
      const listA = await apiA.listDesigns();
      expect(listA.status).toBe(200);
      const stillThere = listA.json<{ designs: Array<{ design: { designId: string; revision: number } }> }>().designs;
      const surviving = stillThere.find((entry) => entry.design.designId === designA.designId);
      expect(surviving, "A's design must still exist").toBeDefined();
      expect(surviving!.design.revision, "A's design revision must be unchanged").toBe(designA.revision);

      // A's Order survived B's attacks byte-for-byte (id, status, amount, design).
      const ordersAAfter = await apiA.listOrders();
      expect(ordersAAfter.status).toBe(200);
      const projectedAAfter = ordersAAfter.json<{ orders: OrderEntry[] }>().orders;
      const orderAAfter = projectedAAfter.find((entry) => entry.orderId === orderAJson.orderId);
      expect(orderAAfter, "A's order must still exist after B's attacks").toBeDefined();
      expect(orderAAfter!.status).toBe(orderAProjection!.status);
      expect(orderAAfter!.currency).toBe(orderAProjection!.currency);
      expect(orderAAfter!.totalAmountMinor).toBe(orderAProjection!.totalAmountMinor);
      expect(orderAAfter!.createdAt).toBe(orderAProjection!.createdAt);
      expect(orderAAfter!.design.designId).toBe(designA.designId);

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
