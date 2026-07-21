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
