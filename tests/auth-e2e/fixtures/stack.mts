/**
 * AUTH-006 isolated stack orchestrator.
 *
 * Owns the full lifecycle of one clean E2E run:
 *
 *   1. unique run id + fixed port plan (asserted free before anything starts)
 *   2. isolated PostgreSQL database (create → migrate deploy → seed)
 *   3. run-scoped build checkout: apps/backend and apps/frontend are COPIED into
 *      output/playwright/auth-006/<runId>/work/ and built there, so the shared
 *      apps/frontend/.next and apps/backend/dist of the developer workspace are never
 *      read, written, or deleted. node_modules and packages/ are symlinked, so the
 *      build still uses the exact frozen install. Every run builds from scratch —
 *      no build output is ever reused between runs.
 *   4. synthetic OIDC provider (in-process HTTPS issuer + HTTP admin control plane)
 *      and the strict-allowlist browser CONNECT relay
 *   5. backend (esbuild production bundle in the run-scoped checkout)
 *   6. frontend (next build in the run-scoped checkout; the main instance runs with
 *      NODE_ENV=test so loopback HTTP app origins are legal while still exercising
 *      the production server runtime)
 *   7. production topology (scenario I): TLS reverse proxies expose the SAME runtimes
 *      on real HTTPS synthetic DNS origins — app.mystcrag.auth006.internal and
 *      api.mystcrag.auth006.internal — plus a second frontend instance with
 *      NODE_ENV=production, proving __Host- session cookies on a valid HTTPS origin.
 *
 * Teardown verifies ownership before signalling ANY pid (ps command-line match for
 * recovered pids; live ChildProcess handles are kernel-verified), stops everything it
 * started, verifies every owned port was released and the isolated database was
 * dropped, and FAILS the run when any cleanup step fails.
 *
 * Everything generated (TLS key/cert, logs, run-state, build outputs) lives only
 * inside output/playwright/auth-006/<runId>/ which is already gitignored. Secrets
 * (client secret, session secret, provider admin token) are passed through process
 * env only and are NEVER written to disk or logs.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolvePorts,
  assertPortsFree,
  waitForPort,
  waitForPortsReleased,
  SYNTHETIC_ISSUER,
  SYNTHETIC_PROVIDER_HOST,
  PRODUCTION_APP_HOST,
  PRODUCTION_API_HOST
} from "./ports";
import { createSyntheticProvider } from "./synthetic-provider";
import { ensureSyntheticTlsCertificate } from "./tls-cert";
import { startBrowserRelay, type BrowserRelay } from "./browser-relay";
import { startTlsReverseProxy, type TlsReverseProxy } from "./tls-reverse-proxy";
import { verifyProcessOwnership, processCommandFor } from "./process-identity";

export const AUTH006_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = path.resolve(AUTH006_DIR, "..", "..");

export const SYNTHETIC_CLIENT_ID = "auth006-synthetic-client";
export const SYNTHETIC_AUDIENCE = "https://api.mystcrag.auth006.internal/";

const PRELOAD_PATH = path.join(AUTH006_DIR, "fixtures", "node-connect-preload.cjs");
const DATABASE_NAME_PATTERN = /^mystcrag_auth006_[a-z0-9]+_test$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type RunState = {
  runId: string;
  createdAt: string;
  ports: {
    providerTls: number;
    providerAdmin: number;
    browserRelay: number;
    appTls: number;
    apiTls: number;
    backend: number;
    frontend: number;
    frontendProd: number;
    negativeBackend: number;
    negativeFrontend: number;
  };
  urls: {
    frontend: string;
    frontendProd: string;
    backend: string;
    backendTls: string;
    providerIssuer: string;
    providerAdmin: string;
  };
  database: {
    name: string;
    host: string;
    port: number;
    user: string;
  };
  workDirs: {
    backend: string;
    frontend: string;
  };
  processes: {
    backendPid?: number;
    frontendPid?: number;
    frontendProdPid?: number;
  };
  timings: {
    startedAt: string;
    databaseReadyAt?: string;
    providerReadyAt?: string;
    backendReadyAt?: string;
    frontendReadyAt?: string;
    frontendProdReadyAt?: string;
    stoppedAt?: string;
  };
};

type StackHandle = {
  state: RunState;
  provider: { stop(): Promise<void> } | null;
  relay: BrowserRelay | null;
  tlsAppProxy: TlsReverseProxy | null;
  tlsApiProxy: TlsReverseProxy | null;
  backendProcess: ChildProcess | null;
  frontendProcess: ChildProcess | null;
  frontendProdProcess: ChildProcess | null;
  /** Extra children spawned by specs (negative-config cases); stopped at teardown. */
  extraChildren: Array<{ label: string; child: ChildProcess }>;
};

let handle: StackHandle | null = null;

/**
 * Durable ownership record for a spec-spawned extra child (negative-config
 * backend/frontend instances). Playwright workers are SEPARATE processes from
 * global setup/teardown: the module-local `handle` is null in a worker and in
 * the teardown process, so a worker-crash-recovered run MUST be able to find,
 * re-verify and stop these children from the run directory alone.
 *
 * One JSON file per child under <runDir>/extra-children/ — registration and the
 * on-exit update each write only their OWN file, so updates cross the
 * worker/teardown process boundary without ever clobbering another child's
 * state.
 */
export type ExtraChildRecord = {
  id: string;
  label: string;
  pid: number;
  /** Regex source the recovered pid's CURRENT command line must match. */
  commandPattern: string;
  /** Run-scoped working directory the recovered pid must currently be in. */
  cwd: string;
  startedAt: string;
  exited: boolean;
  exitCode: number | null;
};

const EXTRA_CHILDREN_DIR_NAME = "extra-children";

function extraChildrenDirectory(): string {
  return path.join(resolveRunDirectory(), EXTRA_CHILDREN_DIR_NAME);
}

