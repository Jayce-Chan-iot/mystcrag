import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../packages/database/package.json", import.meta.url));
const tsx = require.resolve("tsx/cli");
const helper = fileURLToPath(new URL("./auth-e2e/helpers/run-state.mts", import.meta.url));

// Exercise the helper the real SQL assertions use, in a fresh worker-like process.
// Only synthetic URLs are supplied; no database connection or artifact is created.
function resolveInWorker(configuration) {
  const env = { ...process.env };
  for (const key of ["AUTH006_DATABASE_ADMIN_URL", "AUTH006_DATABASE_URL", "DATABASE_URL", "PGPASSWORD"]) {
    delete env[key];
  }
  Object.assign(env, { USER: "auth_ci_fixture", USERNAME: "auth_ci_fixture" }, configuration);
  const child = spawnSync(process.execPath, [tsx, "-e", `
    import { databaseUrl } from ${JSON.stringify(helper)};
    const url = new URL(databaseUrl());
    console.log(JSON.stringify({
      host: url.hostname, port: url.port, user: url.username,
      password: url.password, database: url.pathname,
      search: url.search, hash: url.hash
    }));
  `], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
}

test("auth SQL worker uses the CI admin credentials instead of a passwordless local fallback", () => {
  const actual = resolveInWorker({
    AUTH006_DATABASE_ADMIN_URL: "postgresql://ci_user:synthetic%40password@ci-postgres:5544/postgres"
  });
  assert.deepEqual(actual, {
    host: "ci-postgres", port: "5544", user: "ci_user", password: "synthetic%40password",
    database: "/postgres", search: "", hash: ""
  });
});

test("auth SQL worker prefers the canonical admin URL over ambient and obsolete URLs", () => {
  const actual = resolveInWorker({
    AUTH006_DATABASE_ADMIN_URL: "postgresql://ci_user:synthetic@ci-postgres:5544/postgres",
    DATABASE_URL: "postgresql://other:synthetic@wrong-host:9999/developer",
    AUTH006_DATABASE_URL: "postgresql://obsolete:synthetic@obsolete-host:7777/old"
  });
  assert.equal(actual.host, "ci-postgres");
  assert.equal(actual.user, "ci_user");
  assert.equal(actual.port, "5544");
});

test("auth SQL worker normalizes the ambient URL exactly like setup before selecting the isolated database", () => {
  const actual = resolveInWorker({
    DATABASE_URL: "postgresql://fallback:synthetic@fallback-host:5545/developer?schema=private#fragment"
  });
  assert.deepEqual(actual, {
    host: "fallback-host", port: "5545", user: "fallback", password: "synthetic",
    database: "/postgres", search: "", hash: ""
  });
});

test("auth SQL worker retains the documented local default when no database URL is configured", () => {
  assert.deepEqual(resolveInWorker({}), {
    host: "localhost", port: "5432", user: "auth_ci_fixture", password: "",
    database: "/postgres", search: "", hash: ""
  });
});
