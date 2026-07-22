import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

test("fresh installs and workspace gates declare serialized Prisma generation", async () => {
  const [rootPackageJson, databasePackageJson, gitignore, gateSource] = await Promise.all([
    readFile(new URL("package.json", repositoryRoot), "utf8").then(JSON.parse),
    readFile(new URL("packages/database/package.json", repositoryRoot), "utf8").then(JSON.parse),
    readFile(new URL(".gitignore", repositoryRoot), "utf8"),
    readFile(new URL("scripts/workspace-gate.mjs", repositoryRoot), "utf8")
  ]);

  assert.equal(rootPackageJson.scripts.postinstall, "pnpm db:generate");
  assert.equal(
    rootPackageJson.scripts["db:generate"],
    "pnpm --filter @mystcrag/database db:generate"
  );
  assert.equal(databasePackageJson.scripts["db:generate"], "prisma generate");
  assert.match(gitignore, /^packages\/database\/generated\/$/m);

  for (const mode of ["build", "lint", "test", "typecheck", "validate"]) {
    assert.equal(rootPackageJson.scripts[mode], `node scripts/workspace-gate.mjs ${mode}`);
  }

  assert.match(
    gateSource,
    /run\(pnpmCommand, \["--filter", "@mystcrag\/database", "db:generate"\]\)/
  );
  assert.match(gateSource, /\.\.\.turboArguments/);
});
