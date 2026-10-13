import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveCommerceDatabaseUrl } from "../src/isolation/env";

// TASK-COMMERCE-GATE-001 isolated publication integration.
//
// This is the end-to-end gate: it runs the generated showroom migration against
// a brand-new isolated PostgreSQL database, boots the delivered Medusa server
// through the package dev script, and drives the real public/admin HTTP surface.
// It proves the module registers, the gate serves only approved work, a revoke
// propagates on the next read, cross-locale and cross-market reads fail closed,
// and the Mystcrag user database is never written to.
//
// It only runs when an explicit isolated database and a canary user-database URL
// are supplied. Without them it is skipped, so the ordinary commerce test run
// stays fast and touches no database. Never point these at a real database.

const commerceRoot = path.resolve(__dirname, "..");

const isolatedUrl = process.env.COMMERCE_SHOWROOM_INTEGRATION_DATABASE_URL?.trim() ?? "";
const canaryUrl = process.env.COMMERCE_SHOWROOM_CANARY_DATABASE_URL?.trim() ?? "";
const psqlUser = process.env.COMMERCE_SHOWROOM_INTEGRATION_PSQL_USER?.trim() || "postgres";
const evidenceDir = process.env.COMMERCE_SHOWROOM_EVIDENCE_DIR
  ?? path.join(os.tmpdir(), "mystcrag-showroom-gate-001");

const enabled = isolatedUrl.length > 0 && canaryUrl.length > 0;
const skipReason = enabled
  ? false
  : "set COMMERCE_SHOWROOM_INTEGRATION_DATABASE_URL and COMMERCE_SHOWROOM_CANARY_DATABASE_URL to run the isolated showroom integration";

function resolvePnpm(): { command: string; prefix: string[] } {
  const execPath = process.env.npm_execpath;
  if (execPath && execPath.length > 0) {
    return { command: process.execPath, prefix: [execPath] };
  }
  return { command: "pnpm", prefix: [] };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(command, args, { cwd: commerceRoot, env, encoding: "utf8" });
}

function targetOf(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: decodeURI(parsed.pathname).replace(/^\/+/, ""),
    user: decodeURIComponent(parsed.username)
  };
}

