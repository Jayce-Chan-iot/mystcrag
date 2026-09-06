import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";

import { ArchiveStore } from "@mystcrag/asset-pipeline";
import { AssetImportRepository } from "@mystcrag/database";

import { assertAssetAdminApiKeyConfigured } from "./bead-asset-import.auth.js";
import { AssetImportApplicationService } from "./bead-asset-import.service.js";
import { ProductAssetService } from "../product-assets/product-asset.service.js";

export const ASSET_RUNTIME_STARTUP_ERROR_MESSAGE = "Asset archive runtime configuration failed.";

export function resolveAssetImportEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function assetRuntimeNeedsRepositoryRoots(env: Record<string, string | undefined>): boolean {
  return resolveAssetImportEnabled(env.MYSTCRAG_ASSET_IMPORT_ENABLED) ||
    (env.MYSTCRAG_ASSET_ARCHIVE_ROOT !== undefined && env.MYSTCRAG_ASSET_ARCHIVE_ROOT !== "");
}

export function discoverBackendRepositoryRoots(startDir: string): string[] {
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: startDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const entries = output.trim().split(/\r?\n\r?\n/).map((block) => {
    const lines = block.split(/\r?\n/);
    return {
      root: lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length),
      prunable: lines.some((line) => line.startsWith("prunable")),
      locked: lines.some((line) => line.startsWith("locked"))
    };
  });
  const roots = entries.filter((entry) => {
    if (entry.root === undefined) return false;
    try {
      realpathSync(entry.root);
      return true;
    } catch {
      if (entry.prunable && !entry.locked) return false;
      throw new Error("A registered Git worktree cannot be verified for asset archive isolation.");
    }
  }).map((entry) => entry.root!);
  if (roots.length === 0) throw new Error("No Git worktree roots could be proven for asset archive isolation.");
  return [...new Set(roots.map((root) => {
    const real = realpathSync(root);
    if (!statSync(real).isDirectory()) throw new Error("A registered Git worktree is not a directory.");
    return real;
  }))];
}

export function createAssetImportRuntime(options: {
  database: ConstructorParameters<typeof AssetImportRepository>[0];
  env: Record<string, string | undefined>;
  repositoryRoots: readonly string[];
}) {
  const assetImportEnabled = resolveAssetImportEnabled(options.env.MYSTCRAG_ASSET_IMPORT_ENABLED);
  const archiveRootConfigured = options.env.MYSTCRAG_ASSET_ARCHIVE_ROOT !== undefined &&
    options.env.MYSTCRAG_ASSET_ARCHIVE_ROOT !== "";
  if (!assetImportEnabled && !archiveRootConfigured) return undefined;

  const assetAdminApiKey = options.env.ASSET_ADMIN_API_KEY;
  if (assetImportEnabled) assertAssetAdminApiKeyConfigured(assetAdminApiKey);
  const archiveStore = ArchiveStore.fromEnvironment({
    env: options.env,
    repositoryRoots: options.repositoryRoots
  });
  const repository = new AssetImportRepository(options.database);
  return {
    ...(assetImportEnabled ? {
      assetImportEnabled: true as const,
      assetAdminApiKey,
      assetImportService: new AssetImportApplicationService({ repository, archiveStore })
    } : {}),
    productAssetService: new ProductAssetService({ repository, archiveStore })
  };
}

export async function initializeAssetImportRuntime(options: {
  database: ConstructorParameters<typeof AssetImportRepository>[0];
  env: Record<string, string | undefined>;
  startDir: string;
  disconnect: () => Promise<unknown>;
  discoverRepositoryRoots?: (startDir: string) => string[];
}) {
  try {
    const repositoryRoots = assetRuntimeNeedsRepositoryRoots(options.env)
      ? (options.discoverRepositoryRoots ?? discoverBackendRepositoryRoots)(options.startDir)
      : [];
    return createAssetImportRuntime({
      database: options.database,
      env: options.env,
      repositoryRoots
    });
  } catch {
    await options.disconnect().catch(() => undefined);
    throw new Error(ASSET_RUNTIME_STARTUP_ERROR_MESSAGE);
  }
}
