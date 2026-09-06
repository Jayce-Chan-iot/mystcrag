import assert from "node:assert/strict";
import test from "node:test";

import { ArchiveStoreError } from "@mystcrag/asset-pipeline";
import { PersistenceError } from "@mystcrag/database";
import { AssetImportErrorEnvelopeSchema } from "@mystcrag/design-contract";

import {
  AssetImportApiError,
  assetImportErrorEnvelope,
  normalizeAssetImportError
} from "./bead-asset-import.errors.js";

test("storage exhaustion maps to catalogued STORAGE_FULL without leaking its cause", () => {
  const cause = Object.assign(new Error("disk /private/archive is full"), { code: "ENOSPC" });
  const normalized = normalizeAssetImportError(
    new ArchiveStoreError("WRITE_FAILED", "write /private/archive failed", { cause })
  );
  assert.equal(normalized.transportCode, "INTERNAL_ERROR");
  assert.equal(normalized.assetCode, "STORAGE_FULL");
  const envelope = assetImportErrorEnvelope(normalized, "request-1");
  assert.ok(AssetImportErrorEnvelopeSchema.safeParse(envelope).success);
  assert.equal(JSON.stringify(envelope).includes("/private/archive"), false);
});

test("error normalization preserves strict transport statuses and safe messages", () => {
  const cases: Array<[unknown, string, number]> = [
    [new AssetImportApiError("UNAUTHORIZED", "credential required"), "UNAUTHORIZED", 401],
    [new PersistenceError("NOT_FOUND", "private id"), "NOT_FOUND", 404],
    [new PersistenceError("CONFLICT", "private revision"), "CONFLICT", 409],
    [{ statusCode: 413, message: "private limit" }, "PAYLOAD_TOO_LARGE", 413],
    [new AssetImportApiError("UNSUPPORTED_MEDIA_TYPE", "unsupported", "UNSUPPORTED_FILE_KIND"), "UNSUPPORTED_MEDIA_TYPE", 415],
    [new PersistenceError("COMPLIANCE_BLOCKED", "private draft"), "UNPROCESSABLE_ENTITY", 422],
    [new Error("database /private/path"), "INTERNAL_ERROR", 500]
  ];
  for (const [input, transportCode, status] of cases) {
    const normalized = normalizeAssetImportError(input);
    assert.equal(normalized.transportCode, transportCode);
    assert.equal(normalized.statusCode, status);
    const serialized = JSON.stringify(assetImportErrorEnvelope(normalized, "request-1"));
    assert.equal(serialized.includes("/private"), false);
    assert.ok(AssetImportErrorEnvelopeSchema.safeParse(JSON.parse(serialized)).success);
  }
});
