#!/usr/bin/env node
/**
 * Isolated cold-start / restart probe for TASK-COMMERCE-MEDUSA-BASE-001.
 *
 * Creates a throwaway PostgreSQL cluster in a system temp directory with two
 * databases:
 *   - commerce_isolation_probe : the only database the Medusa base may use
 *   - mystcrag_user_canary_db  : stands in for the Mystcrag user DATABASE_URL
 *                                and must stay untouched (zero tables, zero
 *                                sessions) for the whole run
 *
 * It then proves, with fictional data only:
 *   1. missing / shared COMMERCE_DATABASE_URL fails closed before any connect
 *   2. official migrations run against the isolated database only
 *   3. cold start serves Admin + Store API on loopback
 *   4. fictional product / variant / collection with CN/CNY and TW/TWD
 *      manually entered region-rule prices read back per market
 *   5. a full restart keeps the data (persistence probe)
 *
 * Evidence log: output/playwright/task-commerce-medusa-base-001/probe-isolation.log
 * (override with COMMERCE_PROBE_EVIDENCE_DIR). Never touches the real
 * Mystcrag database, ports of other services, or any other process.
 */

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const evidenceDir =
  process.env.COMMERCE_PROBE_EVIDENCE_DIR ?? path.join(repoRoot, "output", "playwright", "task-commerce-medusa-base-001");
const evidenceFile = path.join(evidenceDir, "probe-isolation.log");
const medusaBin = path.join(packageRoot, "node_modules", ".bin", "medusa");

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

function requireTool(tool) {
  const result = spawnSync("which", [tool], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`required tool not found on PATH: ${tool}`);
  }
}

