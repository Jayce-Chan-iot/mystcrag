/**
 * Scenario A — Identity lifecycle.
 *
 * Proves the ExternalIdentity ↔ internal User mapping through the REAL frontend +
 * synthetic provider + backend stack, asserting at the storage layer:
 *   A1/A2  first login provisions exactly one identity row bound to one internal user
 *   A3     a returning user gets the SAME internal actor (no duplicate user)
 *   A4     two CONCURRENT logins of the same identity never create a second mapping
 *          or an orphan user
 *   A5     the provider subject is never used directly as the business actorId
 */

import { expect, test } from "@playwright/test";

import { bffClient } from "../helpers/api";
import { loginAsUser, syntheticUser } from "../helpers/login";
import {
  externalIdentities,
  orphanUserCount,
  userCount
} from "../helpers/db";

/**
 * The backend provisions the ExternalIdentity mapping on its FIRST access-token
 * verification for an (issuer, subject) — a browser login alone never reaches the
 * backend. Every identity assertion therefore drives one real protected call first,
 * exactly like the first business request of a real user session would.
 */
async function driveFirstProtectedCall(page: import("@playwright/test").Page): Promise<void> {
  const response = await bffClient(page).listDesigns();
  expect(response.status, `the first protected call must succeed: ${response.body}`).toBe(200);
}

test.describe("A. identity lifecycle", () => {
  test("A1+A2 first login creates one identity mapping bound to one internal user", async ({ page }) => {
    const usersBefore = await userCount();

    await loginAsUser(page, syntheticUser("auth006-alice", "爱丽丝"));
    await driveFirstProtectedCall(page);

    const identities = await externalIdentities();
    const mine = identities.filter((row) => row.subject === "auth006-alice");
    expect(mine, "exactly one ExternalIdentity for the new subject").toHaveLength(1);

    const identity = mine[0]!;
    expect(identity.issuer).toBe("https://synthetic.auth006.internal/");
    expect(identity.user_id, "identity is bound to an internal user id").toBeTruthy();

    const usersAfter = await userCount();
    expect(usersAfter - usersBefore, "exactly one internal user was provisioned").toBe(1);
  });

  test("A3 returning login reuses the same internal actor", async ({ page }) => {
    const user = syntheticUser("auth006-bob", "鲍勃");
    await loginAsUser(page, user);
    await driveFirstProtectedCall(page);

    const first = (await externalIdentities()).find((row) => row.subject === "auth006-bob");
    expect(first).toBeDefined();
    const usersAfterFirst = await userCount();

    // A genuinely fresh browser context — no shared cookie state.
    const secondContext = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
    const secondPage = await secondContext.newPage();
    await loginAsUser(secondPage, user);
    await driveFirstProtectedCall(secondPage);
    await secondContext.close();

    const second = (await externalIdentities()).find((row) => row.subject === "auth006-bob");
    expect(second).toBeDefined();
    expect(second!.user_id, "the returning user keeps the same internal user id").toBe(first!.user_id);
    expect(await userCount(), "no second internal user was created").toBe(usersAfterFirst);
  });

  test("A4 concurrent first logins of one identity create a single mapping and no orphan", async ({ page }) => {
    const usersBefore = await userCount();
    const orphansBefore = await orphanUserCount();
    const user = syntheticUser("auth006-concurrent", "并发用户");

    const contextA = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
    const contextB = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await Promise.all([
        loginAsUser(pageA, user),
        loginAsUser(pageB, user)
      ]);
      // Concurrent first protected calls: both sessions race the first backend
      // verification of the same (issuer, subject).
      await Promise.all([
        driveFirstProtectedCall(pageA),
        driveFirstProtectedCall(pageB)
      ]);
    } finally {
      await contextA.close();
      await contextB.close();
    }

    const mappings = (await externalIdentities()).filter((row) => row.subject === "auth006-concurrent");
    expect(mappings, "only one ExternalIdentity mapping exists for the shared subject").toHaveLength(1);
    expect(await userCount() - usersBefore, "only one internal user was provisioned").toBe(1);
    // The seed ships a pre-existing user without an identity mapping, so orphaning is
    // asserted as a delta — the concurrent race must not add a NEW orphan.
    expect((await orphanUserCount()) - orphansBefore, "no orphan user without an identity mapping").toBe(0);
  });

  test("A5 provider subject never becomes the business actorId", async ({ page }) => {
    await loginAsUser(page, syntheticUser("auth006-carol", "卡罗尔"));
    await driveFirstProtectedCall(page);

    const identity = (await externalIdentities()).find((row) => row.subject === "auth006-carol");
    expect(identity).toBeDefined();
    expect(identity!.user_id, "internal user id must differ from the provider subject")
      .not.toBe("auth006-carol");
    expect(identity!.user_id).toMatch(/^[a-z0-9]{20,}$/);
    // No internal user row carries the raw subject as its id.
    const { withIsolatedDatabase } = await import("../helpers/db");
    const subjectAsUserId = await withIsolatedDatabase(async (query) => {
      const result = await query("SELECT COUNT(*)::int AS count FROM users WHERE id = $1", ["auth006-carol"]);
      return Number(result.rows[0]?.count ?? 0);
    });
    expect(subjectAsUserId).toBe(0);
  });
});
