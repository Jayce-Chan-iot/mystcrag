import { timingSafeEqual } from "node:crypto";

import { AssetImportApiError } from "./bead-asset-import.errors.js";

export const ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID = "asset-admin-local-operator";

const MINIMUM_ASSET_ADMIN_KEY_BYTES = 16;

export function assertAssetAdminApiKeyConfigured(configured: string | undefined): asserts configured is string {
  if (
    typeof configured !== "string" ||
    Buffer.byteLength(configured, "utf8") < MINIMUM_ASSET_ADMIN_KEY_BYTES
  ) {
    throw new Error(
      "assetAdminApiKey (at least 16 UTF-8 bytes, e.g. ASSET_ADMIN_API_KEY) is required when asset import is enabled."
    );
  }
}

export function authenticateAssetAdminKey(
  provided: string | string[] | undefined,
  configured: string | undefined
): string {
  assertAssetAdminApiKeyConfigured(configured);

  const expected = Buffer.from(configured, "utf8");
  const candidate = typeof provided === "string" ? Buffer.from(provided, "utf8") : undefined;
  if (
    candidate === undefined ||
    candidate.byteLength !== expected.byteLength ||
    !timingSafeEqual(candidate, expected)
  ) {
    throw new AssetImportApiError(
      "UNAUTHORIZED",
      "A valid asset administrator credential is required."
    );
  }

  return ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID;
}