function extraChildRecordPath(id: string): string {
  return path.join(extraChildrenDirectory(), `${id}.json`);
}

/** Atomic per-record update: write a temp sibling, then rename over the target. */
async function writeFileAtomic(target: string, contents: string): Promise<void> {
  const temp = `${target}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  await fs.writeFile(temp, contents, "utf8");
  await fs.rename(temp, target);
}

async function readExtraChildRecord(id: string): Promise<ExtraChildRecord | null> {
  try {
    return JSON.parse(await fs.readFile(extraChildRecordPath(id), "utf8")) as ExtraChildRecord;
  } catch {
    return null;
  }
}

async function updateExtraChildExit(id: string, code: number | null): Promise<void> {
  // Best effort: teardown re-verifies ownership before any signal anyway, and a
  // stale "live" record for an exited pid resolves to kind "gone" (no signal).
  const record = await readExtraChildRecord(id);
  if (!record || record.exited) return;
  record.exited = true;
  record.exitCode = code;
  try {
    await writeFileAtomic(extraChildRecordPath(id), JSON.stringify(record, null, 2));
  } catch {
    // The record may already have been recovered and removed by teardown.
  }
}

/**
 * Registers a spec-spawned child so teardown stops it even when the spec or its
 * whole worker process crashes. The registration persists pid, label, command
 * signature and the run-scoped cwd to <runDir>/extra-children/<id>.json — the
 * module-local handle alone can never survive the worker/teardown process
 * boundary — and a normal exit rewrites the record as exited.
 *
 * The cwd MUST be inside this run's directory: teardown proves ownership with
 * command + run-scoped cwd before ANY signal, and must never be handed a
 * signature that could authorize signalling a process outside the run.
 */
export async function registerStackChild(
  label: string,
  child: ChildProcess,
  ownership: { pattern: string; cwd: string }
): Promise<void> {
  const runDir = resolveRunDirectory();
  const resolvedCwd = path.resolve(ownership.cwd);
  if (resolvedCwd !== runDir && !resolvedCwd.startsWith(`${runDir}${path.sep}`)) {
    throw new Error(
      `refusing to register child "${label}": cwd ${resolvedCwd} is outside this run's directory — teardown would not be able to prove ownership`
    );
  }
  if (typeof child.pid !== "number") {
    throw new Error(`refusing to register child "${label}": the child has no pid`);
  }
  const id = `${label.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()}-${child.pid}-${crypto
    .randomBytes(4)
    .toString("hex")}`;
  const record: ExtraChildRecord = {
    id,
    label,
    pid: child.pid,
    commandPattern: ownership.pattern,
    cwd: resolvedCwd,
    startedAt: new Date().toISOString(),
    exited: false,
    exitCode: null
  };
  await fs.mkdir(extraChildrenDirectory(), { recursive: true });
  await writeFileAtomic(extraChildRecordPath(id), JSON.stringify(record, null, 2));
  if (handle) {
    handle.extraChildren.push({ label, child });
  }
  child.once("exit", (code) => {
    void updateExtraChildExit(id, code);
  });
}

/**
 * Recovers and stops every still-live extra child recorded under this run's
 * extra-children directory — the fresh-recovery path a crashed worker needs.
 * Before ANY signal, each pid is re-verified against its CURRENT command line
 * AND its run-scoped working directory (the checkout path embeds the unique
 * run id). A record whose ownership proof is incomplete, unreadable, or points
 * outside this run's directory is NEVER signalled and FAILS loudly instead.
 * Exported for the H9 regression, which drives this exact path.
 */
export async function recoverExtraChildren(): Promise<void> {
  const runDir = resolveRunDirectory();
  const directory = extraChildrenDirectory();
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const errors: string[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    const id = name.slice(0, -".json".length);
    const record = await readExtraChildRecord(id);
    if (
      !record ||
      typeof record.pid !== "number" ||
      typeof record.commandPattern !== "string" ||
      record.commandPattern.length === 0 ||
      typeof record.cwd !== "string"
    ) {
      errors.push(`extra child record ${id}: ownership proof incomplete — refusing to signal anything for it`);
      continue;
    }
    if (record.cwd !== runDir && !record.cwd.startsWith(`${runDir}${path.sep}`)) {
      errors.push(
        `extra child record ${id}: recorded cwd is outside this run's directory — refusing to signal pid ${record.pid}`
      );
      continue;
    }
    if (record.exited) {
      await fs.rm(extraChildRecordPath(id), { force: true });
      continue;
    }
    try {
      await stopRecoveredPid({
        label: `extra child ${record.label}`,
        pid: record.pid,
        patterns: [new RegExp(record.commandPattern)],
        cwd: record.cwd
      });
      await fs.rm(extraChildRecordPath(id), { force: true });
    } catch (error) {
      errors.push(
        `extra child ${record.label} (pid ${record.pid}): ${error instanceof Error ? error.message : error}`
      );
    }
  }
  if (errors.length > 0) {
    throw new Error(`AUTH-006 extra-child recovery FAILED:\n  - ${errors.join("\n  - ")}`);
  }
}

function generateRunId(): string {
  const random = crypto.randomBytes(5).toString("hex");
  return `r${Date.now().toString(36)}${random}`;
}

export function resolveRunId(): string {
  if (!process.env.AUTH006_RUN_ID) {
    process.env.AUTH006_RUN_ID = generateRunId();
  }
  const runId = process.env.AUTH006_RUN_ID;
  if (!/^[a-z0-9]{1,40}$/.test(runId)) {
    throw new Error(`AUTH006_RUN_ID must match [a-z0-9]{1,40}, got: ${runId}`);
  }
  return runId;
}

