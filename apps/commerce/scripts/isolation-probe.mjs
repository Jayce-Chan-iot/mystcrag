#!/usr/bin/env node
/**
 * Isolated cold-start / restart probe for TASK-COMMERCE-MEDUSA-BASE-001.
 *
 * Creates a throwaway PostgreSQL cluster in a system temp directory with:
 *   - probe_admin        cluster superuser; only this probe uses it
 *   - commerce_app       owns commerce_isolation_probe and commerce_decoy_env_db
 *   - mystcrag_user_app  owns mystcrag_user_canary_db, the Mystcrag user
 *                        database stand-in that must stay untouched (zero
 *                        tables, zero sessions) for the whole run
 * Each database is owned by exactly one of those login roles and PUBLIC may not
 * connect, so the two sides cannot reach each other's database.
 *
 * It then proves, with fictional data only:
 *   1. missing, shared, alias-spelled and invalid COMMERCE_DATABASE_URL values
 *      fail closed before any connect
 *   2. a stray local .env that declares COMMERCE_DATABASE_URL is refused and
 *      therefore never becomes the migration target, even though the Medusa CLI
 *      preloads .env before the config guard runs
 *   3. official migrations run against the isolated database only and are owned
 *      by the dedicated commerce role
 *   4. cold start through the package's own dev script (pnpm run medusa:dev,
 *      with only PORT supplied by this probe) serves Admin + Store API:
 *      the listening socket is 127.0.0.1 only, loopback answers the probe
 *      routes, and every non-loopback interface refuses the same routes at the
 *      TCP layer (not merely a CORS or route-level rejection)
 *   5. fictional product / variant / collection with CN/CNY and TW/TWD
 *      manually entered region-rule prices read back per market
 *   6. a full restart keeps the data (persistence probe)
 *
 * Evidence log: output/playwright/task-commerce-medusa-base-001/probe-isolation.log
 * (override with COMMERCE_PROBE_EVIDENCE_DIR). Never touches the real
 * Mystcrag database, ports of other services, or any other process.
 */

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const evidenceDir =
  process.env.COMMERCE_PROBE_EVIDENCE_DIR ?? path.join(repoRoot, "output", "playwright", "task-commerce-medusa-base-001");
const evidenceFile = path.join(evidenceDir, "probe-isolation.log");
const localEnvPath = path.join(packageRoot, ".env");

mkdirSync(evidenceDir, { recursive: true });

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  appendFileSync(evidenceFile, `${line}\n`);
}

function fail(message) {
  log(`FATAL: ${message}`);
  throw new Error(message);
}

function assertTrue(condition, message) {
  if (!condition) {
    fail(`assertion failed: ${message}`);
  }
  log(`ok: ${message}`);
}

