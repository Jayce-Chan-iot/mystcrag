/**
 * Worker-side access to the isolated stack of the current run.
 *
 * The launcher (config + global setup) resolves the run id, ports and secrets and
 * exports them through process env; workers inherit that env. run-state.json is the
 * durable fallback written by the orchestrator.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AUTH006_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(AUTH006_DIR, "..", "..");

export type Auth006RunState = {
  runId: string;
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
};

export function runId(): string {
  const value = process.env.AUTH006_RUN_ID;
  if (!value || !/^[a-z0-9]{1,40}$/.test(value)) {
    throw new Error("AUTH006_RUN_ID is not set in this worker; the suite must be started through tests/auth-e2e/playwright.config.mts");
  }
  return value;
}

export function runDirectory(): string {
  return path.join(REPO_ROOT, "output", "playwright", "auth-006", runId());
}

let cachedState: Auth006RunState | null = null;

export async function stackState(): Promise<Auth006RunState> {
  if (cachedState) return cachedState;
  const raw = await fs.readFile(path.join(runDirectory(), "run-state.json"), "utf8");
  cachedState = JSON.parse(raw) as Auth006RunState;
  return cachedState;
}

export function requireSecret(name: "AUTH006_CLIENT_SECRET" | "AUTH006_SESSION_SECRET" | "AUTH006_ADMIN_TOKEN"): string {
  const value = process.env[name];
  if (!value || value.length < 16) {
    throw new Error(`${name} is not available in this worker; the suite must be started through tests/auth-e2e/playwright.config.ts`);
  }
  return value;
}

export function databaseUrl(): string {
  // Match the setup/teardown resolver and the CI/RUNBOOK configuration.
  // Otherwise SQL assertions silently lose the CI admin credentials.
  const explicit = process.env.AUTH006_DATABASE_ADMIN_URL;
  if (explicit) return explicit;
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) {
    const url = new URL(fromEnv);
    url.pathname = "/postgres";
    url.search = "";
    url.hash = "";
    return url.toString();
  }
  const user = process.env.USER || process.env.USERNAME || "postgres";
  return `postgresql://${user}@localhost:5432/postgres`;
}

/** DATABASE_URL pointing at THIS run's isolated database. */
export async function isolatedDatabaseUrl(): Promise<string> {
  const state = await stackState();
  const admin = new URL(databaseUrl());
  admin.pathname = `/${state.database.name}`;
  return admin.toString();
}