export function resolveSecrets() {
  if (!process.env.AUTH006_CLIENT_SECRET) {
    process.env.AUTH006_CLIENT_SECRET = crypto.randomBytes(32).toString("hex");
  }
  if (!process.env.AUTH006_SESSION_SECRET) {
    process.env.AUTH006_SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  }
  if (!process.env.AUTH006_ADMIN_TOKEN) {
    process.env.AUTH006_ADMIN_TOKEN = crypto.randomBytes(32).toString("base64url");
  }
  return {
    clientSecret: process.env.AUTH006_CLIENT_SECRET,
    sessionSecret: process.env.AUTH006_SESSION_SECRET,
    adminToken: process.env.AUTH006_ADMIN_TOKEN
  };
}

export function resolveRunDirectory(): string {
  return path.join(REPO_ROOT, "output", "playwright", "auth-006", resolveRunId());
}

function resolveAdminDatabaseUrl(): string {
  const explicit = process.env.AUTH006_DATABASE_ADMIN_URL;
  if (explicit) return explicit;
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    url.pathname = "/postgres";
    url.search = "";
    url.hash = "";
    return url.toString();
  }
  const user = process.env.USER || process.env.USERNAME || "postgres";
  return `postgresql://${user}@localhost:5432/postgres`;
}

function databaseUrlFor(databaseName: string): string {
  const admin = new URL(resolveAdminDatabaseUrl());
  admin.pathname = `/${databaseName}`;
  return admin.toString();
}

function loadPg() {
  const require = createRequire(path.join(REPO_ROOT, "packages", "database", "package.json"));
  return require("pg") as {
    Pool: new (options: { connectionString: string }) => {
      query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
      end: () => Promise<void>;
    };
  };
}

/**
 * The backend production bundle inlines crawlee (backend → knowledge-core → knowledge-ingestion),
 * whose playwright-utils calls `require.resolve("jquery")` at module scope, and jsdom (same chain),
 * whose XMLHttpRequest-impl resolves its sibling `./xhr-sync-worker.js`. esbuild cannot inline
 * require.resolve, so both lookups run against dist/index.js and fail at import time — a
 * pre-existing production-build regression on main (crawlee entered the graph in f3dd030, after
 * the runnable-artifact fix 66b2a89). Backend sources are out of AUTH-006's writable scope, so
 * the run restores the intended lookups from the test harness while still executing the
 * unmodified production bundle: bare specifiers resolve through NODE_PATH pointed at pnpm's
 * hoisted store, and the jsdom worker asset is symlinked next to the bundle (see
 * linkJsdomWorkerIntoBundle).
 */
function bundleResolutionNodePath(): string {
  const hoisted = path.join(REPO_ROOT, "node_modules", ".pnpm", "node_modules");
  if (!existsSync(path.join(hoisted, "jquery"))) {
    throw new Error(
      `AUTH-006 expects pnpm's hoisted store at ${hoisted} to provide the bundle's require.resolve("jquery") lookup; it does not exist.`
    );
  }
  return hoisted;
}

async function linkJsdomWorkerIntoBundle(backendDir: string): Promise<void> {
  const hoistedJsdom = path.join(REPO_ROOT, "node_modules", ".pnpm", "node_modules", "jsdom");
  const jsdomDir = await fs.realpath(hoistedJsdom);
  const worker = path.join(jsdomDir, "lib", "jsdom", "living", "xhr", "xhr-sync-worker.js");
  await fs.access(worker);
  const linkPath = path.join(backendDir, "dist", "xhr-sync-worker.js");
  await fs.rm(linkPath, { force: true });
  await fs.symlink(worker, linkPath, "file");
}

async function queryAdmin(sql: string, values?: unknown[]) {
  const pg = loadPg();
  const pool = new pg.Pool({ connectionString: resolveAdminDatabaseUrl() });
  try {
    return await pool.query(sql, values);
  } finally {
    await pool.end();
  }
}

function spawnLogged(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; logFile: string },
  onExit?: (code: number | null) => void
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...options.env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stream = createWriteStream(options.logFile, { flags: "a" });
  stream.write(`\n=== ${new Date().toISOString()} spawn ${command} ${args.join(" ")}\n`);
  child.stdout?.on("data", (chunk) => stream.write(chunk));
  child.stderr?.on("data", (chunk) => stream.write(chunk));
  child.on("exit", (code) => {
    stream.end(`\n=== exit code ${code}\n`);
    onExit?.(code);
  });
  return child;
}

async function runToCompletion(
  label: string,
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; logFile: string; timeoutMs: number }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawnLogged(command, args, options);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${label} timed out after ${options.timeoutMs}ms (see ${path.relative(REPO_ROOT, options.logFile)})`));
    }, options.timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code} (see ${path.relative(REPO_ROOT, options.logFile)})`));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function nodeEnvForChildren(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    NEXT_TELEMETRY_DISABLED: "1"
  };
}

/**
 * The Node connect rewrite + provider CA are injected ONLY into the long-running
 * runtimes that must reach the synthetic issuer over TLS. Build and migration
 * children never talk to the provider, so they run with a clean env (and without
 * the preload, which refuses to start without AUTH006_SYNTHETIC_PORT).
 */
