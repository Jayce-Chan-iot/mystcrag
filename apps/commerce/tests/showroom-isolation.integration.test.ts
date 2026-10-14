import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveCommerceDatabaseUrl } from "../src/isolation/env";

// TASK-COMMERCE-GATE-001 isolated publication integration.
//
// This is the end-to-end gate: it runs the generated showroom migrations against
// a brand-new isolated PostgreSQL database, boots two independent writer
// processes (two Medusa servers sharing that database) through the package dev
// script, and drives the real public/admin HTTP surface. It proves the module
// registers, the database enforces one row per subject, the gate serves only
// approved work, concurrent first approvals never duplicate or lose an audit
// event, two independent writers acting on one existing approval row neither
// lose an audit event nor overwrite a withdrawal, a withdrawn asset stays
// withdrawn across an arbitrary sequence of later approvals, withdrawing an
// unknown checksum is refused, an Admin translation edit after approval fails
// the public read closed, a revoke propagates on the next read, the full
// approved copy is audited, and the Mystcrag user database is never written to.
//
// The cross-process case takes the approval row lock from an independent
// connection, reads that connection's backend PID (`pg_backend_pid()`), and
// confirms the lock is actually held with a `FOR UPDATE NOWAIT` probe; only then
// does it start the two writer requests and prove they overlap the held-lock
// period. The database links each blocked writer backend to the lock holder
// through the `pg_blocking_pids(pid)` block chain — followed transitively,
// because the two writers queue behind each other — which the test asserts on,
// and both requests stay in flight while it is observed. The holder and observer
// connections are released in a `finally`, including on timeout or assertion
// failure, and the two requests are always awaited, so no connection is leaked
// and no unhandled rejection is left behind. No fixed sleep stands in for that
// proof.
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

/**
 * The `pg` client, resolved through Medusa's own dependency chain. The commerce
 * package does not depend on `pg` directly, but the framework does, so the test
 * reaches it the same way the running server does.
 */
type PgClient = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
};

function loadPgClient(): new (config: { connectionString: string }) => PgClient {
  const requireFromCommerce = createRequire(path.join(commerceRoot, "index.js"));
  const frameworkUtils = requireFromCommerce.resolve("@medusajs/framework/utils");
  const orm = createRequire(frameworkUtils).resolve("@mikro-orm/postgresql");
  const pg = createRequire(orm)("pg") as {
    Client: new (config: { connectionString: string }) => PgClient;
  };
  return pg.Client;
}

const LOCK_APPROVAL_ROW_SQL =
  "select 1 from showroom_approval_record where subject_kind = 'PRODUCT' and subject_ref = $1 and deleted_at is null for update";

/**
 * Takes a `SELECT ... FOR UPDATE` row lock on one subject's approval record from
 * an independent PostgreSQL connection and returns that connection's backend PID
 * (`pg_backend_pid()`), so the blocked writer backends can be linked to this
 * exact holder afterwards. The returned `release` commits and closes the
 * connection on demand — the lock is held until the test explicitly releases it,
 * never for a fixed duration.
 */
async function acquireApprovalRowLock(
  productId: string
): Promise<{ holderPid: number; release: () => Promise<void> }> {
  const Client = loadPgClient();
  const holder = new Client({ connectionString: isolatedUrl });
  await holder.connect();
  await holder.query("begin");
  await holder.query(LOCK_APPROVAL_ROW_SQL, [productId]);
  const pidRow = await holder.query("select pg_backend_pid() as pid");
  const holderPid = Number(pidRow.rows[0].pid);
  return {
    holderPid,
    release: async () => {
      await holder.query("commit");
      await holder.end();
    }
  };
}

/**
 * Confirms, from a second independent connection, that another backend actually
 * holds the row lock right now. A `FOR UPDATE NOWAIT` probe is refused with
 * PostgreSQL's `lock_not_available` (`55P03`) only when the row is genuinely
 * locked by someone else.
 */
async function isApprovalRowLockHeld(productId: string): Promise<boolean> {
  const Client = loadPgClient();
  const probe = new Client({ connectionString: isolatedUrl });
  await probe.connect();
  try {
    await probe.query(`${LOCK_APPROVAL_ROW_SQL} nowait`, [productId]);
    return false;
  } catch (error) {
    return (error as { code?: string }).code === "55P03";
  } finally {
    await probe.end();
  }
}

