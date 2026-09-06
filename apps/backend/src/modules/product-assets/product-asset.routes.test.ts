import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../../app.js";

const SHA = "a".repeat(64);
const BYTES = Buffer.from([1, 2, 3]);

test("public asset delivery is binary, opaque, immutable, and independent of the admin key", async () => {
  const app = createApp({
    productAssetService: {
      resolve: async () => ({
        bytes: BYTES,
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": "3",
          ETag: `"${SHA}"`,
          "Cache-Control": "public, max-age=31536000, immutable"
        }
      })
    } as never,
    logger: false
  });

  const response = await app.inject({ method: "GET", url: `/api/assets/approved:${SHA}` });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.rawPayload, BYTES);
  assert.equal(response.headers["content-type"], "image/webp");
  assert.equal(response.headers["content-length"], "3");
  assert.equal(response.headers.etag, `"${SHA}"`);
  assert.equal(response.headers["cache-control"], "public, max-age=31536000, immutable");
  await app.close();
});

test("malformed private-looking asset keys fail as strict 400 JSON without reaching storage", async () => {
  let called = false;
  const app = createApp({
    productAssetService: { resolve: async () => { called = true; } } as never,
    logger: false
  });
  const response = await app.inject({ method: "GET", url: "/api/assets/imports%2Fsession%2Fraw%2Fsecret" });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(called, false);
  await app.close();
});