function runtimeEnv(providerTlsPort: number, certPath: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--require ${JSON.stringify(PRELOAD_PATH)}`,
    AUTH006_SYNTHETIC_HOST: SYNTHETIC_PROVIDER_HOST,
    AUTH006_SYNTHETIC_PORT: String(providerTlsPort),
    NODE_EXTRA_CA_CERTS: certPath
  };
}

function resolveNextBin(): string {
  const require = createRequire(path.join(REPO_ROOT, "apps", "frontend", "package.json"));
  return require.resolve("next/dist/bin/next");
}

/**
 * Copies one application tree into the run-scoped checkout, excluding its build
 * outputs and dependencies (node_modules is symlinked to the frozen install so the
 * copy builds against the exact same dependency graph without duplicating it).
 */
async function copyAppTree(source: string, destination: string, excludes: string[]): Promise<void> {
  await fs.cp(source, destination, {
    recursive: true,
    filter: (entry: string) => {
      const relative = path.relative(source, entry);
      if (!relative) return true;
      const topSegment = relative.split(path.sep)[0];
      return !excludes.includes(topSegment);
    }
  });
}

/**
 * Run-scoped build checkout (repair #3). backend and frontend sources are copied to
 * <runDir>/work/apps/*, their node_modules and the workspace packages/ tree are
 * symlinked from the repository, and every build/start afterwards runs INSIDE the
 * copy. The shared apps/frontend/.next and apps/backend/dist are never touched:
 * not read (no stale build reuse between runs), not written, not deleted.
 */
async function prepareRunScopedCheckout(runDir: string): Promise<{ backendDir: string; frontendDir: string }> {
  const workDir = path.join(runDir, "work");
  const workAppsDir = path.join(workDir, "apps");
  await fs.mkdir(workAppsDir, { recursive: true });

  // build.mjs resolves workspace sources via ../../packages/** — symlink the tree.
  await fs.symlink(path.join(REPO_ROOT, "packages"), path.join(workDir, "packages"), "dir");
  // Both apps' tsconfig.json extend ../../tsconfig.base.json — complete the same
  // directory shape the repository gives them (read-only link, never a copy).
  await fs.symlink(path.join(REPO_ROOT, "tsconfig.base.json"), path.join(workDir, "tsconfig.base.json"), "file");

  const backendDir = path.join(workAppsDir, "backend");
  await copyAppTree(path.join(REPO_ROOT, "apps", "backend"), backendDir, ["node_modules", "dist"]);
  await fs.symlink(
    path.join(REPO_ROOT, "apps", "backend", "node_modules"),
    path.join(backendDir, "node_modules"),
    "dir"
  );

  const frontendDir = path.join(workAppsDir, "frontend");
  await copyAppTree(path.join(REPO_ROOT, "apps", "frontend"), frontendDir, ["node_modules", ".next"]);
  await fs.symlink(
    path.join(REPO_ROOT, "apps", "frontend", "node_modules"),
    path.join(frontendDir, "node_modules"),
    "dir"
  );

  return { backendDir, frontendDir };
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
  });
}

async function waitForHttp(
  label: string,
  url: string,
  check: (response: { status: number; body: string }) => boolean,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no attempt";
  while (Date.now() < deadline) {
    try {
      const response = await httpGet(url);
      if (check(response)) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms (${lastError})`);
}

async function verifyProviderTls(port: number, certPath: string): Promise<void> {
  const ca = await fs.readFile(certPath, "utf8");
  await new Promise<void>((resolve, reject) => {
    const request = https.get(
      {
        host: "127.0.0.1",
        port,
        path: "/.well-known/openid-configuration",
        servername: "synthetic.auth006.internal",
        ca,
        rejectUnauthorized: true,
        timeout: 10_000
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode === 200 && body.includes(SYNTHETIC_ISSUER)) {
            resolve();
          } else {
            reject(new Error(`Synthetic provider TLS discovery check failed with status ${response.statusCode}`));
          }
        });
      }
    );
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Synthetic provider TLS discovery check timed out"));
    });
  });
}