/**
 * An asynchronous connection that reads `pg_stat_activity` and its
 * `pg_blocking_pids()` without blocking the event loop, so the in-flight write
 * requests keep progressing while the test observes the database. Every backend
 * waiting on a lock reports `wait_event_type = 'Lock'`, and `pg_blocking_pids(pid)`
 * names the backend(s) it waits behind. Two writers contending for one row queue
 * behind each other, so PostgreSQL forms a chain — the holder, then the first
 * waiter, then the second — and the second waiter's `pg_blocking_pids` names the
 * first waiter, not the holder. `blockedBy` therefore follows the block chain
 * transitively: a backend is linked to the holder when the holder appears
 * anywhere along its blocking path, so both writers are shown to wait on the
 * held lock rather than merely counted.
 */
async function openLockObserver(): Promise<{
  blockedBy: (holderPid: number) => Promise<number[]>;
  end: () => Promise<void>;
}> {
  const Client = loadPgClient();
  const observer = new Client({ connectionString: isolatedUrl });
  await observer.connect();
  return {
    blockedBy: async (holderPid: number) => {
      const result = await observer.query(
        "select pid, pg_blocking_pids(pid) as blockers from pg_stat_activity " +
          "where datname = current_database() and wait_event_type = 'Lock'"
      );
      const waits = new Map<number, number[]>();
      for (const row of result.rows as any[]) {
        waits.set(Number(row.pid), (row.blockers ?? []).map(Number));
      }
      const reachesHolder = (start: number): boolean => {
        const seen = new Set<number>();
        const stack = [start];
        while (stack.length > 0) {
          const pid = stack.pop()!;
          if (seen.has(pid)) {
            continue;
          }
          seen.add(pid);
          for (const blocker of waits.get(pid) ?? []) {
            if (blocker === holderPid) {
              return true;
            }
            stack.push(blocker);
          }
        }
        return false;
      };
      return [...waits.keys()].filter(reachesHolder);
    },
    end: async () => observer.end()
  };
}

/**
 * Polls the database until at least `expected` distinct writer backends are
 * blocked behind the lock held by `holderPid`, and returns those backend PIDs.
 * The block chain comes from `pg_blocking_pids`, followed transitively, so this
 * proves the writers wait on that specific holder connection — the first
 * directly and the second through the first — not merely that some backend
 * waits.
 */
