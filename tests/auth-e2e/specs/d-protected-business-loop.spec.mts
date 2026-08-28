/**
 * Scenario D — Protected business loop.
 *
 * ONE continuous real-user journey through the authenticated business surface:
 * login → generate a design → save it → reload the browser → the design is still
 * there → read it back → run a protected Tarot flow → place an order from the design
 * → see the order → log out via the real UI → the previously working protected
 * navigation now fails / demands re-authentication. No anonymous mock path is used
 * anywhere: every call goes through the BFF with the browser's session cookie.
 */

import { expect, test } from "@playwright/test";

import { bffClient, generateDesignRequest } from "../helpers/api";
import { loginAsUser, logoutViaUi, syntheticUser } from "../helpers/login";
import { createTarotSession, revealTarotSession, selectGuidanceCard } from "../helpers/tarot";

type DesignV1 = {
  designId: string;
  revision: number;
  currency: string;
  pricing: { pricingVersion: string; totalPriceMinor: number };
};

test.describe("D. protected business loop", () => {
  test("D1 the full authenticated loop works end to end and dies at logout", async ({ page }) => {
    const user = syntheticUser("auth006-d1", "丁一");
    const api = bffClient(page);

    // Login through the real UI.
    await loginAsUser(page, user);

    // Generate a design (protected backend call).
    const generate = await api.generateDesign(generateDesignRequest());
    expect(generate.status, `design generation failed: ${generate.body}`).toBe(200);
    const design = generate.json<{ design: DesignV1 }>().design;
    expect(design.designId).toBeTruthy();
    expect(design.revision).toBeGreaterThan(0);

    // Save it as the user's own design.
    const save = await api.saveDesign({
      requestId: `auth006-save-${crypto.randomUUID()}`,
      design
    });
    expect(save.status, `design save failed: ${save.body}`).toBe(200);
    expect(save.json<{ savedAt: string }>().savedAt).toBeTruthy();

    // The saved design appears in the user's own projection.
    const list = await api.listDesigns();
    expect(list.status).toBe(200);
    const listed = list.json<{ designs: Array<{ design: DesignV1; status: string }> }>().designs;
    expect(listed.map((entry) => entry.design.designId)).toContain(design.designId);

    // Reload the browser — authentication and data survive a cold navigation.
    await page.reload();
    await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible({ timeout: 30_000 });
    const listAfterReload = await api.listDesigns();
    expect(listAfterReload.status).toBe(200);
    expect(
      listAfterReload.json<{ designs: Array<{ design: DesignV1 }> }>().designs
        .map((entry) => entry.design.designId)
    ).toContain(design.designId);

    // Read the design back by id.
    const fetched = await api.getDesign(design.designId);
    expect(fetched.status).toBe(200);
    expect(fetched.json<DesignV1>().designId).toBe(design.designId);

    // Protected Tarot flow: create → select → reveal.
    const tarotSession = await createTarotSession(page);
    expect(tarotSession.sessionId).toBeTruthy();
    const selected = await selectGuidanceCard(page, tarotSession.sessionId);
    expect(selected.revision).toBeGreaterThan(tarotSession.revision);
    const reveal = await revealTarotSession(page, tarotSession.sessionId);
    expect(reveal.status, `tarot reveal failed: ${reveal.body}`).toBe(200);

    // Order smoke: create an order from the saved design, then see it in my orders.
    const order = await api.createOrder({
      requestId: `auth006-order-${crypto.randomUUID()}`,
      design,
      expectedRevision: design.revision,
      expectedPricingVersion: design.pricing.pricingVersion,
      expectedTotalPriceMinor: design.pricing.totalPriceMinor
    });
    expect(order.status, `order creation failed: ${order.body}`).toBe(200);
    const orderId = order.json<{ orderId: string; orderStatus: string }>().orderId;
    expect(orderId).toBeTruthy();

    const orders = await api.listOrders();
    expect(orders.status).toBe(200);
    expect(
      orders.json<{ orders: Array<{ orderId: string }> }>().orders.map((entry) => entry.orderId)
    ).toContain(orderId);

    // Log out through the real UI (top-level POST form + 303 chain through the provider).
    await logoutViaUi(page);

    // After logout the session is gone: the API answers 401 …
    const designsAfterLogout = await api.listDesigns();
    expect(designsAfterLogout.status).toBe(401);

    // … and the previously working protected navigation surfaces the auth failure.
    await page.goto("/profile");
    await expect(page.locator('[data-error-code="UNAUTHORIZED"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "登录" }).first()).toBeVisible();
  });
});
