import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "./app.js";

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
