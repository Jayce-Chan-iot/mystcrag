import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveCommerceDatabaseUrl } from "../src/isolation/env";

// TASK-COMMERCE-GATE-001 isolated publication integration.
//
// This is the end-to-end gate: it runs the generated showroom migrations against
// a brand-new isolated PostgreSQL database, boots the delivered Medusa server
// through the package dev script, and drives the real public/admin HTTP surface.
// It proves the module registers, the database enforces one row per subject, the
// gate serves only approved work, concurrent first approvals never duplicate or
// lose an audit event, a withdrawn asset is never reintroduced by a replayed
// APPROVE, an Admin translation edit after approval fails the public read closed,
// a revoke propagates on the next read, and the Mystcrag user database is never
// written to.
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
  { skip: skipReason, timeout: 900_000 },
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

    // (2) The generated showroom migrations must apply to the isolated database.
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
    assert.equal(
      psql(
        isolatedUrl,
        "select count(*) from pg_indexes where tablename = 'showroom_approval_record' and indexname = 'IDX_showroom_approval_record_subject_kind_subject_ref_unique'"
      ),
      "1",
      "the generated unique subject_kind + subject_ref index must be applied"
    );

    const user = run(
      pnpm.command,
      [...pnpm.prefix, "exec", "medusa", "user", "-e", "showroom-gate@example.com", "-p", "showroom-synthetic-password"],
      env
    );
    assert.equal(user.status, 0, `a synthetic isolated admin user is created: ${user.stdout}${user.stderr}`);

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
      const adminGet = (route: string) => fetchJson(`${origin}${route}`, { headers: adminHeaders });

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

      const createProduct = async (index: number) => {
        const product = await adminPost("/admin/products", {
          title: `Showroom Integration Bracelet ${index} (fictional)`,
          status: "published",
          handle: `showroom-integration-bracelet-${index}`,
          collection_id: collection.body.collection.id,
          sales_channels: [{ id: salesChannelId }],
          options: [{ title: "Bead size", values: ["8mm"] }],
          variants: [
            {
              title: "8mm",
              sku: `SHOWROOM-INTEGRATION-SKU-${index}`,
              manage_inventory: false,
              options: { "Bead size": "8mm" },
              prices: [{ amount: 128000, currency_code: "cny", rules: { region_id: regionId } }]
            }
          ]
        });
        assert.equal(product.status, 200, `create fictional product ${index}`);
        return { id: String(product.body.product.id), handle: String(product.body.product.handle) };
      };

      const approvePayload = (checksum: string) => ({
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
          { url: "/showroom/wuye/hero.webp", alt: "手链正视图", checksum, approved: true, withdrawn: false }
        ]
      });

      const rowsFor = (productId: string) =>
        psql(
          isolatedUrl,
          `select count(*) from showroom_approval_record where subject_kind = 'PRODUCT' and subject_ref = '${productId}'`
        );
      const publicList = (market = "CN", locale = "zh-CN") =>
        fetchJson(`${origin}/api/showroom/products?market=${market}&locale=${locale}`);
      const publicDetail = (handle: string, market = "CN", locale = "zh-CN") =>
        fetchJson(`${origin}/api/showroom/products/${handle}?market=${market}&locale=${locale}`);
      const isListed = async (handle: string) => {
        const page = await publicList();
        assert.equal(page.status, 200);
        return page.body.items.some((item: any) => item.slug === handle);
      };

      const one = await createProduct(1);

      // The public surface must see nothing before an approval exists.
      const before = await publicList();
      assert.equal(before.status, 200, "the public list answers before approval");
      assert.deepEqual(before.body.items, [], "an unapproved product is excluded from the public list");
      assert.equal((await publicDetail(one.handle)).status, 404, "an unapproved product detail is 404");

      // (4) A first approval is one audited decision and publishes on the next read.
      const approval = await adminPost(`/admin/showroom-approvals/${one.id}`, approvePayload("sha256:integration-one"));
      assert.equal(approval.status, 200, `approval must be accepted: ${JSON.stringify(approval.body)}`);
      assert.equal(approval.body.audit.length, 1, "the approval is audited once");
      assert.equal(approval.body.audit[0].action, "APPROVED");
      // The audit event carries the version, authorization and affected media facts.
      assert.equal(approval.body.audit[0].publicRevision, 1, "the audit event records the approved public revision");
      assert.equal(approval.body.audit[0].authorizationStatus, "APPROVED");
      assert.deepEqual(approval.body.audit[0].markets, ["CN", "TW"]);
      assert.equal(approval.body.audit[0].approvedMedia.length, 1);
      assert.equal(approval.body.audit[0].approvedMedia[0].checksum, "sha256:integration-one");
      assert.equal(rowsFor(one.id), "1", "exactly one approval row exists for the subject");

      const listed = await publicList();
      assert.equal(listed.status, 200);
      assert.equal(listed.body.items.length, 1, "the approved product appears in the public list");
      assert.equal(listed.body.items[0].slug, one.handle);
      assert.equal(listed.body.items[0].price.currency, "CNY");
      assert.equal(listed.body.items[0].availability, "INQUIRY_ONLY");

      const detail = await publicDetail(one.handle);
      assert.equal(detail.status, 200, "the approved product detail is served for its reviewed locale");

      // Cross-locale and cross-market fail closed.
      assert.equal((await publicDetail(one.handle, "CN", "en-US")).status, 404, "a locale with no reviewed copy is 404, never a fallback");
      const otherMarket = await publicList("TW", "zh-TW");
      assert.equal(otherMarket.status, 200);
      assert.deepEqual(otherMarket.body.items, [], "the product has no approved TW price, so TW excludes it");

      // A relayed store credential cannot reach the public surface.
      const relayed = await fetchJson(`${origin}/api/showroom/products?market=CN&locale=zh-CN`, {
        headers: { "x-publishable-api-key": "pk_synthetic" }
      });
      assert.equal(relayed.status, 400, "the public bypass policy refuses a relayed store key");
      assert.equal(relayed.body.error.code, "VALIDATION_ERROR", "the public refusal uses the shared envelope");
      assert.equal(typeof relayed.body.error.requestId, "string");

      // (5) Re-importing the identical APPROVE is idempotent: one row, one more audit.
      const reimport = await adminPost(`/admin/showroom-approvals/${one.id}`, approvePayload("sha256:integration-one"));
      assert.equal(reimport.status, 200, "a duplicate import is accepted");
      assert.equal(reimport.body.audit.length, 2, "the duplicate import appends exactly one audit event");
      assert.equal(rowsFor(one.id), "1", "a duplicate import never creates a second row");
      assert.equal(await isListed(one.handle), true, "the product still serves after a duplicate import");

      // (6) Withdrawing one asset closes the subject; replaying the original
      // APPROVE never reintroduces the withdrawn asset.
      const withdrawn = await adminPost(`/admin/showroom-approvals/${one.id}`, {
        action: "WITHDRAW_MEDIA",
        checksum: "sha256:integration-one",
        reason: "integration media withdrawal"
      });
      assert.equal(withdrawn.status, 200, "the media withdrawal is accepted");
      assert.equal(withdrawn.body.audit.length, 3);
      assert.equal(withdrawn.body.audit[2].action, "MEDIA_WITHDRAWN");
      assert.equal(withdrawn.body.audit[2].publicRevision, 1, "the withdrawal records the revision it applied to");
      assert.equal(withdrawn.body.audit[2].withdrawnMedia.checksum, "sha256:integration-one");
      assert.equal(await isListed(one.handle), false, "the withdrawal closes the public list");
      assert.equal((await publicDetail(one.handle)).status, 404, "the withdrawal closes the public detail");

      const replay = await adminPost(`/admin/showroom-approvals/${one.id}`, approvePayload("sha256:integration-one"));
      assert.equal(replay.status, 200, "the replayed APPROVE is accepted");
      assert.equal(replay.body.audit.length, 4, "the replay appends exactly one audit event");
      const storedMedia = replay.body.approval.media[0];
      assert.equal(storedMedia.withdrawn, true, "the withdrawal fact survives the replayed approval");
      assert.equal(await isListed(one.handle), false, "a replayed APPROVE never reintroduces a withdrawn asset");
      assert.equal((await publicDetail(one.handle)).status, 404, "the replayed APPROVE leaves the detail closed");
      assert.equal(rowsFor(one.id), "1", "the replay still keeps exactly one row");

      // (7) Concurrent first approvals: one row, every decision audited.
      const two = await createProduct(2);
      const concurrency = 6;
      const concurrent = await Promise.all(
        Array.from({ length: concurrency }, () =>
          adminPost(`/admin/showroom-approvals/${two.id}`, approvePayload("sha256:integration-two"))
        )
      );
      for (const result of concurrent) {
        assert.equal(result.status, 200, `each concurrent approval is accepted: ${JSON.stringify(result.body)}`);
      }
      assert.equal(rowsFor(two.id), "1", "concurrent first approvals persist exactly one row");
      const twoApproval = await adminGet(`/admin/showroom-approvals/${two.id}`);
      assert.equal(twoApproval.status, 200);
      assert.equal(
        twoApproval.body.audit.length,
        concurrency,
        "every concurrent first approval appends its own audit event, none is lost"
      );

      // (8) An Admin translation edit after approval fails the public read closed
      // until the copy is reviewed again.
      const three = await createProduct(3);
      const threeApproval = await adminPost(`/admin/showroom-approvals/${three.id}`, approvePayload("sha256:integration-three"));
      assert.equal(threeApproval.status, 200, "the third product is approved");
      assert.equal(await isListed(three.handle), true, "the third product serves while its translation is unchanged");

      const translationEdit = await adminPost("/admin/translations/batch", {
        create: [
          {
            reference_id: three.id,
            reference: "product",
            locale_code: "zh-CN",
            translations: { title: "无野 · 静水手链（管理员改动）" }
          }
        ]
      });
      assert.equal(translationEdit.status, 200, `the translation edit is accepted: ${JSON.stringify(translationEdit.body)}`);
      assert.equal(await isListed(three.handle), false, "an edited translation excludes the product from the public list");
      assert.equal((await publicDetail(three.handle)).status, 404, "an edited translation closes the public detail");

      const reReviewed = await adminPost(`/admin/showroom-approvals/${three.id}`, approvePayload("sha256:integration-three"));
      assert.equal(reReviewed.status, 200, "a new review after the translation edit is accepted");
      assert.equal(await isListed(three.handle), true, "the re-reviewed product serves again");
      assert.equal((await publicDetail(three.handle)).status, 200, "the re-reviewed detail serves again");

      // (9) A revoke closes both the public list and the detail on the next read.
      const revoked = await adminPost(`/admin/showroom-approvals/${three.id}`, {
        action: "REVOKE",
        reason: "integration revocation"
      });
      assert.equal(revoked.status, 200, "revoke is accepted");
      assert.equal(revoked.body.audit[revoked.body.audit.length - 1].action, "REVOKED");
      assert.equal(revoked.body.audit[revoked.body.audit.length - 1].authorizationStatus, "REVOKED");
      assert.equal(await isListed(three.handle), false, "a revoke closes the public list on the next read");
      assert.equal((await publicDetail(three.handle)).status, 404, "a revoke closes the public detail on the next read");

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