export async function startIsolatedStack(): Promise<RunState> {
  const runId = resolveRunId();
  const secrets = resolveSecrets();
  const ports = resolvePorts();
  const runDir = resolveRunDirectory();
  const logsDir = path.join(runDir, "logs");
  await fs.mkdir(logsDir, { recursive: true });

  const databaseName = `mystcrag_auth006_${runId}_test`;
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(`Refusing to manage unexpected database name: ${databaseName}`);
  }

  await assertPortsFree(ports);

  const nextBin = resolveNextBin();
  // No trailing slash: the config validator compares MYSTCRAG_AUTH_CALLBACK_URL
  // against the exact string `${MYSTCRAG_APP_ORIGIN}/auth/callback`.
  const productionAppOrigin = `https://${PRODUCTION_APP_HOST}:${ports.appTls}`;
  const productionApiOrigin = `https://${PRODUCTION_API_HOST}:${ports.apiTls}`;

  const adminUrl = new URL(resolveAdminDatabaseUrl());
  const state: RunState = {
    runId,
    createdAt: new Date().toISOString(),
    ports: { ...ports },
    urls: {
      frontend: `http://localhost:${ports.frontend}`,
      frontendProd: productionAppOrigin,
      backend: `http://localhost:${ports.backend}`,
      backendTls: productionApiOrigin,
      providerIssuer: SYNTHETIC_ISSUER,
      providerAdmin: `http://127.0.0.1:${ports.providerAdmin}`
    },
    database: {
      name: databaseName,
      host: adminUrl.hostname,
      port: Number(adminUrl.port || 5432),
      user: decodeURIComponent(adminUrl.username || "postgres")
    },
    workDirs: { backend: "", frontend: "" },
    processes: {},
    timings: { startedAt: new Date().toISOString() }
  };

  const stack: StackHandle = {
    state,
    provider: null,
    relay: null,
    tlsAppProxy: null,
    tlsApiProxy: null,
    backendProcess: null,
    frontendProcess: null,
    frontendProdProcess: null,
    extraChildren: []
  };
  handle = stack;

  try {
    // 1. Isolated database.
    const existing = await queryAdmin(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName]
    );
    if (existing.rows.length > 0) {
      throw new Error(`Database ${databaseName} already exists; refusing to reuse it.`);
    }
    await queryAdmin(`CREATE DATABASE "${databaseName}"`);
    state.timings.databaseReadyAt = new Date().toISOString();

    const databaseUrl = databaseUrlFor(databaseName);
    const baseEnv = nodeEnvForChildren();

    await runToCompletion(
      "prisma migrate deploy",
      "pnpm",
      ["--filter", "@mystcrag/database", "exec", "prisma", "migrate", "deploy"],
      {
        cwd: REPO_ROOT,
        env: { ...baseEnv, DATABASE_URL: databaseUrl },
        logFile: path.join(logsDir, "migrate.log"),
        timeoutMs: 180_000
      }
    );

    await runToCompletion(
      "database seed",
      "pnpm",
      ["--filter", "@mystcrag/database", "run", "db:seed"],
      {
        cwd: REPO_ROOT,
        env: { ...baseEnv, DATABASE_URL: databaseUrl },
        logFile: path.join(logsDir, "seed.log"),
        timeoutMs: 180_000
      }
    );

    // 2. Run-scoped build checkout (built in step 3/4 — never in apps/**).
    const { backendDir, frontendDir } = await prepareRunScopedCheckout(runDir);
    state.workDirs = { backend: backendDir, frontend: frontendDir };
    await writeRunState(state);

    // 3. Synthetic provider (in-process) + browser CONNECT relay (strict allowlist).
    const tlsDir = path.join(runDir, "tls");
    const { keyPath, certPath } = await ensureSyntheticTlsCertificate(tlsDir);
    stack.relay = await startBrowserRelay({
      port: ports.browserRelay,
      allowlist: [{ host: SYNTHETIC_PROVIDER_HOST, port: 443, upstreamPort: ports.providerTls }]
    });
    const provider = createSyntheticProvider({
      issuer: SYNTHETIC_ISSUER,
      audience: SYNTHETIC_AUDIENCE,
      clientId: SYNTHETIC_CLIENT_ID,
      clientSecret: secrets.clientSecret,
      callbackUrl: `${state.urls.frontend}/auth/callback`,
      logoutUrl: `${state.urls.frontend}/`,
      extraCallbackUrls: [`${productionAppOrigin}/auth/callback`],
      extraLogoutUrls: [productionAppOrigin],
      tlsPort: ports.providerTls,
      adminPort: ports.providerAdmin,
      adminToken: secrets.adminToken,
      tlsKey: keyPath,
      tlsCert: certPath,
      accessTokenLifetimeSeconds: Number(process.env.AUTH006_ACCESS_TOKEN_LIFETIME ?? 12),
      relayStats: () => stack.relay?.stats() ?? null
    });
    await provider.start();
    stack.provider = provider;
    await verifyProviderTls(ports.providerTls, certPath);
    state.timings.providerReadyAt = new Date().toISOString();

    // 4. Backend build + start (run-scoped checkout only).
    await runToCompletion("backend build", process.execPath, ["build.mjs"], {
      cwd: backendDir,
      env: nodeEnvForChildren(),
      logFile: path.join(logsDir, "backend-build.log"),
      timeoutMs: 300_000
    });
    await linkJsdomWorkerIntoBundle(backendDir);

    const backendEnv: Record<string, string> = {
      ...runtimeEnv(ports.providerTls, certPath),
      NODE_ENV: "test",
      NODE_PATH: bundleResolutionNodePath(),
      BACKEND_PORT: String(ports.backend),
      DATABASE_URL: databaseUrl,
      MYSTCRAG_AUTH_PROVIDER: "auth0",
      MYSTCRAG_AUTH_ISSUER: SYNTHETIC_ISSUER,
      MYSTCRAG_AUTH_AUDIENCE: SYNTHETIC_AUDIENCE,
      MYSTCRAG_TAROT_ENABLED: "true"
    };
    stack.backendProcess = spawnLogged(
      process.execPath,
      ["dist/index.js"],
      { cwd: backendDir, env: backendEnv, logFile: path.join(logsDir, "backend.log") },
      (code) => {
        if (code !== null && code !== 0 && handle === stack) {
          stack.backendProcess = null;
        }
      }
    );
    state.processes.backendPid = stack.backendProcess.pid;
    await writeRunState(state);
    await waitForPort(ports.backend, 60_000);
    await waitForHttp("backend /health", `${state.urls.backend}/health`, (response) => response.status === 200, 60_000);
    state.timings.backendReadyAt = new Date().toISOString();

    // 5. Frontend build + start (run-scoped checkout; shared build output lives only
    //    in the run directory). NODE_ENV=test keeps loopback HTTP app origins legal.
    await runToCompletion("frontend build", process.execPath, [nextBin, "build"], {
      cwd: frontendDir,
      env: nodeEnvForChildren(),
      logFile: path.join(logsDir, "frontend-build.log"),
      timeoutMs: 600_000
    });

    const frontendEnv: Record<string, string> = {
      ...runtimeEnv(ports.providerTls, certPath),
      NODE_ENV: "test",
      MYSTCRAG_APP_ORIGIN: state.urls.frontend,
      MYSTCRAG_AUTH_PROVIDER: "auth0",
      MYSTCRAG_AUTH_ISSUER: SYNTHETIC_ISSUER,
      MYSTCRAG_AUTH_AUDIENCE: SYNTHETIC_AUDIENCE,
      MYSTCRAG_AUTH_CLIENT_ID: SYNTHETIC_CLIENT_ID,
      MYSTCRAG_AUTH_CLIENT_SECRET: secrets.clientSecret,
      MYSTCRAG_AUTH_CALLBACK_URL: `${state.urls.frontend}/auth/callback`,
      MYSTCRAG_AUTH_LOGOUT_URL: `${state.urls.frontend}/`,
      MYSTCRAG_AUTH_SESSION_SECRET: secrets.sessionSecret,
      MYSTCRAG_BACKEND_ORIGIN: state.urls.backend,
      MYSTCRAG_TAROT_ENABLED: "true"
    };
    stack.frontendProcess = spawnLogged(
      process.execPath,
      [nextBin, "start", "-p", String(ports.frontend)],
      { cwd: frontendDir, env: frontendEnv, logFile: path.join(logsDir, "frontend.log") }
    );
    state.processes.frontendPid = stack.frontendProcess.pid;
    await writeRunState(state);
    await waitForHttp(
      "frontend home page",
      `${state.urls.frontend}/`,
      (response) => response.status === 200,
      180_000
    );
    state.timings.frontendReadyAt = new Date().toISOString();

    // 6. Production topology (scenario I): the same backend and the same production
    //    build, exposed on real HTTPS synthetic DNS origins through TLS reverse
    //    proxies, plus a second frontend instance running NODE_ENV=production — the
    //    environment classification the production config validator requires.
    stack.tlsApiProxy = await startTlsReverseProxy({
      port: ports.apiTls,
      upstreamPort: ports.backend,
      tlsKey: keyPath,
      tlsCert: certPath
    });
    stack.tlsAppProxy = await startTlsReverseProxy({
      port: ports.appTls,
      upstreamPort: ports.frontendProd,
      tlsKey: keyPath,
      tlsCert: certPath
    });

    const productionFrontendEnv: Record<string, string> = {
      ...runtimeEnv(ports.providerTls, certPath),
      AUTH006_API_REMAP_HOST: PRODUCTION_API_HOST,
      NODE_ENV: "production",
      MYSTCRAG_APP_ORIGIN: productionAppOrigin,
      MYSTCRAG_AUTH_PROVIDER: "auth0",
      MYSTCRAG_AUTH_ISSUER: SYNTHETIC_ISSUER,
      MYSTCRAG_AUTH_AUDIENCE: SYNTHETIC_AUDIENCE,
      MYSTCRAG_AUTH_CLIENT_ID: SYNTHETIC_CLIENT_ID,
      MYSTCRAG_AUTH_CLIENT_SECRET: secrets.clientSecret,
      MYSTCRAG_AUTH_CALLBACK_URL: `${productionAppOrigin}/auth/callback`,
      MYSTCRAG_AUTH_LOGOUT_URL: productionAppOrigin,
      MYSTCRAG_AUTH_SESSION_SECRET: secrets.sessionSecret,
      MYSTCRAG_BACKEND_ORIGIN: productionApiOrigin,
      MYSTCRAG_TAROT_ENABLED: "true"
    };
    // Fixture-level regression guard for the production config contract: the
    // frontend validator (auth-config.ts) rejects any MYSTCRAG_AUTH_CALLBACK_URL
    // that is not exactly `${MYSTCRAG_APP_ORIGIN}/auth/callback`. A mismatch used
    // to surface only as an opaque 180s readiness timeout behind endless
    // auth.dependency_failed events; fail setup immediately with the exact
    // violation instead.
    const productionCallbackContract = `${productionFrontendEnv.MYSTCRAG_APP_ORIGIN}/auth/callback`;
    if (productionFrontendEnv.MYSTCRAG_AUTH_CALLBACK_URL !== productionCallbackContract) {
      throw new Error(
        `production MYSTCRAG_AUTH_CALLBACK_URL contract violation: must exactly equal MYSTCRAG_APP_ORIGIN + '/auth/callback' ` +
          `(got ${productionFrontendEnv.MYSTCRAG_AUTH_CALLBACK_URL}, expected ${productionCallbackContract})`
      );
    }
    stack.frontendProdProcess = spawnLogged(
      process.execPath,
      [nextBin, "start", "-p", String(ports.frontendProd)],
      { cwd: frontendDir, env: productionFrontendEnv, logFile: path.join(logsDir, "frontend-prod.log") }
    );
    state.processes.frontendProdPid = stack.frontendProdProcess.pid;
    await writeRunState(state);
    await waitForHttp(
      "production-topology frontend home page",
      `http://127.0.0.1:${ports.frontendProd}/`,
      (response) => response.status === 200,
      180_000
    );
    // Readiness must ALSO prove the production Auth configuration actually
    // RESOLVED. A 200 on / alone does not prove that: the fail-closed proxy
    // answers page navigations while the auth dependency is broken, and the
    // run must never be judged ready on the strength of the home page alone.
    // /auth/session answers 200 {"authenticated":false} only after the
    // production config validator passed (config failure = stable 500).
    await waitForHttp(
      "production-topology frontend auth configuration",
      `http://127.0.0.1:${ports.frontendProd}/auth/session`,
      (response) => response.status === 200 && response.body.includes("\"authenticated\""),
      60_000
    );
    state.timings.frontendProdReadyAt = new Date().toISOString();

    await writeRunState(state);
    return state;
  } catch (error) {
    // Cleanup MUST still run when setup fails (live processes, bound ports, the
    // isolated database, temp dirs) — but a cleanup failure is NEVER swallowed:
    // leftover resources must not hide behind the original setup error.
    let cleanupError: unknown = null;
    try {
      await stopIsolatedStack();
    } catch (failure) {
      cleanupError = failure;
    }
    throw buildSetupFailure(error, cleanupError);
  }
}

