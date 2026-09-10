import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "./app.js";
import type { AuthProvider } from "./auth/auth-provider.js";

test("health endpoint reports a ready service", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  await app.close();
});

test("asset import management fails closed without its independent key", () => {
  assert.throws(
    () =>
      createApp({
        assetImportEnabled: true,
        assetImportService: {} as never,
        productAssetService: {} as never
      } as never),
    /assetAdminApiKey/
  );
});

test("asset import management is disabled unless the feature flag is exactly true", async () => {
  const app = createApp({
    assetImportEnabled: false,
    assetImportService: {} as never,
    productAssetService: {} as never,
    assetAdminApiKey: "asset-admin-test-key-0123456789"
  } as never);

  const response = await app.inject({
    method: "POST",
    url: "/api/admin/bead-import/sessions",
    headers: { "x-admin-key": "asset-admin-test-key-0123456789" },
    payload: { idempotencyKey: "session-create-1" }
  });

  assert.equal(response.statusCode, 404);
  await app.close();
});

test("backend logger redacts administrator, authorization, and cookie credentials", async () => {
  let logs = "";
  const app = createApp({ logger: { stream: { write: (message) => { logs += message; } } } });
  app.log.info({
    headers: {
      "x-admin-key": "asset-admin-secret-value",
      authorization: "Bearer private-token",
      cookie: "session=private-cookie"
    }
  }, "redaction probe");
  await app.close();

  assert.equal(logs.includes("asset-admin-secret-value"), false);
  assert.equal(logs.includes("private-token"), false);
  assert.equal(logs.includes("private-cookie"), false);
});

const moduleBoundaryAuthProvider: AuthProvider = {
  async authenticateAccessToken() {
    throw new Error("unused in /api/modules boundary test");
  }
};

async function moduleNames(options: Parameters<typeof createApp>[0] = {}) {
  const app = createApp(options);
  try {
    const response = await app.inject({ method: "GET", url: "/api/modules" });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    return (body.modules as Array<{ name: string }>).map((module) => module.name);
  } finally {
    await app.close();
  }
}

test("/api/modules lists nothing when no module service is composed", async () => {
  assert.deepEqual(await moduleNames(), []);
});

test("/api/modules lists design when a design service is composed", async () => {
  assert.deepEqual(
    await moduleNames({ designService: {} as never, authProvider: moduleBoundaryAuthProvider }),
    ["design"]
  );
});

test("/api/modules lists design when a recommendation service is composed", async () => {
  assert.deepEqual(
    await moduleNames({
      recommendationService: {} as never,
      authProvider: moduleBoundaryAuthProvider
    }),
    ["design"]
  );
});

test("/api/modules lists tarot when a tarot service is composed", async () => {
  assert.deepEqual(
    await moduleNames({ tarotService: {} as never, authProvider: moduleBoundaryAuthProvider }),
    ["tarot"]
  );
});

test("/api/modules lists design then tarot once each when both are composed", async () => {
  assert.deepEqual(
    await moduleNames({
      designService: {} as never,
      recommendationService: {} as never,
      tarotService: {} as never,
      authProvider: moduleBoundaryAuthProvider
    }),
    ["design", "tarot"]
  );
});