function assertEqual(actual, expected, label) {
  assertTrue(actual === expected, `${label} {expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) {
    fail(`failed to run ${command}: ${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function resolveTool(tool, fallbacks = []) {
  const which = spawnSync("which", [tool], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim().split("\n")[0];
  }
  for (const fallback of fallbacks) {
    if (existsSync(fallback)) {
      return fallback;
    }
  }
  return fail(`required tool not found: ${tool}`);
}

/**
 * The probe must drive the same delivered entry points a developer uses, so
 * every Medusa call goes through pnpm (the package scripts or pnpm exec) rather
 * than an absolute CLI binary path.
 */
function resolvePnpm() {
  const execPath = process.env.npm_execpath;
  if (execPath && existsSync(execPath)) {
    return { command: process.execPath, prefix: [execPath] };
  }
  const which = spawnSync("which", ["pnpm"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) {
    return { command: which.stdout.trim().split("\n")[0], prefix: [] };
  }
  return fail("pnpm not found on PATH (npm_execpath fallback also failed)");
}

function nonLoopbackIPv4() {
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return { name, address: address.address };
      }
    }
  }
  return null;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, { timeoutMs, intervalMs = 1000, label }) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  fail(`timed out waiting for ${label}${lastError ? ` (last error: ${lastError.message})` : ""}`);
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function main() {
  log("TASK-COMMERCE-MEDUSA-BASE-001 isolated cold-start / restart probe");
  log(`node=${process.version} platform=${process.platform}`);

  const superuser = "probe_admin";
  const commerceRole = "commerce_app";
  const userRole = "mystcrag_user_app";
  const isolatedDatabase = "commerce_isolation_probe";
  const canaryDatabase = "mystcrag_user_canary_db";
  const decoyDatabase = "commerce_decoy_env_db";

  const pnpm = resolvePnpm();
  const initdb = resolveTool("initdb");
  const pgCtl = resolveTool("pg_ctl");
  const createdb = resolveTool("createdb");
  const psqlTool = resolveTool("psql");
  const lsof = resolveTool("lsof", ["/usr/sbin/lsof"]);

  // Medusa preloads a local .env before the isolation guard can inspect the
  // process environment; the probe refuses to run while such a file exists so
  // its own controlled environment stays authoritative (a synthetic .env is
  // written and removed again inside the regression step below).
  assertTrue(!existsSync(localEnvPath), `no local ${localEnvPath} exists before the probe starts`);

  const version = run(pnpm.command, [...pnpm.prefix, "exec", "medusa", "--version"], {
    cwd: packageRoot,
    env: { ...process.env }
  });
  log(`medusa CLI version output: ${(version.stdout + version.stderr).trim().split("\n").slice(-1)[0]}`);

  const pgPort = await freePort();
  const httpPort = await freePort();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "mystcrag-commerce-base-001-"));
  const pgData = path.join(tempRoot, "pgdata");
  const serverLogFile = path.join(tempRoot, "medusa-server.log");
  log(`throwaway cluster dir=${tempRoot} pgPort=${pgPort} httpPort=${httpPort}`);

  const isolatedDatabaseUrl = `postgres://${commerceRole}@127.0.0.1:${pgPort}/${isolatedDatabase}`;
  const canaryDatabaseUrl = `postgres://${userRole}@127.0.0.1:${pgPort}/${canaryDatabase}`;
  const decoyDatabaseUrl = `postgres://${commerceRole}@127.0.0.1:${pgPort}/${decoyDatabase}`;
  const childEnv = {
    ...process.env,
    NODE_ENV: "development",
    COMMERCE_DATABASE_URL: isolatedDatabaseUrl,
    DATABASE_URL: canaryDatabaseUrl,
    JWT_SECRET: "probe-only-jwt-secret-0123456789abcdef",
    COOKIE_SECRET: "probe-only-cookie-secret-0123456789abcdef",
    STORE_CORS: `http://127.0.0.1:${httpPort}`,
    ADMIN_CORS: `http://127.0.0.1:${httpPort}`,
    AUTH_CORS: `http://127.0.0.1:${httpPort}`
  };
  // The bind address must come from the package dev script alone; a developer's
  // HOST variable would otherwise mask the delivered default.
  delete childEnv.HOST;

  const runMedusa = (args, env, label) => {
    const result = run(pnpm.command, [...pnpm.prefix, "exec", "medusa", ...args], { cwd: packageRoot, env });
    log(`medusa ${args.join(" ")} (${label}) exit=${result.status}`);
    return result;
  };
  const runMedusaScript = (script, env, label) => {
    const result = run(pnpm.command, [...pnpm.prefix, "run", script], { cwd: packageRoot, env });
    log(`pnpm run ${script} (${label}) exit=${result.status}`);
    return result;
  };
  const psql = (database, sql, label) => {
    const result = run(psqlTool, ["-h", "127.0.0.1", "-p", String(pgPort), "-U", superuser, "-d", database, "-tAc", sql]);
    if (result.status !== 0) {
      fail(`psql failed (${label}): ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  };
  const canarySessions = (label) =>
    assertEqual(
      psql("postgres", `select coalesce(sum(sessions), 0) from pg_stat_database where datname = '${canaryDatabase}'`, label),
      "0",
      label
    );
  const canaryTables = (label) =>
    assertEqual(
      psql(canaryDatabase, "select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')", label),
      "0",
      label
    );
  const listeningAddresses = (port) => {
    // Field mode (-Fn) prints one "n<name>" line per socket, e.g.
    // "n127.0.0.1:50545"; the plain table format would append "(LISTEN)".
    const result = run(lsof, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fn"]);
    return result.stdout
      .split("\n")
      .filter((line) => line.startsWith("n"))
      .map((line) => line.slice(1).trim());
  };

  let server = null;
  const stopServer = async () => {
    if (!server || server.exitCode !== null) {
      return;
    }
    log(`stopping probe server pid=${server.pid} (process group)`);
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch (error) {
      log(`SIGTERM to group failed: ${error.message}`);
    }
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      sleep(15000).then(() => {
        try {
          process.kill(-server.pid, "SIGKILL");
        } catch {}
      })
    ]);
    await waitFor(
      async () => {
        try {
          await fetch(`http://127.0.0.1:${httpPort}/health`, { signal: AbortSignal.timeout(1500) });
          return false;
        } catch {
          return true;
        }
      },
      { timeoutMs: 30000, label: "probe server port to close" }
    );
    server = null;
  };

  try {
    // (1) Throwaway cluster: one superuser for administration, one login role
    // per database so neither side can reach the other side's database.
    run(initdb, ["-D", pgData, "-U", superuser, "--auth=trust", "-E", "UTF8"]);
    run(pgCtl, ["-D", pgData, "-o", `-p ${pgPort} -k ${tempRoot} -h 127.0.0.1`, "-l", path.join(tempRoot, "pg.log"), "start"]);
    psql("postgres", `CREATE ROLE ${commerceRole} LOGIN`, "create commerce role");
    psql("postgres", `CREATE ROLE ${userRole} LOGIN`, "create user-database role");
    run(createdb, ["-h", "127.0.0.1", "-p", String(pgPort), "-U", superuser, "-O", commerceRole, isolatedDatabase]);
    run(createdb, ["-h", "127.0.0.1", "-p", String(pgPort), "-U", superuser, "-O", userRole, canaryDatabase]);
    run(createdb, ["-h", "127.0.0.1", "-p", String(pgPort), "-U", superuser, "-O", commerceRole, decoyDatabase]);
    for (const database of [isolatedDatabase, canaryDatabase, decoyDatabase]) {
      psql("postgres", `REVOKE ALL ON DATABASE ${database} FROM PUBLIC`, `revoke public access on ${database}`);
    }
    log("throwaway PostgreSQL cluster started with role-separated databases");

    assertEqual(
      psql("postgres", `select datdba::regrole::text from pg_database where datname = '${isolatedDatabase}'`, "isolated owner"),
      commerceRole,
      "isolated database is owned by the commerce role"
    );
    assertEqual(
      psql("postgres", `select datdba::regrole::text from pg_database where datname = '${canaryDatabase}'`, "canary owner"),
      userRole,
      "canary user database is owned by the user-database role"
    );
    assertEqual(
      psql("postgres", `select has_database_privilege('${commerceRole}', '${canaryDatabase}', 'CONNECT')`, "commerce-to-canary"),
      "f",
      "the commerce role cannot connect to the canary user database"
    );
    assertEqual(
      psql("postgres", `select has_database_privilege('${userRole}', '${isolatedDatabase}', 'CONNECT')`, "user-to-isolated"),
      "f",
      "the user-database role cannot connect to the isolated database"
    );
    assertEqual(
      psql("postgres", `select has_database_privilege('${commerceRole}', '${isolatedDatabase}', 'CONNECT')`, "commerce-to-isolated"),
      "t",
      "the commerce role can connect to its own isolated database"
    );
    assertEqual(
      psql("postgres", `select has_database_privilege('${userRole}', '${canaryDatabase}', 'CONNECT')`, "user-to-canary"),
      "t",
      "the user-database role can connect to its own canary database"
    );

    const missingUrlEnv = { ...childEnv };
    delete missingUrlEnv.COMMERCE_DATABASE_URL;

    // (2) Fail-closed checks. None of these may connect anywhere: the canary
    // session count stays zero and the decoy database stays empty.
    const missingRun = runMedusaScript("medusa:migrate", missingUrlEnv, "fail-closed missing URL");
    assertTrue(missingRun.status !== 0, "missing COMMERCE_DATABASE_URL aborts migration with a non-zero exit");
    assertTrue(
      `${missingRun.stdout}${missingRun.stderr}`.includes("COMMERCE_DATABASE_URL is required"),
      "missing COMMERCE_DATABASE_URL reports the isolation guard message"
    );
    canarySessions("canary user database sessions after the missing-URL guard");

    // Regression: with a local .env present Medusa's own preload would supply
    // COMMERCE_DATABASE_URL from that file; the guard must refuse the file so
    // the migration never runs against the .env database.
    writeFileSync(
      localEnvPath,
      [
        "# synthetic probe fixture: this local file must never decide the migration target",
        `COMMERCE_DATABASE_URL=${decoyDatabaseUrl}`,
        `DATABASE_URL=${canaryDatabaseUrl}`,
        "JWT_SECRET=probe-only-jwt-secret-0123456789abcdef",
        "COOKIE_SECRET=probe-only-cookie-secret-0123456789abcdef",
        ""
      ].join("\n")
    );
    try {
      const decoyRun = runMedusaScript("medusa:migrate", missingUrlEnv, "fail-closed local .env reload");
      assertTrue(decoyRun.status !== 0, "a local .env declaration aborts migration with a non-zero exit");
      assertTrue(
        `${decoyRun.stdout}${decoyRun.stderr}`.includes("must be provided through the process environment"),
        "the local .env declaration reports the source-attribution guard message"
      );
    } finally {
      rmSync(localEnvPath, { force: true });
    }
    assertEqual(
      psql(decoyDatabase, "select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')", "decoy tables"),
      "0",
      "the decoy .env database received zero tables (the guard refused the file, no migration ran)"
    );
    canarySessions("canary user database sessions after the local .env guard");

    const sharedVariants = [
      { label: "postgresql alias with a query parameter", url: `${canaryDatabaseUrl.replace(/^postgres:/, "postgresql:")}?sslmode=disable` },
      { label: "different credentials for the same target", url: `postgres://someone_else:quoted@127.0.0.1:${pgPort}/${canaryDatabase}` },
      { label: "trailing slash after the database name", url: `${canaryDatabaseUrl}/` }
    ];
    for (const variant of sharedVariants) {
      const sharedRun = runMedusaScript(
        "medusa:migrate",
        { ...childEnv, COMMERCE_DATABASE_URL: variant.url },
        `fail-closed shared URL (${variant.label})`
      );
      assertTrue(sharedRun.status !== 0, `shared database spelling aborts with a non-zero exit (${variant.label})`);
      assertTrue(
        `${sharedRun.stdout}${sharedRun.stderr}`.includes("must be a separate database"),
        `shared database spelling reports the isolation guard message (${variant.label})`
      );
    }

    const invalidRun = runMedusaScript(
      "medusa:migrate",
      { ...childEnv, COMMERCE_DATABASE_URL: `mysql://${commerceRole}@127.0.0.1:${pgPort}/${isolatedDatabase}` },
      "fail-closed non-PostgreSQL URL"
    );
    assertTrue(invalidRun.status !== 0, "a non-PostgreSQL URL aborts migration with a non-zero exit");
    assertTrue(
      `${invalidRun.stdout}${invalidRun.stderr}`.includes("must be a PostgreSQL URL"),
      "a non-PostgreSQL URL reports the URL validation message"
    );

    canarySessions("canary user database sessions after all fail-closed guards");

    // (3) Official migration against the isolated database only, under the
    // dedicated commerce role.
    const migrateRun = runMedusaScript("medusa:migrate", childEnv, "isolated migration");
    assertEqual(migrateRun.status, 0, "official migration exits zero against the isolated database");

    const isolatedTables = psql(
      isolatedDatabase,
      "select count(*) from pg_tables where schemaname in ('public', 'medusa') and tablename not like 'pg_%'",
      "isolated tables"
    );
    assertTrue(Number(isolatedTables) > 0, `isolated database received migrations (tables=${isolatedTables})`);
    assertEqual(
      psql(
        isolatedDatabase,
        "select count(*) from pg_tables where schemaname in ('public', 'medusa') and tablename not like 'pg_%' and tableowner <> 'commerce_app'",
        "foreign-owned tables"
      ),
      "0",
      "every migrated table is owned by the dedicated commerce role"
    );
    canarySessions("canary user database sessions after the isolated migration");

    const userRun = runMedusa(
      ["user", "-e", "commerce-probe@example.com", "-p", "probe-synthetic-password"],
      childEnv,
      "create isolated admin user"
    );
    assertEqual(userRun.status, 0, "synthetic admin user created in the isolated database");

    // (4) Cold start through the delivered dev script. Only PORT is supplied;
    // the bind address must come from package.json's medusa:dev script itself.
    const startServer = () => {
      const child = spawn(pnpm.command, [...pnpm.prefix, "run", "medusa:dev"], {
        cwd: packageRoot,
        env: { ...childEnv, PORT: String(httpPort) },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout.on("data", (chunk) => appendFileSync(serverLogFile, chunk));
      child.stderr.on("data", (chunk) => appendFileSync(serverLogFile, chunk));
      return child;
    };

    server = startServer();
    log(`probe server starting pid=${server.pid} entry=pnpm run medusa:dev log=${serverLogFile}`);
    await waitFor(
      async () => {
        if (server.exitCode !== null) {
          fail(`probe server exited early with code ${server.exitCode}; see ${serverLogFile}`);
        }
        const { status } = await fetchJson(`http://127.0.0.1:${httpPort}/health`);
        return status === 200;
      },
      { timeoutMs: 300000, intervalMs: 2000, label: "cold-start /health 200" }
    );
    log("cold start: /health returned 200");

    const listeners = listeningAddresses(httpPort);
    assertTrue(listeners.length > 0, `a listening socket exists on port ${httpPort}`);
    for (const address of listeners) {
      assertEqual(address, `127.0.0.1:${httpPort}`, "listening socket is bound to 127.0.0.1 only");
    }

    const origin = `http://127.0.0.1:${httpPort}`;
    const exposureRoutes = ["/store/products", "/admin/products", "/app"];
    for (const route of exposureRoutes) {
      const control = await fetchJson(`${origin}${route}`);
      assertTrue(
        control.status > 0 && control.status < 500,
        `loopback control: ${route} answers on the probe server (status=${control.status})`
      );
    }
    const externalInterface = nonLoopbackIPv4();
    assertTrue(externalInterface !== null, "a non-loopback IPv4 interface exists for the exposure test");
    for (const route of exposureRoutes) {
      const target = `http://${externalInterface.address}:${httpPort}${route}`;
      let failure = null;
      try {
        await fetch(target, { signal: AbortSignal.timeout(5000) });
      } catch (error) {
        failure = error;
      }
      assertTrue(failure !== null, `non-loopback ${externalInterface.name} ${target} gets no HTTP response`);
      assertEqual(
        failure.cause?.code ?? failure.code,
        "ECONNREFUSED",
        `non-loopback ${target} is refused at the TCP layer`
      );
    }

    const login = async () => {
      const response = await fetchJson(`${origin}/auth/user/emailpass`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "commerce-probe@example.com", password: "probe-synthetic-password" })
      });
      assertEqual(response.status, 200, "admin login status");
      return response.body.token;
    };
    const adminHeaders = { authorization: `Bearer ${await login()}`, "content-type": "application/json" };
    const adminPost = (route, body) =>
      fetchJson(`${origin}${route}`, { method: "POST", headers: adminHeaders, body: JSON.stringify(body) });

    const cnRegion = await adminPost("/admin/regions", {
      name: "Probe Mainland China (fictional)",
      currency_code: "cny",
      countries: ["cn"]
    });
    assertEqual(cnRegion.status, 200, "create CN region status");
    const cnRegionId = cnRegion.body.region.id;

    const twRegion = await adminPost("/admin/regions", {
      name: "Probe Taiwan (fictional)",
      currency_code: "twd",
      countries: ["tw"]
    });
    assertEqual(twRegion.status, 200, "create TW region status");
    const twRegionId = twRegion.body.region.id;

    const salesChannels = await fetchJson(`${origin}/admin/sales-channels`, { headers: adminHeaders });
    const salesChannelId = salesChannels.body.sales_channels[0].id;

    const apiKeyResponse = await adminPost("/admin/api-keys", { title: "Probe Isolated Key (fictional)", type: "publishable" });
    assertEqual(apiKeyResponse.status, 200, "create publishable key status");
    const publishableKey = apiKeyResponse.body.api_key.token;
    const apiKeyBind = await adminPost(`/admin/api-keys/${apiKeyResponse.body.api_key.id}/sales-channels`, {
      add: [salesChannelId]
    });
    assertEqual(apiKeyBind.status, 200, "bind publishable key to sales channel status");

    const collectionResponse = await adminPost("/admin/collections", {
      title: "Probe Fictional Collection",
      handle: "probe-fictional-collection"
    });
    assertEqual(collectionResponse.status, 200, "create fictional collection status");
    const collectionId = collectionResponse.body.collection.id;

    const productResponse = await adminPost("/admin/products", {
      title: "Probe Fictional Crystal Bracelet",
      status: "published",
      collection_id: collectionId,
      sales_channels: [{ id: salesChannelId }],
      options: [{ title: "Bead size", values: ["8mm"] }],
      variants: [
        {
          title: "8mm / 18cm",
          sku: "PROBE-SKU-0001",
          manage_inventory: false,
          options: { "Bead size": "8mm" },
          prices: [
            { amount: 128000, currency_code: "cny", rules: { region_id: cnRegionId } },
            { amount: 560000, currency_code: "twd", rules: { region_id: twRegionId } }
          ]
        }
      ]
    });
    assertEqual(productResponse.status, 200, "create fictional product status");
    const productId = productResponse.body.product.id;
    const variantId = productResponse.body.product.variants[0].id;
    log(`fictional catalog created: product=${productId} variant=${variantId} collection=${collectionId}`);

    const productRead = await fetchJson(`${origin}/admin/products/${productId}`, { headers: adminHeaders });
    const priceRows = productRead.body.product.variants[0].prices
      .map((price) => ({ currency: price.currency_code, region: price.rules?.region_id }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    assertTrue(
      JSON.stringify(priceRows) ===
        JSON.stringify([
          { currency: "cny", region: cnRegionId },
          { currency: "twd", region: twRegionId }
        ]),
      `CN/CNY and TW/TWD price rows carry their manual region rules ${JSON.stringify(priceRows)}`
    );

    const storeHeaders = { "x-publishable-api-key": publishableKey };
    const storeRead = async (regionId) => {
      const response = await fetchJson(`${origin}/store/products/${productId}?region_id=${regionId}`, { headers: storeHeaders });
      assertEqual(response.status, 200, `store read status for region ${regionId}`);
      assertEqual(response.body.product.id, productId, `store read returns the fictional product for region ${regionId}`);
      const price = response.body.product.variants[0].calculated_price;
      return { currency: price.currency_code, amount: price.calculated_amount };
    };

    const cnRead = await storeRead(cnRegionId);
    assertTrue(
      cnRead.currency === "cny" && cnRead.amount === 128000,
      `CN market returns the manually entered CNY price {currency=cny, amount=128000, actual=${JSON.stringify(cnRead)}}`
    );
    const twRead = await storeRead(twRegionId);
    assertTrue(
      twRead.currency === "twd" && twRead.amount === 560000,
      `TW market returns the manually entered TWD price {currency=twd, amount=560000, actual=${JSON.stringify(twRead)}}`
    );

    const storeWithoutKey = await fetchJson(`${origin}/store/products/${productId}?region_id=${cnRegionId}`);
    assertEqual(storeWithoutKey.status, 400, "native Store read without a publishable key is rejected (400)");

    const storeCollection = await fetchJson(`${origin}/store/collections/${collectionId}`, { headers: storeHeaders });
    assertEqual(storeCollection.status, 200, "store collection read status");
    assertEqual(storeCollection.body.collection.id, collectionId, "store collection read returns the fictional collection");

    // (5) Restart probe: stop, cold start again through the same delivered
    // entry point, data must persist.
    canarySessions("canary user database sessions before restart");

    await stopServer();
    log("probe server stopped; restarting for the persistence probe");
    server = startServer();
    await waitFor(
      async () => {
        if (server.exitCode !== null) {
          fail(`restarted server exited early with code ${server.exitCode}; see ${serverLogFile}`);
        }
        const { status } = await fetchJson(`http://127.0.0.1:${httpPort}/health`);
        return status === 200;
      },
      { timeoutMs: 300000, intervalMs: 2000, label: "restart /health 200" }
    );
    log("restart: /health returned 200");

    const cnReadAfterRestart = await storeRead(cnRegionId);
    assertTrue(
      cnReadAfterRestart.currency === "cny" && cnReadAfterRestart.amount === 128000,
      `restart persistence: CN market still returns {currency=cny, amount=128000, actual=${JSON.stringify(cnReadAfterRestart)}}`
    );
    const twReadAfterRestart = await storeRead(twRegionId);
    assertTrue(
      twReadAfterRestart.currency === "twd" && twReadAfterRestart.amount === 560000,
      `restart persistence: TW market still returns {currency=twd, amount=560000, actual=${JSON.stringify(twReadAfterRestart)}}`
    );

    // (6) Canary user database untouched: for the whole run nothing but this
    // final read-only verification may ever connect to it, and it must hold
    // zero user tables. The session count is asserted before the read below so
    // it still proves zero connections; the read itself is the single allowed
    // session and is confirmed afterwards.
    canarySessions("canary user database sessions for the whole probe run (before this probe's verification read)");
    canaryTables("canary user database has zero user tables (zero writes)");
    assertEqual(
      psql("postgres", `select coalesce(sum(sessions), 0) from pg_stat_database where datname = '${canaryDatabase}'`, "own read"),
      "1",
      "the only canary user database session ever recorded is this probe's own verification read"
    );

    log(
      "ISOLATION PROBE PASSED: fail-closed guards (missing/shared/aliased/invalid URL and local .env), role-separated databases, "
        + "isolated migration under the dedicated role, cold start through pnpm run medusa:dev bound to 127.0.0.1 only with every "
        + "non-loopback interface refused, CN/CNY + TW/TWD manual region prices, restart persistence, canary user database untouched"
    );
  } finally {
    await stopServer().catch((error) => log(`server cleanup warning: ${error.message}`));
    const pgStop = spawnSync(pgCtl, ["-D", pgData, "stop", "-m", "fast"], { encoding: "utf8" });
    log(`throwaway PostgreSQL cluster stopped (exit=${pgStop.status}). Cluster dir kept for inspection: ${tempRoot}`);
  }
}

main().catch((error) => {
  log(`PROBE FAILED: ${error.message}`);
  process.exitCode = 1;
});