/**
 * Combines a failed setup with the outcome of the cleanup that setup failure
 * triggered. Cleanup succeeded → the original setup error propagates unchanged.
 * Cleanup failed too → an AggregateError carrying BOTH errors, so residual
 * processes/ports/database can never hide behind the setup error. Run-state and
 * stack logs stay on disk (stopIsolatedStack keeps writing stoppedAt) for
 * diagnosis. Exported for the narrow H7 regression.
 */
export function buildSetupFailure(setupError: unknown, cleanupError: unknown): unknown {
  if (cleanupError === null || cleanupError === undefined) {
    return setupError;
  }
  const errors = [
    setupError instanceof Error ? setupError : new Error(String(setupError)),
    cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError))
  ];
  return new AggregateError(
    errors,
    "AUTH-006 setup FAILED and the subsequent cleanup FAILED too — processes, ports or the isolated " +
      "database may still be live. The setup error and the cleanup error are both attached; " +
      "run-state.json and the stack logs under the run directory are retained for diagnosis"
  );
}

export async function writeRunState(state: RunState): Promise<void> {
  const runDir = resolveRunDirectory();
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "run-state.json"),
    JSON.stringify(state, null, 2),
    "utf8"
  );
}

export async function readRunState(): Promise<RunState> {
  const runDir = resolveRunDirectory();
  const raw = await fs.readFile(path.join(runDir, "run-state.json"), "utf8");
  return JSON.parse(raw) as RunState;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Signals a live ChildProcess this run spawned. The handle itself proves ownership. */
async function stopOwnedChild(child: ChildProcess, label: string): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 10_000)) return;
  child.kill("SIGKILL");
  if (await waitForExit(child, 10_000)) return;
  throw new Error(`${label} (pid ${child.pid}) did not exit after SIGTERM and SIGKILL`);
}

