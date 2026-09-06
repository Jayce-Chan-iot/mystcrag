import assert from "node:assert/strict";
import test from "node:test";

import { AssetImportApiError } from "./bead-asset-import.errors.js";
import {
  ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID,
  authenticateAssetAdminKey
} from "./bead-asset-import.auth.js";

const ADMIN_KEY = "asset-admin-test-key-0123456789";

test("asset admin authentication returns only the fixed server-owned actor", () => {
  assert.equal(authenticateAssetAdminKey(ADMIN_KEY, ADMIN_KEY), ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID);
  assert.equal(ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID, "asset-admin-local-operator");
});

test("missing, duplicate and wrong asset admin credentials are generic unauthorized failures", () => {
  for (const provided of [undefined, [ADMIN_KEY, ADMIN_KEY], "wrong-key-same-character-count!!"]) {
    assert.throws(
      () => authenticateAssetAdminKey(provided, ADMIN_KEY),
      (error: unknown) => {
        assert.ok(error instanceof AssetImportApiError);
        assert.equal(error.transportCode, "UNAUTHORIZED");
        assert.equal(error.assetCode, undefined);
        assert.equal(error.message, "A valid asset administrator credential is required.");
        assert.equal(error.message.includes(ADMIN_KEY), false);
        return true;
      }
    );
  }
});

test("asset admin authentication fails closed for missing or short server configuration", () => {
  for (const configured of [undefined, "too-short"]) {
    assert.throws(
      () => authenticateAssetAdminKey(ADMIN_KEY, configured),
      /assetAdminApiKey/
    );
  }
});
