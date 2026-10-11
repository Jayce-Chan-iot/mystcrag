import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  COMMERCE_LOCAL_CORS_DEFAULT,
  assertCommerceDatabaseUrlNotDeclaredInLocalEnv,
  findLocalEnvFileDeclaringCommerceDatabaseUrl,
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

test("equivalent COMMERCE_DATABASE_URL spellings cannot bypass the separation check", () => {
  const equivalents = [
    "postgresql://mystcrag:mystcrag@127.0.0.1:5432/mystcrag?schema=public",
    "postgres://other:other@127.0.0.1:5432/mystcrag?schema=public",
    "postgres://mystcrag:mystcrag@localhost:5432/mystcrag?schema=public",
    "postgres://mystcrag:mystcrag@127.0.0.1/mystcrag?sslmode=disable",
    "postgres://mystcrag:mystcrag@127.0.0.1:5432/mystcrag/",
    "postgresql://mystcrag:mystcrag@127.0.0.1:5432/mystcrag?schema=public&connection_limit=3"
  ];
  for (const equivalent of equivalents) {
    assert.throws(
      () => resolveCommerceDatabaseUrl({ COMMERCE_DATABASE_URL: equivalent, DATABASE_URL: userDatabaseUrl }),
      /separate/,
      `equivalent spelling must not bypass the separation check: ${equivalent}`
    );
  }
});

test("invalid PostgreSQL URL values fail closed before any comparison", () => {
  const invalid = [
    "not-a-url",
    "mysql://mystcrag:mystcrag@127.0.0.1:5432/mystcrag",
    "http://mystcrag:mystcrag@127.0.0.1:5432/mystcrag",
    "postgres://mystcrag:mystcrag@:5432/mystcrag",
    "postgres://mystcrag:mystcrag@127.0.0.1:abc/mystcrag",
    "postgres://mystcrag:mystcrag@127.0.0.1:5432/",
    "postgres://mystcrag:mystcrag@127.0.0.1:5432/a/b",
    "postgres://mystcrag:mystcrag@127.0.0.1:5432/a%2Fb"
  ];
  for (const value of invalid) {
    assert.throws(
      () => resolveCommerceDatabaseUrl({ COMMERCE_DATABASE_URL: value, DATABASE_URL: userDatabaseUrl }),
      /COMMERCE_DATABASE_URL/,
      `invalid COMMERCE_DATABASE_URL must fail closed: ${value}`
    );
  }
});

test("an invalid DATABASE_URL cannot waive the separation proof", () => {
  assert.throws(
    () => resolveCommerceDatabaseUrl({ COMMERCE_DATABASE_URL: isolatedDatabaseUrl, DATABASE_URL: "not-a-url" }),
    /DATABASE_URL must be a valid PostgreSQL URL/
  );
  assert.throws(
    () => resolveCommerceDatabaseUrl({ COMMERCE_DATABASE_URL: isolatedDatabaseUrl, DATABASE_URL: "mysql://u@127.0.0.1/x" }),
    /DATABASE_URL must be a PostgreSQL URL/
  );
});

test("genuinely different database targets still pass, and loopback aliases are normalized", () => {
  const differentPort = "postgresql://mystcrag:mystcrag@127.0.0.1:55432/mystcrag?schema=public&connection_limit=3";
  assert.equal(
    resolveCommerceDatabaseUrl({ COMMERCE_DATABASE_URL: differentPort, DATABASE_URL: userDatabaseUrl }),
    differentPort
  );
  const differentHost = "postgres://mystcrag:mystcrag@db.internal:5432/mystcrag";
  assert.equal(
    resolveCommerceDatabaseUrl({ COMMERCE_DATABASE_URL: differentHost, DATABASE_URL: userDatabaseUrl }),
    differentHost
  );
  const differentDatabase = "postgres://other:secret@[::1]:5432/other_db";
  assert.equal(
    resolveCommerceDatabaseUrl({ COMMERCE_DATABASE_URL: differentDatabase, DATABASE_URL: userDatabaseUrl }),
    differentDatabase
  );
  assert.throws(
    () =>
      resolveCommerceDatabaseUrl({
        COMMERCE_DATABASE_URL: "postgres://someone:else@[::1]:5432/mystcrag",
        DATABASE_URL: userDatabaseUrl
      }),
    /separate/,
    "IPv6 loopback is the same loopback target as 127.0.0.1 for the same port and database"
  );
});