async function waitForPidGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await processCommandFor(pid)) === null) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/**
 * Signals a pid recovered from run-state.json. The pid is verified against the
 * run-scoped ownership signature FIRST — command line AND the run-scoped working
 * directory — so a recycled pid (foreign command line) or a foreign same-command
 * process (wrong cwd) is never signalled and fails teardown instead.
 * Exported for the H5b regression, which drives the REAL stop path.
 */
export async function stopRecoveredPid(spec: {
  label: string;
  pid?: number;
  patterns: RegExp[];
  cwd?: string;
}): Promise<void> {
  if (typeof spec.pid !== "number") return;
  const check = await verifyProcessOwnership({ pid: spec.pid, patterns: spec.patterns, cwd: spec.cwd });
  if (check.kind === "gone") return;
  if (check.kind === "foreign") {
    throw new Error(
      `refusing to signal foreign/recycled ${spec.label} pid ${spec.pid}: ${check.reason} ` +
        `(current command: ${check.command}${check.cwd ? `; current cwd: ${check.cwd}` : ""})`
    );
  }
  process.kill(spec.pid, "SIGTERM");
  if (await waitForPidGone(spec.pid, 10_000)) return;
  process.kill(spec.pid, "SIGKILL");
  if (await waitForPidGone(spec.pid, 10_000)) return;
  throw new Error(`${spec.label} (pid ${spec.pid}) did not exit after SIGTERM and SIGKILL`);
}

/**
 * The recovery specs for a run-state: what teardown will verify, per recovered pid,
 * before ANY signal. Every spec carries a run-scoped cwd expectation — the work
 * directory embeds the unique run id — in addition to the command-line signature,
 * because a generic `next start -p <port>` command alone can be reused by a
 * foreign or recycled process that merely picked the same port.
 * Exported for the H5b regression, which drives the REAL specs path.
 */
export function recoveredProcessSpecs(
  state: RunState
): Array<{ label: string; pid?: number; patterns: RegExp[]; cwd: string }> {
  const backendPattern = new RegExp(`${escapeRegExp(state.workDirs.backend)}/dist/index\\.js$`);
  return [
    { label: "backend", pid: state.processes.backendPid, patterns: [backendPattern], cwd: state.workDirs.backend },
    {
      label: "frontend",
      pid: state.processes.frontendPid,
      patterns: [new RegExp(`next start -p ${state.ports.frontend}$`)],
      cwd: state.workDirs.frontend
    },
    {
      label: "production frontend",
      pid: state.processes.frontendProdPid,
      patterns: [new RegExp(`next start -p ${state.ports.frontendProd}$`)],
      cwd: state.workDirs.frontend
    }
  ];
}

