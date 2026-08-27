/**
 * AUTH-006 isolated stack orchestrator.
 *
 * Owns the full lifecycle of one clean E2E run:
 *
 *   1. unique run id + fixed port plan (asserted free before anything starts)
 *   2. isolated PostgreSQL database (create → migrate deploy → seed)
 *   3. synthetic OIDC provider (in-process HTTPS issuer + HTTP admin control plane)
 *   4. backend (esbuild production bundle, started with the Node connect rewrite)
 *   5. frontend (next build + next start, NODE_ENV=test so loopback HTTP app origins
 *      are legal while still exercising the production server runtime)
 *
 * Everything generated (TLS key/cert, logs, run-state) lives only inside
 * output/playwright/auth-006/<runId>/ which is already gitignored. Secrets
 * (client secret, session secret, provider admin token) are passed through
 * process env only and are NEVER written to disk or logs.
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

import { resolvePorts, assertPortsFree, waitForPort, SYNTHETIC_ISSUER, SYNTHETIC_PROVIDER_HOST } from "./ports";
import { createSyntheticProvider } from "./synthetic-provider";
import { ensureSyntheticTlsCertificate } from "./tls-cert";
import { startBrowserRelay, type BrowserRelay } from "./browser-relay";

export const AUTH006_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = path.resolve(AUTH006_DIR, "..", "..");

export const SYNTHETIC_CLIENT_ID = "auth006-synthetic-client";
export const SYNTHETIC_AUDIENCE = "https://api.mystcrag.auth006.internal/";

const PRELOAD_PATH = path.join(AUTH006_DIR, "fixtures", "node-connect-preload.cjs");
const DATABASE_NAME_PATTERN = /^mystcrag_auth006_[a-z0-9]+_test$/;

export type RunState = {
  runId: string;
  createdAt: string;
  ports: {
    providerTls: number;
    providerAdmin: number;
    browserRelay: number;
    backend: number;
    frontend: number;
    negativeBackend: number;
    negativeFrontend: number;
  };
  urls: {
    frontend: string;
    backend: string;
    providerIssuer: string;
    providerAdmin: string;
  };
  database: {
    name: string;
    host: string;
    port: number;
    user: string;
  };
  processes: {
    backendPid?: number;
    frontendPid?: number;
  };
  timings: {
    startedAt: string;
    databaseReadyAt?: string;
    providerReadyAt?: string;
    backendReadyAt?: string;
    frontendReadyAt?: string;
    stoppedAt?: string;
  };
};

type StackHandle = {
  state: RunState;
  provider: {
    stop(): Promise<void>;
  } | null;
  relay: BrowserRelay | null;
  backendProcess: ChildProcess | null;
  frontendProcess: ChildProcess | null;
};

let handle: StackHandle | null = null;

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

async function linkJsdomWorkerIntoBundle(): Promise<void> {
  const hoistedJsdom = path.join(REPO_ROOT, "node_modules", ".pnpm", "node_modules", "jsdom");
  const jsdomDir = await fs.realpath(hoistedJsdom);
  const worker = path.join(jsdomDir, "lib", "jsdom", "living", "xhr", "xhr-sync-worker.js");
  await fs.access(worker);
  const linkPath = path.join(REPO_ROOT, "apps", "backend", "dist", "xhr-sync-worker.js");
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
    TMPDIR: process.env.TMPDIR ?? "/tmp"
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
    NODE_OPTIONS: `--require ${JSON.stringify(PRELOAD_PATH)}`,
    AUTH006_SYNTHETIC_HOST: SYNTHETIC_PROVIDER_HOST,
    AUTH006_SYNTHETIC_PORT: String(providerTlsPort),
    NODE_EXTRA_CA_CERTS: certPath
  };
}

function fetchJson(url: string, init: https.RequestOptions & { headers?: Record<string, string> }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, init, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
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

  const adminUrl = new URL(resolveAdminDatabaseUrl());
  const state: RunState = {
    runId,
    createdAt: new Date().toISOString(),
    ports: { ...ports },
    urls: {
      frontend: `http://localhost:${ports.frontend}`,
      backend: `http://localhost:${ports.backend}`,
      providerIssuer: SYNTHETIC_ISSUER,
      providerAdmin: `http://127.0.0.1:${ports.providerAdmin}`
    },
    database: {
      name: databaseName,
      host: adminUrl.hostname,
      port: Number(adminUrl.port || 5432),
      user: decodeURIComponent(adminUrl.username || "postgres")
    },
    processes: {},
    timings: { startedAt: new Date().toISOString() }
  };

  const stack: StackHandle = { state, provider: null, relay: null, backendProcess: null, frontendProcess: null };
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

    // 2. Synthetic provider (in-process) + browser CONNECT relay.
    const tlsDir = path.join(runDir, "tls");
    const { keyPath, certPath } = await ensureSyntheticTlsCertificate(tlsDir);
    const provider = createSyntheticProvider({
      issuer: SYNTHETIC_ISSUER,
      audience: SYNTHETIC_AUDIENCE,
      clientId: SYNTHETIC_CLIENT_ID,
      clientSecret: secrets.clientSecret,
      callbackUrl: `${state.urls.frontend}/auth/callback`,
      logoutUrl: `${state.urls.frontend}/`,
      tlsPort: ports.providerTls,
      adminPort: ports.providerAdmin,
      adminToken: secrets.adminToken,
      tlsKey: keyPath,
      tlsCert: certPath,
      accessTokenLifetimeSeconds: Number(process.env.AUTH006_ACCESS_TOKEN_LIFETIME ?? 12)
    });
    await provider.start();
    stack.provider = provider;
    await verifyProviderTls(ports.providerTls, certPath);
    state.timings.providerReadyAt = new Date().toISOString();

    stack.relay = await startBrowserRelay({
      port: ports.browserRelay,
      upstreamHost: "127.0.0.1",
      upstreamPort: ports.providerTls
    });

    // 3. Backend build + start.
    await runToCompletion("backend build", process.execPath, ["build.mjs"], {
      cwd: path.join(REPO_ROOT, "apps", "backend"),
      env: nodeEnvForChildren(),
      logFile: path.join(logsDir, "backend-build.log"),
      timeoutMs: 300_000
    });
    await linkJsdomWorkerIntoBundle();

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
      { cwd: path.join(REPO_ROOT, "apps", "backend"), env: backendEnv, logFile: path.join(logsDir, "backend.log") },
      (code) => {
        if (code !== null && code !== 0 && handle === stack) {
          stack.backendProcess = null;
        }
      }
    );
    state.processes.backendPid = stack.backendProcess.pid;
    await waitForPort(ports.backend, 60_000);
    await waitForHttp("backend /health", `${state.urls.backend}/health`, (response) => response.status === 200, 60_000);
    state.timings.backendReadyAt = new Date().toISOString();

    // 4. Frontend build + start.
    await runToCompletion("frontend build", "pnpm", ["exec", "next", "build"], {
      cwd: path.join(REPO_ROOT, "apps", "frontend"),
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
      "pnpm",
      ["exec", "next", "start", "-p", String(ports.frontend)],
      { cwd: path.join(REPO_ROOT, "apps", "frontend"), env: frontendEnv, logFile: path.join(logsDir, "frontend.log") }
    );
    state.processes.frontendPid = stack.frontendProcess.pid;
    await waitForHttp(
      "frontend home page",
      `${state.urls.frontend}/`,
      (response) => response.status === 200,
      180_000
    );
    state.timings.frontendReadyAt = new Date().toISOString();

    await writeRunState(state);
    return state;
  } catch (error) {
    await stopIsolatedStack();
    throw error;
  }
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

async function stopChild(process_: ChildProcess | null, label: string): Promise<void> {
  if (!process_ || process_.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      process_.kill("SIGKILL");
      resolve();
    }, 10_000);
    process_.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    process_.kill("SIGTERM");
  });
  void label;
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

  if (handle) {
    await stopChild(handle.backendProcess, "backend");
    await stopChild(handle.frontendProcess, "frontend");
    if (handle.provider) {
      await handle.provider.stop().catch(() => undefined);
    }
    if (handle.relay) {
      await handle.relay.stop().catch(() => undefined);
    }
  } else if (state) {
    for (const pid of [state.processes.backendPid, state.processes.frontendPid]) {
      if (typeof pid !== "number") continue;
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already gone.
      }
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
      } catch (error) {
        console.error(`[auth-006] failed to drop isolated database: ${error instanceof Error ? error.message : error}`);
      }
    }
    state.timings.stoppedAt = new Date().toISOString();
    try {
      await writeRunState(state);
    } catch {
      // Run directory may not exist when setup failed before writing state.
    }
  }

  handle = null;
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
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: path.join(REPO_ROOT, "apps", "backend"),
    env,
    stdio: ["ignore", "ignore", "pipe"]
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
 * production build made by the main stack. Frontend auth configuration is validated
 * per request, so a rejected config must surface as a stable 500 on /auth/session and
 * /auth/login with no Set-Cookie side effects — never a redirect to the provider and
 * never a fake anonymous session.
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
  const child = spawn("pnpm", ["exec", "next", "start", "-p", String(ports.negativeFrontend)], {
    cwd: path.join(REPO_ROOT, "apps", "frontend"),
    env,
    stdio: ["ignore", "pipe", "pipe"]
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