test("a local .env declaring COMMERCE_DATABASE_URL is refused before Medusa can preload it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "commerce-env-guard-"));
  try {
    await writeFile(
      path.join(directory, ".env"),
      [
        "# synthetic regression fixture: this is the file Medusa's CLI preloads",
        "COMMERCE_DATABASE_URL=postgres://decoy:decoy@127.0.0.1:5432/decoy_db",
        "DATABASE_URL=postgres://mystcrag:mystcrag@127.0.0.1:5432/mystcrag",
        ""
      ].join("\n")
    );
    assert.equal(findLocalEnvFileDeclaringCommerceDatabaseUrl(directory, "development"), ".env");
    assert.throws(
      () => assertCommerceDatabaseUrlNotDeclaredInLocalEnv(directory, "development"),
      /must be provided through the process environment/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("commented quotes and absent files do not trigger the local env guard", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "commerce-env-guard-"));
  try {
    await writeFile(
      path.join(directory, ".env"),
      ["# COMMERCE_DATABASE_URL=postgres://commented@127.0.0.1:5432/nope", "JWT_SECRET=synthetic", ""].join("\n")
    );
    assert.equal(findLocalEnvFileDeclaringCommerceDatabaseUrl(directory, "development"), undefined);
    assert.doesNotThrow(() => assertCommerceDatabaseUrlNotDeclaredInLocalEnv(directory, "development"));
    assert.equal(
      findLocalEnvFileDeclaringCommerceDatabaseUrl(path.join(directory, "absent-subdirectory"), "development"),
      undefined,
      "a missing env file is not a declaration"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the environment-specific env file is only consulted for known Medusa environments", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "commerce-env-guard-"));
  try {
    await writeFile(
      path.join(directory, ".env.production"),
      "COMMERCE_DATABASE_URL=postgres://decoy:decoy@127.0.0.1:5432/decoy_db\n"
    );
    assert.equal(findLocalEnvFileDeclaringCommerceDatabaseUrl(directory, "production"), ".env.production");
    assert.equal(findLocalEnvFileDeclaringCommerceDatabaseUrl(directory, "development"), undefined);
    assert.equal(findLocalEnvFileDeclaringCommerceDatabaseUrl(directory, undefined), undefined);
    assert.throws(
      () => assertCommerceDatabaseUrlNotDeclaredInLocalEnv(directory, "production"),
      /must be provided through the process environment/
    );
    assert.doesNotThrow(() => assertCommerceDatabaseUrlNotDeclaredInLocalEnv(directory, "development"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("medusa-config.ts refuses local env files that declare COMMERCE_DATABASE_URL", async () => {
  const config = await readFile(path.join(commerceRoot, "medusa-config.ts"), "utf8");
  assert.match(config, /assertCommerceDatabaseUrlNotDeclaredInLocalEnv/);
});

test("the dev script binds loopback by default and the probe uses that same entry point", async () => {
  const manifest = JSON.parse(await readFile(path.join(commerceRoot, "package.json"), "utf8"));
  assert.match(String(manifest.scripts["medusa:dev"]), /--host 127\.0\.0\.1/);
  const probe = await readFile(path.join(commerceRoot, "scripts", "isolation-probe.mjs"), "utf8");
  assert.match(
    probe,
    /"run",\s*"medusa:dev"/,
    "the isolation probe must start the server through the package dev script"
  );
  assert.doesNotMatch(probe, /"--host"/, "the isolation probe must not pass its own bind address");
  assert.match(probe, /CREATE ROLE/, "the probe must create separate database roles");
  assert.match(probe, /REVOKE ALL ON DATABASE/, "the probe must revoke public database access");
});