export async function stopIsolatedStack(): Promise<void> {
  const statePath = path.join(resolveRunDirectory(), "run-state.json");
  let state: RunState | null = handle?.state ?? null;
  if (!state) {
    try {
      state = JSON.parse(await fs.readFile(statePath, "utf8")) as RunState;
    } catch {
      state = null;
    }
  }

  const errors: string[] = [];

  if (handle) {
    const liveChildren: Array<[string, ChildProcess | null]> = [
      ["backend", handle.backendProcess],
      ["frontend", handle.frontendProcess],
      ["production frontend", handle.frontendProdProcess],
      ...handle.extraChildren.map((entry) => [entry.label, entry.child] as [string, ChildProcess])
    ];
    for (const [label, child] of liveChildren) {
      if (!child) continue;
      try {
        await stopOwnedChild(child, label);
      } catch (error) {
        errors.push(`${label}: ${error instanceof Error ? error.message : error}`);
      }
    }
  } else if (state) {
    for (const spec of recoveredProcessSpecs(state)) {
      try {
        await stopRecoveredPid(spec);
      } catch (error) {
        errors.push(`${spec.label}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  // Spec-spawned extra children (negative-config backend/frontend) run in WORKER
  // processes — the module-local handle above never contains them. Their durable
  // ownership records under <runDir>/extra-children/ are the only recovery source,
  // so this MUST run in both branches (with and without the in-process handle).
  try {
    await recoverExtraChildren();
  } catch (error) {
    errors.push(`${error instanceof Error ? error.message : error}`);
  }

  if (handle) {
    const inProcess: Array<[string, { stop(): Promise<void> } | null | undefined]> = [
      ["app TLS reverse proxy", handle.tlsAppProxy],
      ["api TLS reverse proxy", handle.tlsApiProxy],
      ["synthetic provider", handle.provider],
      ["browser relay", handle.relay]
    ];
    for (const [label, server] of inProcess) {
      if (!server) continue;
      try {
        await server.stop();
      } catch (error) {
        errors.push(`${label}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  // Every port of the run-scoped plan must be released again.
  if (state) {
    const busy = await waitForPortsReleased(state.ports, 15_000);
    if (busy.length > 0) {
      errors.push(`ports still bound after teardown: ${busy.join(", ")}`);
    }
  }

  if (state) {
    const databaseName = state.database.name;
    if (DATABASE_NAME_PATTERN.test(databaseName)) {
      try {
        await queryAdmin(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
          [databaseName]
        );
        await queryAdmin(`DROP DATABASE IF EXISTS "${databaseName}"`);
        const remaining = await queryAdmin(
          "SELECT 1 FROM pg_database WHERE datname = $1",
          [databaseName]
        );
        if (remaining.rows.length > 0) {
          errors.push(`isolated database ${databaseName} still exists after DROP`);
        }
      } catch (error) {
        errors.push(`database cleanup: ${error instanceof Error ? error.message : error}`);
      }
    } else {
      errors.push(`refusing database cleanup for unexpected name: ${databaseName}`);
    }
    state.timings.stoppedAt = new Date().toISOString();
    try {
      await writeRunState(state);
    } catch {
      // Run directory may not exist when setup failed before writing state.
    }
  }

  handle = null;
  if (errors.length > 0) {
    throw new Error(`AUTH-006 teardown FAILED:\n  - ${errors.join("\n  - ")}`);
  }
}

/**
 * Spawns a backend process with a deliberately invalid configuration. Auth provider
 * construction runs before the HTTP listener, so a rejected config must exit the
 * process before any port is bound. The spawned process is never given the preload
 * or provider env — negative config cases fail before any network access.
 */
export async function spawnBackendWithEnv(
  envOverrides: Record<string, string>,
  label: string
): Promise<{ waitForExit: (timeoutMs: number) => Promise<{ code: number | null; stderr: string }> }> {
  const ports = resolvePorts();
  const state = await readRunState();
  const runDir = resolveRunDirectory();
  const logsDir = path.join(runDir, "logs");
  await fs.mkdir(logsDir, { recursive: true });
  const env: Record<string, string> = {
    ...nodeEnvForChildren(),
    NODE_PATH: bundleResolutionNodePath(),
    BACKEND_PORT: String(ports.negativeBackend),
    ...envOverrides
  };
  const stderrChunks: Buffer[] = [];
  // Absolute script path on purpose: the persisted ownership pattern matches the
  // ps command line `<workDirs.backend>/dist/index.js$`, and recovery in another
  // process must be able to verify that signature against the live pid.
  const child = spawn(process.execPath, [path.join(state.workDirs.backend, "dist", "index.js")], {
    cwd: state.workDirs.backend,
    env,
    stdio: ["ignore", "ignore", "pipe"]
  });
  await registerStackChild(`negative backend ${label}`, child, {
    pattern: `${escapeRegExp(state.workDirs.backend)}/dist/index\\.js$`,
    cwd: state.workDirs.backend
  });
  child.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const logFile = path.join(logsDir, `negative-backend-${label}.log`);
  const stream = createWriteStream(logFile, { flags: "a" });
  child.stderr?.on("data", (chunk) => stream.write(chunk));
  child.stdout?.on("data", (chunk) => stream.write(chunk));
  child.on("exit", () => stream.end());
  return {
    waitForExit: (timeoutMs: number) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`Backend negative case "${label}" did not exit within ${timeoutMs}ms`));
        }, timeoutMs);
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve({ code, stderr: Buffer.concat(stderrChunks).toString("utf8") });
        });
      })
  };
}

/**
 * Spawns an extra frontend (`next start` on the reserved negative port) reusing the
 * run-scoped production build. Frontend auth configuration is validated per request,
 * so a rejected config must surface as a stable 500 on /auth/session and /auth/login
 * with no Set-Cookie side effects — never a redirect to the provider and never a
 * fake anonymous session.
 */
export async function spawnFrontendWithEnv(
  envOverrides: Record<string, string>,
  label: string
): Promise<{ url: string; stop(): Promise<void> }> {
  const ports = resolvePorts();
  const state = await readRunState();
  const runDir = resolveRunDirectory();
  const logsDir = path.join(runDir, "logs");
  await fs.mkdir(logsDir, { recursive: true });

  const nextBin = resolveNextBin();
  const url = `http://localhost:${ports.negativeFrontend}`;
  const env: Record<string, string> = {
    ...nodeEnvForChildren(),
    NODE_ENV: "test",
    MYSTCRAG_APP_ORIGIN: url,
    MYSTCRAG_AUTH_PROVIDER: "auth0",
    MYSTCRAG_AUTH_ISSUER: state.urls.providerIssuer,
    MYSTCRAG_AUTH_AUDIENCE: SYNTHETIC_AUDIENCE,
    MYSTCRAG_AUTH_CLIENT_ID: SYNTHETIC_CLIENT_ID,
    MYSTCRAG_AUTH_CALLBACK_URL: `${url}/auth/callback`,
    MYSTCRAG_AUTH_LOGOUT_URL: `${url}/`,
    MYSTCRAG_BACKEND_ORIGIN: state.urls.backend,
    ...envOverrides
  };
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(ports.negativeFrontend)], {
    cwd: state.workDirs.frontend,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  await registerStackChild(`negative frontend ${label}`, child, {
    pattern: `next start -p ${ports.negativeFrontend}$`,
    cwd: state.workDirs.frontend
  });
  const logFile = path.join(logsDir, `negative-frontend-${label}.log`);
  const stream = createWriteStream(logFile, { flags: "a" });
  stream.write(`\n=== ${new Date().toISOString()} negative frontend ${label}\n`);
  child.stdout?.on("data", (chunk) => stream.write(chunk));
  child.stderr?.on("data", (chunk) => stream.write(chunk));

  await waitForHttp(
    `negative frontend ${label}`,
    `${url}/auth/session`,
    (response) => response.status >= 200,
    120_000
  );

  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 10_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      })
  };
}
