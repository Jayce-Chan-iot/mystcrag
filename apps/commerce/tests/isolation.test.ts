import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  COMMERCE_LOCAL_CORS_DEFAULT,
  resolveCommerceCorsUrl,
  resolveCommerceDatabaseUrl,
  resolveCommerceSecret
} from "../src/isolation/env";

// TASK-COMMERCE-MEDUSA-BASE-001 isolation contract.
// These tests pin the Phase 1 boundaries: the isolated Medusa base never reuses
// the Mystcrag user database, never reads DATABASE_URL as a fallback, and its
// native Store/Admin paths are not wired into the Mystcrag public apps.

const commerceRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(commerceRoot, "..", "..");
const userDatabaseUrl = "postgres://mystcrag:mystcrag@127.0.0.1:5432/mystcrag?schema=public";
const isolatedDatabaseUrl = "postgres://mystcrag_commerce:mystcrag_commerce@127.0.0.1:55432/mystcrag_commerce_isolation_test";

const ignoredDirectories = new Set(["node_modules", ".medusa", ".cache", ".turbo", "dist", "coverage"]);

async function collectSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...(await collectSourceFiles(target)));
      }
      continue;
    }
    if (/\.(?:ts|tsx|mjs|cjs|js)$/.test(entry.name)) {
      files.push(target);
    }
  }
  return files;
}

test("missing or blank COMMERCE_DATABASE_URL fails closed instead of falling back to DATABASE_URL", () => {
  assert.throws(() => resolveCommerceDatabaseUrl({}), /COMMERCE_DATABASE_URL/);
  assert.throws(() => resolveCommerceDatabaseUrl({ COMMERCE_DATABASE_URL: "   " }), /COMMERCE_DATABASE_URL/);
  assert.throws(
    () => resolveCommerceDatabaseUrl({ DATABASE_URL: userDatabaseUrl }),
    /COMMERCE_DATABASE_URL/,
    "a present Mystcrag DATABASE_URL must not satisfy the commerce database requirement"
  );
});

test("COMMERCE_DATABASE_URL must be separate from the Mystcrag user database URL", () => {
  assert.throws(
    () =>
      resolveCommerceDatabaseUrl({
        COMMERCE_DATABASE_URL: userDatabaseUrl,
        DATABASE_URL: userDatabaseUrl
      }),
    /separate/
  );
});

test("a valid isolated database URL is returned unchanged", () => {
  assert.equal(
    resolveCommerceDatabaseUrl({
      COMMERCE_DATABASE_URL: isolatedDatabaseUrl,
      DATABASE_URL: userDatabaseUrl
    }),
    isolatedDatabaseUrl
  );
});

test("missing commerce secrets fail closed", () => {
  assert.throws(() => resolveCommerceSecret("JWT_SECRET", {}), /JWT_SECRET/);
  assert.throws(() => resolveCommerceSecret("COOKIE_SECRET", { JWT_SECRET: "synthetic" }), /COOKIE_SECRET/);
  assert.equal(resolveCommerceSecret("JWT_SECRET", { JWT_SECRET: "synthetic" }), "synthetic");
});

test("browser CORS defaults stay on loopback origins only", () => {
  assert.ok(COMMERCE_LOCAL_CORS_DEFAULT.length > 0);
  for (const origin of COMMERCE_LOCAL_CORS_DEFAULT) {
    assert.match(origin, /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/);
  }
  assert.equal(resolveCommerceCorsUrl("STORE_CORS", {}), COMMERCE_LOCAL_CORS_DEFAULT.join(","));
});

test("medusa-config.ts resolves the database through the isolation guard, never through DATABASE_URL", async () => {
  const config = await readFile(path.join(commerceRoot, "medusa-config.ts"), "utf8");
  assert.match(config, /resolveCommerceDatabaseUrl/);
  assert.doesNotMatch(config, /process\.env\.DATABASE_URL|process\.env\[["']DATABASE_URL["']\]/);
});

test("no commerce source reads process.env.DATABASE_URL outside the isolation guard", async () => {
  const guardFile = path.join(commerceRoot, "src", "isolation", "env.ts");
  const files = [...(await collectSourceFiles(path.join(commerceRoot, "src"))), path.join(commerceRoot, "medusa-config.ts")];
  const offenders: string[] = [];
  for (const file of files) {
    if (file === guardFile) {
      continue;
    }
    const source = await readFile(file, "utf8");
    if (/process\.env\.DATABASE_URL|process\.env\[["']DATABASE_URL["']\]/.test(source)) {
      offenders.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("commerce app never imports the Mystcrag user database stack", async () => {
  // Production sources only; this test file necessarily names the markers itself.
  const marker = new RegExp("@mystcrag/" + "database|@prisma/" + "client|" + "createPrisma" + "Client|mystcrag_locale");
  const testsRoot = path.join(commerceRoot, "tests") + path.sep;
  const files = (await collectSourceFiles(commerceRoot)).filter((file) => !file.startsWith(testsRoot));
  const offenders: string[] = [];
  for (const file of files) {
    if (marker.test(await readFile(file, "utf8"))) {
      offenders.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("Medusa native Store paths are not wired into the Mystcrag public apps", async () => {
  const publicRoots = ["apps/frontend/app", "apps/frontend/src", "apps/backend/src"].map((segment) =>
    path.join(repoRoot, segment)
  );
  const markers = ["/store/" + "products", "/store/" + "collections", "x-publishable-" + "api-key", ":9000", "@mystcrag/" + "commerce"];
  const marker = new RegExp(markers.join("|"));
  const offenders: string[] = [];
  for (const root of publicRoots) {
    for (const file of await collectSourceFiles(root)) {
      if (marker.test(await readFile(file, "utf8"))) {
        offenders.push(path.relative(repoRoot, file));
      }
    }
  }
  assert.deepEqual(offenders, [], "no Mystcrag public route may proxy or link the native Medusa Store paths");
});