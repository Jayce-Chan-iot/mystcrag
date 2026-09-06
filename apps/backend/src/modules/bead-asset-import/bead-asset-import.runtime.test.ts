import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  ASSET_RUNTIME_STARTUP_ERROR_MESSAGE,
  assetRuntimeNeedsRepositoryRoots,
  createAssetImportRuntime,
  discoverBackendRepositoryRoots,
  initializeAssetImportRuntime,
  resolveAssetImportEnabled
} from "./bead-asset-import.runtime.js";

test("asset import rollout accepts only the exact true literal", () => {
  assert.equal(resolveAssetImportEnabled("true"), true);
  for (const value of [undefined, "", "TRUE", "1", " true ", "false"]) {
    assert.equal(resolveAssetImportEnabled(value), false);
  }
});

test("disabled asset import does not require credentials, storage, or database composition", () => {
  assert.equal(createAssetImportRuntime({
    database: undefined as never,
    env: {},
    repositoryRoots: []
  }), undefined);
});

test("disabled import management retains approved public delivery when archive storage is configured", () => {
  const archiveRoot = mkdtempSync(join(tmpdir(), "mystcrag-backend-public-archive-"));
  const repositoryRoot = mkdtempSync(join(tmpdir(), "mystcrag-backend-public-repo-"));
  try {
    const runtime = createAssetImportRuntime({
      database: {} as never,
      env: { MYSTCRAG_ASSET_ARCHIVE_ROOT: archiveRoot },
      repositoryRoots: [repositoryRoot]
    });
    assert.ok(runtime?.productAssetService);
    assert.equal(runtime?.assetImportEnabled, undefined);
    assert.equal(runtime?.assetImportService, undefined);
    assert.equal(runtime?.assetAdminApiKey, undefined);
  } finally {
    rmSync(archiveRoot, { recursive: true, force: true });
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test("public-only archive delivery still requires proven repository roots", () => {
  assert.equal(assetRuntimeNeedsRepositoryRoots({ MYSTCRAG_ASSET_ARCHIVE_ROOT: "/private/archive" }), true);
  assert.equal(assetRuntimeNeedsRepositoryRoots({ MYSTCRAG_ASSET_IMPORT_ENABLED: "true" }), true);
  assert.equal(assetRuntimeNeedsRepositoryRoots({}), false);
});

test("asset runtime startup failure disconnects and exposes only a fixed safe error", async () => {
  let disconnected = false;
  await assert.rejects(
    () => initializeAssetImportRuntime({
      database: {} as never,
      env: { MYSTCRAG_ASSET_ARCHIVE_ROOT: "/private/customer/archive" },
      startDir: "/private/customer/repository",
      disconnect: async () => { disconnected = true; },
      discoverRepositoryRoots: () => {
        throw new Error("cannot inspect /private/customer/repository");
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, ASSET_RUNTIME_STARTUP_ERROR_MESSAGE);
      assert.equal(error.message.includes("/private/customer"), false);
      assert.equal("cause" in error, false);
      return true;
    }
  );
  assert.equal(disconnected, true);
});

test("enabled asset import fails closed without its key or archive root", () => {
  assert.throws(() => createAssetImportRuntime({
    database: {} as never,
    env: { MYSTCRAG_ASSET_IMPORT_ENABLED: "true" },
    repositoryRoots: []
  }), /assetAdminApiKey/);
  assert.throws(() => createAssetImportRuntime({
    database: {} as never,
    env: { MYSTCRAG_ASSET_IMPORT_ENABLED: "true", ASSET_ADMIN_API_KEY: "asset-admin-key-0123456789" },
    repositoryRoots: []
  }), /MYSTCRAG_ASSET_ARCHIVE_ROOT/);
});

test("enabled runtime composes import and public services over one valid archive store", () => {
  const archiveRoot = mkdtempSync(join(tmpdir(), "mystcrag-backend-archive-"));
  const repositoryRoot = mkdtempSync(join(tmpdir(), "mystcrag-backend-repo-"));
  try {
    const runtime = createAssetImportRuntime({
      database: {} as never,
      env: {
        MYSTCRAG_ASSET_IMPORT_ENABLED: "true",
        ASSET_ADMIN_API_KEY: "asset-admin-key-0123456789",
        MYSTCRAG_ASSET_ARCHIVE_ROOT: archiveRoot
      },
      repositoryRoots: [repositoryRoot]
    });
    assert.ok(runtime);
    assert.equal(runtime.assetImportEnabled, true);
    assert.equal(runtime.assetAdminApiKey, "asset-admin-key-0123456789");
    assert.ok(runtime.assetImportService);
    assert.ok(runtime.productAssetService);
  } finally {
    rmSync(archiveRoot, { recursive: true, force: true });
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test("repository-root discovery includes this linked worktree", () => {
  const roots = discoverBackendRepositoryRoots(resolve(process.cwd(), "../.."));
  assert.ok(roots.includes(realpathSync(resolve(process.cwd(), "../.."))));
});