function psql(database: string, sql: string) {
  const parsed = new URL(database);
  const result = spawnSync(
    "psql",
    [
      "-h",
      parsed.hostname,
      "-p",
      parsed.port || "5432",
      "-U",
      psqlUser,
      "-d",
      decodeURI(parsed.pathname).replace(/^\/+/, ""),
      "-tAc",
      sql
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function waitForHealth(origin: string, child: ReturnType<typeof spawn>, logFile: string) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}; see ${logFile}`);
    }
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(5000) });
      if (response.status === 200) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`timed out waiting for ${origin}/health; see ${logFile}`);
}

test(
  "the isolated publication gate serves only approved work, closes on revoke, and never writes the user database",
  { skip: skipReason, timeout: 600_000 },
  async () => {
    // (1) The isolated database must be a fresh, separate target.
    const resolved = resolveCommerceDatabaseUrl({
      COMMERCE_DATABASE_URL: isolatedUrl,
      DATABASE_URL: canaryUrl
    });
    assert.equal(resolved, isolatedUrl, "the separated isolated URL is accepted");
    const isolated = targetOf(isolatedUrl);
    const canary = targetOf(canaryUrl);
    assert.match(isolated.database, /(?:test|isolation)/i, "the integration database must be an isolated test database");
    assert.notEqual(
      `${isolated.host}:${isolated.port}/${isolated.database}`,
      `${canary.host}:${canary.port}/${canary.database}`,
      "the integration database must differ from the canary user database"
    );

    const freshTables = psql(
      isolatedUrl,
      "select count(*) from pg_tables where schemaname in ('public','medusa') and tablename not like 'pg_%'"
    );
    assert.equal(freshTables, "0", "the isolated database must start empty (a brand-new test database)");

    mkdirSync(evidenceDir, { recursive: true });
    const serverLog = path.join(evidenceDir, "showroom-integration-server.log");
    const pnpm = resolvePnpm();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "development",
      COMMERCE_DATABASE_URL: isolatedUrl,
      DATABASE_URL: canaryUrl,
      JWT_SECRET: "showroom-integration-jwt-secret-0123456789",
      COOKIE_SECRET: "showroom-integration-cookie-secret-0123456789",
      MEDUSA_DISABLE_TELEMETRY: "true"
    };

    // (2) The generated showroom migration must apply to the isolated database.
    const migrate = run(pnpm.command, [...pnpm.prefix, "run", "medusa:migrate"], env);
    assert.equal(
      migrate.status,
      0,
      `medusa db:migrate must succeed against the isolated database: ${migrate.stdout}${migrate.stderr}`
    );
    assert.equal(
      psql(
        isolatedUrl,
        "select count(*) from pg_tables where schemaname = 'public' and tablename = 'showroom_approval_record'"
      ),
      "1",
      "the generated showroom_approval_record migration must be applied"
    );

    const user = run(
      pnpm.command,
      [...pnpm.prefix, "exec", "medusa", "user", "-e", "showroom-gate@example.com", "-p", "showroom-synthetic-password"],
      env
    );
    assert.equal(user.status, 0, "a synthetic isolated admin user is created");

    // (3) Boot the delivered server through the same script developers use.
    const origin = "http://127.0.0.1:9001";
    const child = spawn(pnpm.command, [...pnpm.prefix, "run", "medusa:dev"], {
      cwd: commerceRoot,
      env: { ...env, PORT: "9001" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", () => {});

    const stop = async () => {
      if (child.exitCode !== null) {
        return;
      }
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        // already gone
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (child.exitCode === null) {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          // already gone
        }
      }
    };

    try {
      await waitForHealth(origin, child, serverLog);

      const login = await fetchJson(`${origin}/auth/user/emailpass`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "showroom-gate@example.com", password: "showroom-synthetic-password" })
      });
      assert.equal(login.status, 200, "admin login");
      const adminHeaders = { authorization: `Bearer ${login.body.token}`, "content-type": "application/json" };
      const adminPost = (route: string, body: unknown) =>
        fetchJson(`${origin}${route}`, { method: "POST", headers: adminHeaders, body: JSON.stringify(body) });

      const region = await adminPost("/admin/regions", {
        name: "Showroom Integration CN (fictional)",
        currency_code: "cny",
        countries: ["cn"]
      });
      assert.equal(region.status, 200, "create the CN region");
      const regionId = region.body.region.id;

      const salesChannels = await fetchJson(`${origin}/admin/sales-channels`, { headers: adminHeaders });
      const salesChannelId = salesChannels.body.sales_channels[0].id;

      const apiKey = await adminPost("/admin/api-keys", { title: "Showroom Integration Key (fictional)", type: "publishable" });
      assert.equal(apiKey.status, 200, "create the publishable key");
      await adminPost(`/admin/api-keys/${apiKey.body.api_key.id}/sales-channels`, { add: [salesChannelId] });

      const collection = await adminPost("/admin/collections", {
        title: "Showroom Integration Collection (fictional)",
        handle: "showroom-integration-collection"
      });
      assert.equal(collection.status, 200, "create the fictional collection");

      const product = await adminPost("/admin/products", {
        title: "Showroom Integration Bracelet (fictional)",
        status: "published",
        handle: "showroom-integration-bracelet",
        collection_id: collection.body.collection.id,
        sales_channels: [{ id: salesChannelId }],
        options: [{ title: "Bead size", values: ["8mm"] }],
        variants: [
          {
            title: "8mm",
            sku: "SHOWROOM-INTEGRATION-SKU-1",
            manage_inventory: false,
            options: { "Bead size": "8mm" },
            prices: [{ amount: 128000, currency_code: "cny", rules: { region_id: regionId } }]
          }
        ]
      });
      assert.equal(product.status, 200, "create the fictional product");
      const productId = product.body.product.id;
      const handle = product.body.product.handle;

      // The public surface must see nothing before an approval exists.
      const before = await fetchJson(`${origin}/api/showroom/products?market=CN&locale=zh-CN`);
      assert.equal(before.status, 200, "the public list answers before approval");
      assert.deepEqual(before.body.items, [], "an unapproved product is excluded from the public list");
      const beforeDetail = await fetchJson(`${origin}/api/showroom/products/${handle}?market=CN&locale=zh-CN`);
      assert.equal(beforeDetail.status, 404, "an unapproved product detail is 404");

      const approval = await adminPost(`/admin/showroom-approvals/${productId}`, {
        action: "APPROVE",
        publicRevision: 1,
        authorization: {
          status: "APPROVED",
          markets: ["CN", "TW"],
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          expiresAt: "2027-01-01T00:00:00.000Z"
        },
        availability: "INQUIRY_ONLY",
        prices: { CN: { currency: "CNY", amountMinor: 128000, regionId } },
        locales: {
          "zh-CN": {
            reviewedRevision: 1,
            title: "无野 · 静水手链",
            summary: "天然的静水石与黄铜细节。",
            materials: ["天然静水石", "黄铜"],
            specifications: [{ label: "内径", value: "16cm" }],
            designer: { slug: "designer-lin", displayName: "林也" }
          }
        },
        media: [
          {
            url: "/showroom/wuye/hero.webp",
            alt: "手链正视图",
            checksum: "sha256:integration",
            approved: true,
            withdrawn: false
          }
        ]
      });
      assert.equal(approval.status, 200, `approval must be accepted: ${JSON.stringify(approval.body)}`);
      assert.equal(approval.body.audit.length, 1, "the approval is audited");
      assert.equal(approval.body.audit[0].action, "APPROVED");

      const listed = await fetchJson(`${origin}/api/showroom/products?market=CN&locale=zh-CN`);
      assert.equal(listed.status, 200);
      assert.equal(listed.body.items.length, 1, "the approved product appears in the public list");
      assert.equal(listed.body.items[0].slug, handle);
      assert.equal(listed.body.items[0].price.currency, "CNY");
      assert.equal(listed.body.items[0].availability, "INQUIRY_ONLY");

      const detail = await fetchJson(`${origin}/api/showroom/products/${handle}?market=CN&locale=zh-CN`);
      assert.equal(detail.status, 200, "the approved product detail is served for its reviewed locale");

      // Cross-locale and cross-market fail closed.
      const otherLocale = await fetchJson(`${origin}/api/showroom/products/${handle}?market=CN&locale=en-US`);
      assert.equal(otherLocale.status, 404, "a locale with no reviewed copy is 404, never a fallback");
      const otherMarket = await fetchJson(`${origin}/api/showroom/products?market=TW&locale=zh-TW`);
      assert.equal(otherMarket.status, 200);
      assert.deepEqual(otherMarket.body.items, [], "the product has no approved TW price, so TW excludes it");

      // A relayed store credential cannot reach the public surface.
      const relayed = await fetchJson(`${origin}/api/showroom/products?market=CN&locale=zh-CN`, {
        headers: { "x-publishable-api-key": "pk_synthetic" }
      });
      assert.equal(relayed.status, 400, "the public bypass policy refuses a relayed store key");

      const revoked = await adminPost(`/admin/showroom-approvals/${productId}`, {
        action: "REVOKE",
        reason: "integration revocation"
      });
      assert.equal(revoked.status, 200, "revoke is accepted");
      assert.equal(revoked.body.audit.length, 2, "the revoke is appended to the audit trail");
      assert.equal(revoked.body.audit[1].action, "REVOKED");

      const afterRevoke = await fetchJson(`${origin}/api/showroom/products?market=CN&locale=zh-CN`);
      assert.deepEqual(afterRevoke.body.items, [], "a revoke closes the public list on the next read");
      const afterRevokeDetail = await fetchJson(`${origin}/api/showroom/products/${handle}?market=CN&locale=zh-CN`);
      assert.equal(afterRevokeDetail.status, 404, "a revoke closes the public detail on the next read");

      // The Mystcrag user database stand-in must hold zero user tables.
      assert.equal(
        psql(canaryUrl, "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')"),
        "0",
        "the canary user database received zero tables for the whole run"
      );
    } finally {
      await stop();
    }
  }
);