async function waitForBlockedWriterBackends(
  observer: { blockedBy: (holderPid: number) => Promise<number[]> },
  holderPid: number,
  expected: number,
  timeoutMs: number
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let pids: number[] = [];
  while (Date.now() < deadline) {
    pids = [...new Set(await observer.blockedBy(holderPid))];
    if (pids.length >= expected) {
      return pids;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return pids;
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

    // (3) Boot two independent writer processes through the same script
    // developers use. They share the isolated database, so a decision made by
    // one process is visible to — and can race with — the other, exactly as two
    // replicas would.
    const serverLogStream = createWriteStream(serverLog, { flags: "a" });
    const startWriter = (port: number) => {
      const child = spawn(pnpm.command, [...pnpm.prefix, "run", "medusa:dev"], {
        cwd: commerceRoot,
        env: { ...env, PORT: String(port) },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      // Capture both writers' output into the evidence log the health check
      // references, so a stalled or failed boot is diagnosable after the fact.
      child.stdout?.pipe(serverLogStream);
      child.stderr?.pipe(serverLogStream);
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
      return { origin: `http://127.0.0.1:${port}`, child, stop };
    };

    const writerOne = startWriter(9001);
    const writerTwo = startWriter(9002);
    const origin = writerOne.origin;
    const originTwo = writerTwo.origin;

    const stop = async () => {
      await Promise.all([writerOne.stop(), writerTwo.stop()]);
    };

    try {
      await waitForHealth(origin, writerOne.child, serverLog);
      await waitForHealth(originTwo, writerTwo.child, serverLog);

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

      const loginTwo = await fetchJson(`${originTwo}/auth/user/emailpass`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "showroom-gate@example.com", password: "showroom-synthetic-password" })
      });
      assert.equal(loginTwo.status, 200, "second writer admin login");
      const adminHeadersTwo = { authorization: `Bearer ${loginTwo.body.token}`, "content-type": "application/json" };
      const adminPostTwo = (route: string, body: unknown) =>
        fetchJson(`${originTwo}${route}`, { method: "POST", headers: adminHeadersTwo, body: JSON.stringify(body) });

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

      const approvePayload = (checksums: string | string[]) => {
        const list = Array.isArray(checksums) ? checksums : [checksums];
        return {
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
          media: list.map((checksum, index) => ({
            url: `/showroom/wuye/hero-${index}.webp`,
            alt: `手链视图 ${index}`,
            checksum,
            approved: true,
            withdrawn: false,
            width: 1200,
            height: 900
          }))
        };
      };

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
      assert.equal(approval.body.audit[0].approvedMedia[0].alt, "手链视图 0", "the approved media alt is audited");
      assert.equal(approval.body.audit[0].approvedMedia[0].width, 1200, "the approved media width is audited");
      assert.equal(approval.body.audit[0].approvedMedia[0].height, 900, "the approved media height is audited");
      // The event also records the live product public facts a rebuild needs:
      // the handle (the public slug) and the Medusa status.
      assert.equal(approval.body.audit[0].handle, one.handle, "the live product handle is audited");
      assert.equal(approval.body.audit[0].productStatus, "published", "the live product status is audited");
      // The event also stores the facts needed to rebuild the public state:
      // the authorization window, the display state, the approved prices and the
      // full approved copy per reviewed locale of this decision.
      assert.equal(approval.body.audit[0].effectiveFrom, "2026-01-01T00:00:00.000Z", "the authorization window start is audited");
      assert.equal(approval.body.audit[0].expiresAt, "2027-01-01T00:00:00.000Z", "the authorization expiry is audited");
      assert.equal(approval.body.audit[0].availability, "INQUIRY_ONLY", "the display state is audited");
      assert.equal(approval.body.audit[0].approvedPrices.length, 1, "the approved price is audited");
      assert.equal(approval.body.audit[0].approvedPrices[0].market, "CN");
      assert.equal(approval.body.audit[0].approvedPrices[0].amountMinor, 128000);
      assert.equal(typeof approval.body.audit[0].approvedPrices[0].fingerprint, "string");
      assert.equal(approval.body.audit[0].approvedCopy.length, 1, "the approved locale is audited");
      assert.equal(approval.body.audit[0].approvedCopy[0].locale, "zh-CN", "the approved locale is audited");
      assert.equal(approval.body.audit[0].approvedCopy[0].copy.reviewedRevision, 1);
      assert.equal(approval.body.audit[0].approvedCopy[0].copy.title, "无野 · 静水手链", "the whole approved copy is audited, not just a fingerprint");
      assert.equal(approval.body.audit[0].approvedCopy[0].copy.summary, "天然的静水石与黄铜细节。");
      assert.deepEqual(approval.body.audit[0].approvedCopy[0].copy.materials, ["天然静水石", "黄铜"]);
      assert.equal(approval.body.audit[0].approvedCopy[0].copy.designer.slug, "designer-lin");
      assert.equal(typeof approval.body.audit[0].approvedCopy[0].copy.translationFingerprint, "string", "the reviewed translation fingerprint is audited");
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
      assert.equal(withdrawn.body.audit[2].withdrawnMedia.alt, "手链视图 0", "the withdrawn media alt is audited");
      assert.equal(withdrawn.body.audit[2].withdrawnMedia.width, 1200, "the withdrawn media width is audited");
      assert.equal(withdrawn.body.audit[2].withdrawnMedia.height, 900, "the withdrawn media height is audited");
      assert.deepEqual(
        withdrawn.body.audit[2].approvedMedia,
        [],
        "the withdrawal event records that no servable media remains"
      );
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

      // (6b) Withdrawing a checksum the subject never carried is refused with a
      // not-found instead of being silently accepted.
      const unknownChecksum = await adminPost(`/admin/showroom-approvals/${one.id}`, {
        action: "WITHDRAW_MEDIA",
        checksum: "sha256:does-not-exist"
      });
      assert.equal(
        unknownChecksum.status,
        404,
        `withdrawing an unknown checksum must be a 404, never a silent 200: ${JSON.stringify(unknownChecksum.body)}`
      );

      // (6c) Two independent writers act on the same existing approval row at
      // once. An independent PostgreSQL connection takes the row lock; its
      // backend PID is read with `pg_backend_pid()` and the lock is confirmed
      // held with a `FOR UPDATE NOWAIT` probe. Both writers are then started
      // while that lock is still held, and the database links each blocked
      // writer backend to that holder through `pg_blocking_pids(pid)` before the
      // lock is explicitly released. An implementation that updates the whole
      // row without a row lock deterministically drops one decision's audit
      // event — and may lose the withdrawal entirely.
      const cross = await createProduct(4);
      const crossChecksums = ["sha256:cross-a", "sha256:cross-b"];
      const crossSeed = await adminPost(`/admin/showroom-approvals/${cross.id}`, approvePayload(crossChecksums));
      assert.equal(crossSeed.status, 200, `the cross-process subject is approved: ${JSON.stringify(crossSeed.body)}`);

      let holderPid = 0;
      let blockedBackendPids: number[] = [];
      let approveSettled = false;
      let withdrawSettled = false;
      let approveResolvedAt = 0;
      let withdrawResolvedAt = 0;
      let releasedAt = 0;
      let lock: { holderPid: number; release: () => Promise<void> } | null = null;
      let observer: { blockedBy: (holderPid: number) => Promise<number[]>; end: () => Promise<void> } | null = null;
      let inFlight: Promise<{ status: number; body: any }>[] = [];
      let overlapError: unknown = null;

      try {
        lock = await acquireApprovalRowLock(cross.id);
        holderPid = lock.holderPid;
        observer = await openLockObserver();

        // First confirm the lock is actually held by that backend.
        assert.equal(
          await isApprovalRowLockHeld(cross.id),
          true,
          "an independent connection actually holds the approval row lock (FOR UPDATE NOWAIT is refused with 55P03)"
        );

        // Only now, with the lock still held, start the two writers' requests.
        const approvePromise = adminPost(`/admin/showroom-approvals/${cross.id}`, approvePayload(crossChecksums)).then(
          (result) => {
            approveSettled = true;
            approveResolvedAt = Date.now();
            return result;
          }
        );
        const withdrawPromise = adminPostTwo(`/admin/showroom-approvals/${cross.id}`, {
          action: "WITHDRAW_MEDIA",
          checksum: "sha256:cross-a",
          reason: "cross-process withdrawal"
        }).then((result) => {
          withdrawSettled = true;
          withdrawResolvedAt = Date.now();
          return result;
        });
        inFlight = [approvePromise, withdrawPromise];

        // While the lock is still held, both write requests must be blocked
        // waiting on it. `pg_blocking_pids` names the holder backend as the
        // blocker of two distinct writer backends — a causal link from the
        // holder PID to each writer PID, not a sleep — and neither request may
        // have settled yet.
        blockedBackendPids = await waitForBlockedWriterBackends(observer, holderPid, 2, 30_000);
        assert.equal(
          blockedBackendPids.length >= 2,
          true,
          `two distinct writer backends block behind the lock holder ${holderPid} (observed: ${blockedBackendPids.join(",")})`
        );
        assert.equal(
          blockedBackendPids.includes(holderPid),
          false,
          "the blocking writer backends are distinct from the lock holder"
        );
        assert.equal(approveSettled, false, "the approval request is still in flight while the lock is held");
        assert.equal(withdrawSettled, false, "the withdrawal request is still in flight while the lock is held");
      } catch (error) {
        overlapError = error;
      } finally {
        // Release the lock and close the observer on every path — including a
        // timeout or a failed assertion — so no connection is leaked.
        releasedAt = Date.now();
        if (observer) {
          await observer.end().catch(() => {});
        }
        if (lock) {
          await lock.release().catch(() => {});
        }
      }

      // Always await both requests, even after a failed assertion, so they
      // settle and no unhandled rejection or dangling socket is left behind.
      const settled = await Promise.allSettled(inFlight);
      if (overlapError) {
        throw overlapError;
      }
      const crossApprove = settled[0].status === "fulfilled"
        ? settled[0].value
        : (() => {
            throw settled[0].reason;
          })();
      const crossWithdraw = settled[1].status === "fulfilled"
        ? settled[1].value
        : (() => {
            throw settled[1].reason;
          })();
      assert.equal(crossApprove.status, 200, `the cross-process approval is accepted: ${JSON.stringify(crossApprove.body)}`);
      assert.equal(crossWithdraw.status, 200, `the cross-process withdrawal is accepted: ${JSON.stringify(crossWithdraw.body)}`);
      assert.ok(approveResolvedAt >= releasedAt, "the approval request resolved only after the row lock was released");
      assert.ok(withdrawResolvedAt >= releasedAt, "the withdrawal request resolved only after the row lock was released");
      const crossStored = await adminGet(`/admin/showroom-approvals/${cross.id}`);
      assert.equal(crossStored.status, 200);
      assert.equal(
        crossStored.body.audit.length,
        3,
        "both independent writers' decisions are audited; neither is lost to a lost update"
      );
      assert.deepEqual(
        [...crossStored.body.audit.map((event: any) => event.action)].sort(),
        ["APPROVED", "APPROVED", "MEDIA_WITHDRAWN"].sort(),
        "the audit trail holds the seed, the concurrent approval and the concurrent withdrawal, in whichever order the two writers' locks were granted"
      );
      const withdrawalEvent = crossStored.body.audit.find((event: any) => event.action === "MEDIA_WITHDRAWN");
      assert.deepEqual(
        withdrawalEvent.approvedMedia.map((fact: any) => fact.checksum),
        ["sha256:cross-b"],
        "the withdrawal event records the remaining servable media, not the withdrawn asset"
      );
      const crossAsset = crossStored.body.approval.media.find((asset: any) => asset.checksum === "sha256:cross-a");
      assert.equal(crossAsset.withdrawn, true, "the cross-process withdrawal is not overwritten by the concurrent approval");
      const crossDetail = await publicDetail(cross.handle);
      assert.equal(crossDetail.status, 200, "the subject still serves through its surviving asset");
      assert.equal(crossDetail.body.product.media.length, 1, "only the never-withdrawn asset is served");
      assert.match(crossDetail.body.product.media[0].url, /hero-1\.webp$/, "the surviving asset is the one never withdrawn");

      // (6d) A withdrawal stays effective across an arbitrary sequence of later
      // approvals that omit the asset and then reintroduce it.
      const sequence = await createProduct(5);
      const sequenceChecksums = ["sha256:seq-a", "sha256:seq-b"];
      assert.equal(
        (await adminPost(`/admin/showroom-approvals/${sequence.id}`, approvePayload(sequenceChecksums))).status,
        200,
        "the sequence subject is approved with both assets"
      );
      assert.equal(
        (await adminPost(`/admin/showroom-approvals/${sequence.id}`, { action: "WITHDRAW_MEDIA", checksum: "sha256:seq-a" })).status,
        200,
        "the first asset is withdrawn"
      );
      // An approval that omits A entirely must not drop the withdrawal fact.
      assert.equal(
        (await adminPost(`/admin/showroom-approvals/${sequence.id}`, approvePayload(["sha256:seq-b"]))).status,
        200,
        "an approval that omits the withdrawn asset is accepted"
      );
      // A later approval that reintroduces A must not revive it.
      const revived = await adminPost(`/admin/showroom-approvals/${sequence.id}`, approvePayload(sequenceChecksums));
      assert.equal(revived.status, 200, "an approval that reintroduces the withdrawn asset is accepted");
      const revivedAsset = revived.body.approval.media.find((asset: any) => asset.checksum === "sha256:seq-a");
      assert.equal(
        revivedAsset.withdrawn,
        true,
        "the withdrawal fact survives an approval that omitted A and a later one that reintroduced A"
      );
      const sequenceDetail = await publicDetail(sequence.handle);
      assert.equal(sequenceDetail.status, 200, "the subject still serves through its surviving asset");
      assert.equal(sequenceDetail.body.product.media.length, 1, "only the surviving asset is served");
      assert.match(sequenceDetail.body.product.media[0].url, /hero-1\.webp$/, "the surviving asset is the one never withdrawn");

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