function runMedusa(args, env, label) {
  const result = run(medusaBin, args, { cwd: packageRoot, env });
  log(`medusa ${args.join(" ")} (${label}) exit=${result.status}`);
  return result;
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
  for (const tool of ["initdb", "pg_ctl", "createdb", "psql"]) {
    requireTool(tool);
  }

  const version = runMedusa(["--version"], { ...process.env }, "version probe");
  log(`medusa CLI version output: ${(version.stdout + version.stderr).trim().split("\n").slice(-1)[0]}`);

  const pgPort = await freePort();
  const httpPort = await freePort();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "mystcrag-commerce-base-001-"));
  const pgData = path.join(tempRoot, "pgdata");
  const serverLogFile = path.join(tempRoot, "medusa-server.log");
  log(`throwaway cluster dir=${tempRoot} pgPort=${pgPort} httpPort=${httpPort}`);

  const isolatedDatabaseUrl = `postgres://commerce_probe@127.0.0.1:${pgPort}/commerce_isolation_probe`;
  const canaryDatabaseUrl = `postgres://commerce_probe@127.0.0.1:${pgPort}/mystcrag_user_canary_db`;
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
    // (1) Throwaway cluster + isolated probe database + untouched canary database.
    run("initdb", ["-D", pgData, "-U", "commerce_probe", "--auth=trust", "-E", "UTF8"]);
    run("pg_ctl", ["-D", pgData, "-o", `-p ${pgPort} -k ${tempRoot} -h 127.0.0.1`, "-l", path.join(tempRoot, "pg.log"), "start"]);
    run("createdb", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "commerce_probe", "commerce_isolation_probe"]);
    run("createdb", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "commerce_probe", "mystcrag_user_canary_db"]);
    log("throwaway PostgreSQL cluster started with isolated + canary databases");

    // (2) Fail-closed checks: missing and shared COMMERCE_DATABASE_URL must not
    // fall back to DATABASE_URL, and must not connect anywhere.
    const missingUrlEnv = { ...childEnv };
    delete missingUrlEnv.COMMERCE_DATABASE_URL;
    const missingRun = runMedusa(["db:migrate"], missingUrlEnv, "fail-closed missing URL");
    assertTrue(missingRun.status !== 0, "missing COMMERCE_DATABASE_URL aborts migration with a non-zero exit");
    assertTrue(
      `${missingRun.stdout}${missingRun.stderr}`.includes("COMMERCE_DATABASE_URL is required"),
      "missing COMMERCE_DATABASE_URL reports the isolation guard message"
    );

    const sharedUrlRun = runMedusa(
      ["db:migrate"],
      { ...childEnv, COMMERCE_DATABASE_URL: canaryDatabaseUrl },
      "fail-closed shared URL"
    );
    assertTrue(sharedUrlRun.status !== 0, "COMMERCE_DATABASE_URL equal to DATABASE_URL aborts with a non-zero exit");
    assertTrue(
      `${sharedUrlRun.stdout}${sharedUrlRun.stderr}`.includes("must be a separate database"),
      "shared database configuration reports the isolation guard message"
    );

    const canarySessionsAfterGuards = run("psql", [
      "-h",
      "127.0.0.1",
      "-p",
      String(pgPort),
      "-U",
      "commerce_probe",
      "-d",
      "postgres",
      "-tAc",
      "select coalesce(sum(sessions), 0) from pg_stat_database where datname = 'mystcrag_user_canary_db'"
    ]);
    assertEqual(canarySessionsAfterGuards.stdout.trim(), "0", "canary user database sessions after fail-closed guards");

    // (3) Official migration against the isolated database only.
    const migrateRun = runMedusa(["db:migrate"], childEnv, "isolated migration");
    assertEqual(migrateRun.status, 0, "official migration exits zero against the isolated database");

    const isolatedTables = run("psql", [
      "-h",
      "127.0.0.1",
      "-p",
      String(pgPort),
      "-U",
      "commerce_probe",
      "-d",
      "commerce_isolation_probe",
      "-tAc",
      "select count(*) from pg_tables where schemaname in ('public', 'medusa') and tablename not like 'pg_%'"
    ]);
    assertTrue(Number(isolatedTables.stdout.trim()) > 0, `isolated database received migrations (tables=${isolatedTables.stdout.trim()})`);

    const userRun = runMedusa(
      ["user", "-e", "commerce-probe@example.com", "-p", "probe-synthetic-password"],
      childEnv,
      "create isolated admin user"
    );
    assertEqual(userRun.status, 0, "synthetic admin user created in the isolated database");

    // (4) Cold start on loopback.
    const startServer = () => {
      const child = spawn(
        medusaBin,
        ["develop", "--no-lint", "--host", "127.0.0.1", "--port", String(httpPort)],
        { cwd: packageRoot, env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] }
      );
      child.stdout.on("data", (chunk) => appendFileSync(serverLogFile, chunk));
      child.stderr.on("data", (chunk) => appendFileSync(serverLogFile, chunk));
      return child;
    };

    server = startServer();
    log(`probe server starting pid=${server.pid} log=${serverLogFile}`);
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

    const origin = `http://127.0.0.1:${httpPort}`;
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

    // (5) Restart probe: stop, cold start again, data must persist.
    const canarySessionsBeforeRestart = run("psql", [
      "-h", "127.0.0.1", "-p", String(pgPort), "-U", "commerce_probe", "-d", "postgres", "-tAc",
      "select coalesce(sum(sessions), 0) from pg_stat_database where datname = 'mystcrag_user_canary_db'"
    ]);
    assertEqual(canarySessionsBeforeRestart.stdout.trim(), "0", "canary user database sessions before restart");

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

    // (6) Canary user database untouched: zero tables and zero sessions for the
    // whole run (the only connection to it is this read-only count).
    const canarySessionsFinal = run("psql", [
      "-h", "127.0.0.1", "-p", String(pgPort), "-U", "commerce_probe", "-d", "postgres", "-tAc",
      "select coalesce(sum(sessions), 0) from pg_stat_database where datname = 'mystcrag_user_canary_db'"
    ]);
    assertEqual(canarySessionsFinal.stdout.trim(), "0", "canary user database sessions for the whole probe run");

    const canaryTables = run("psql", [
      "-h", "127.0.0.1", "-p", String(pgPort), "-U", "commerce_probe", "-d", "mystcrag_user_canary_db", "-tAc",
      "select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')"
    ]);
    assertEqual(canaryTables.stdout.trim(), "0", "canary user database has zero user tables (zero writes)");

    log("ISOLATION PROBE PASSED: fail-closed guards, isolated migration, cold start, CN/CNY + TW/TWD manual region prices, restart persistence, canary user database untouched");
  } finally {
    await stopServer().catch((error) => log(`server cleanup warning: ${error.message}`));
    const pgStop = spawnSync("pg_ctl", ["-D", pgData, "stop", "-m", "fast"], { encoding: "utf8" });
    log(`throwaway PostgreSQL cluster stopped (exit=${pgStop.status}). Cluster dir kept for inspection: ${tempRoot}`);
  }
}

main().catch((error) => {
  log(`PROBE FAILED: ${error.message}`);
  process.exitCode = 1;
});