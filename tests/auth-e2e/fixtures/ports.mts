/**
 * Fixed port plan for the AUTH-006 isolated stack.
 *
 * Ports are deterministic so the browser-side `--host-resolver-rules` rewrite and the
 * Node-side connect rewrite can be configured statically. Every port can be shifted
 * with AUTH006_PORT_OFFSET to allow parallel isolated runs on one machine.
 *
 * The synthetic OIDC issuer is always `https://synthetic.auth006.internal/` (no port):
 * the Auth0 SDK rejects domains containing ports, and both the frontend and backend
 * issuer validators only accept canonical HTTPS DNS hostnames. Port 443 traffic is
 * transparently remapped:
 *   - browser: proxy → CONNECT relay (strict allowlist) for the provider
 *   - Node (BFF/backend): NODE_OPTIONS=--require node-connect-preload.cjs
 *
 * The PRODUCTION-topology origin (scenario I) is a real HTTPS DNS hostname too. It is
 * reachable because the browser rewrites it with --host-resolver-rules (direct
 * connection, bypassed from the proxy), and the production BFF reaches the backend's
 * HTTPS origin through the preload's api-host rewrite:
 *
 *   https://app.mystcrag.auth006.internal:<appTls>/  (frontend via TLS reverse proxy)
 *   https://api.mystcrag.auth006.internal:<apiTls>/  (backend via TLS reverse proxy)
 */

import net from "node:net";

const BASE = {
  providerTls: 18443,
  providerAdmin: 18444,
  browserRelay: 18445,
  appTls: 18446,
  apiTls: 18447,
  backend: 18450,
  frontend: 18460,
  frontendProd: 18461,
  negativeBackend: 18451,
  negativeFrontend: 18470
} as const;

export const SYNTHETIC_PROVIDER_HOST = "synthetic.auth006.internal";
export const SYNTHETIC_ISSUER = `https://${SYNTHETIC_PROVIDER_HOST}/`;

export const PRODUCTION_APP_HOST = "app.mystcrag.auth006.internal";
export const PRODUCTION_API_HOST = "api.mystcrag.auth006.internal";

export type Auth006Ports = {
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

function offset(): number {
  const raw = process.env.AUTH006_PORT_OFFSET;
  if (raw === undefined || raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error(`AUTH006_PORT_OFFSET must be an integer between 0 and 10000, got: ${raw}`);
  }
  return value;
}

export function resolvePorts(): Auth006Ports {
  const shift = offset();
  return {
    providerTls: BASE.providerTls + shift,
    providerAdmin: BASE.providerAdmin + shift,
    browserRelay: BASE.browserRelay + shift,
    appTls: BASE.appTls + shift,
    apiTls: BASE.apiTls + shift,
    backend: BASE.backend + shift,
    frontend: BASE.frontend + shift,
    frontendProd: BASE.frontendProd + shift,
    negativeBackend: BASE.negativeBackend + shift,
    negativeFrontend: BASE.negativeFrontend + shift
  };
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect({ host: "127.0.0.1", port });
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => {
      probe.destroy();
      resolve(false);
    });
  });
}

/**
 * Fails when any stack port is already bound. Stale processes from a crashed run must
 * be stopped by hand (see RUNBOOK); the suite never kills processes it did not start.
 */
export async function assertPortsFree(ports: Auth006Ports): Promise<void> {
  const busy: string[] = [];
  for (const [name, port] of Object.entries(ports)) {
    if (await isPortOpen(port)) busy.push(`${name}=${port}`);
  }
  if (busy.length > 0) {
    throw new Error(
      `AUTH-006 stack ports already in use: ${busy.join(", ")}. ` +
        "Stop the stale AUTH-006 processes (see tests/auth-e2e/RUNBOOK.md) or set AUTH006_PORT_OFFSET."
    );
  }
}

export async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Port ${port} did not open within ${timeoutMs}ms`);
}

/** Waits until every given port has been RELEASED again (teardown verification). */
export async function waitForPortsReleased(ports: Record<string, number>, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let busy: string[] = [];
  for (;;) {
    busy = [];
    for (const [name, port] of Object.entries(ports)) {
      if (await isPortOpen(port)) busy.push(`${name}=${port}`);
    }
    if (busy.length === 0) return [];
    if (Date.now() >= deadline) return busy;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
