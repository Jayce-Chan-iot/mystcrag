/**
 * AUTH-006 isolated authentication security & full-loop E2E gate.
 *
 * One invocation of this config IS one clean run:
 *   globalSetup   → creates the isolated database, migrates + seeds it, starts the
 *                   synthetic OIDC provider, the CONNECT relay, backend and frontend
 *   workers       → run specs A–G against that stack
 *   globalTeardown→ stops every process, drops the isolated database, scans all
 *                   retained artifacts for secrets
 *
 * The run id is resolved once here (module scope of the launcher process) and
 * exported to workers via AUTH006_RUN_ID; workers inherit the launcher env.
 * Viewports for scenario F are created explicitly inside the specs, so there is a
 * single project and every spec runs exactly once per invocation.
 * Retries are intentionally zero: flakiness must surface, never be absorbed.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

import { resolvePorts, PRODUCTION_APP_HOST, PRODUCTION_API_HOST } from "./fixtures/ports";

const AUTH006_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(AUTH006_DIR, "..", "..");

function resolveRunId(): string {
  if (!process.env.AUTH006_RUN_ID) {
    process.env.AUTH006_RUN_ID = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
  const runId = process.env.AUTH006_RUN_ID;
  if (!/^[a-z0-9]{1,40}$/.test(runId)) {
    throw new Error(`AUTH006_RUN_ID must match [a-z0-9]{1,40}, got: ${runId}`);
  }
  return runId;
}

const runId = resolveRunId();
const runDirectory = path.join(REPO_ROOT, "output", "playwright", "auth-006", runId);
const ports = resolvePorts();

export default defineConfig({
  testDir: "./specs",
  outputDir: path.join(runDirectory, "test-results"),
  globalSetup: path.join(AUTH006_DIR, "global-setup.mts"),
  globalTeardown: path.join(AUTH006_DIR, "global-teardown.mts"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${ports.frontend}`,
    headless: true,
    ignoreHTTPSErrors: true,
    launchOptions: {
      proxy: {
        server: `http://127.0.0.1:${ports.browserRelay}`,
        // The provider hostname goes through the CONNECT relay (strict allowlist);
        // loopback and the production-topology synthetic DNS hosts connect directly
        // (they are remapped to 127.0.0.1 by --host-resolver-rules below).
        bypass: `localhost,127.0.0.1,${PRODUCTION_APP_HOST},${PRODUCTION_API_HOST}`
      },
      args: [
        `--host-resolver-rules=MAP ${PRODUCTION_APP_HOST} 127.0.0.1,MAP ${PRODUCTION_API_HOST} 127.0.0.1`
      ]
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 30_000
  }
});
