/**
 * Scenario H — Narrow regression verification of the harness itself.
 *
 * The A–G and I scenarios prove the PRODUCT. This scenario proves the HARNESS
 * repairs the SOL review demanded, at unit granularity and against the exact
 * production code paths the E2E specs use:
 *
 *   H1  the API helper performs exactly ONE JSON encoding: the wire body the
 *       server receives is the JSON of the object (verified byte-for-byte against
 *       a local echo server, through the very same clientFor() code path)
 *   H2  the live contrast on the real stack: a request whose body reaches the
 *       backend as a JSON STRING (the shape a double-encoding regression would
 *       produce) is rejected by the real backend schema — such a regression can
 *       never silently pass D/E
 *   H3  the browser CONNECT relay tunnels ONLY the allowlisted host:port with a
 *       matching SNI; every other target (wrong host, wrong port, plain HTTP,
 *       SNI mismatch) is refused, counted, and never piped to the upstream
 *   H4  the CI evidence sanitizer copies ONLY allowlisted, scanned files into
 *       the sanitized directory: TLS material and anything containing credential
 *       material (including inside zip archives) are excluded and reported
 *   H4b the sanitizer FAILS CLOSED: a symlink in the source tree is never read
 *       and never copied, credential material in a file NAME or a zip entry
 *       NAME is a violation, a pre-existing symlink in the destination chain is
 *       never written through — and on ANY violation nothing at all is
 *       published (no sanitized directory, no staging residue)
 *   H4c the REAL sanitizer CLI (spawned through child_process, never the
 *       imported function alone): no arguments → non-zero exit + safe usage; a
 *       clean source publishes a sanitized destination; a dirty source exits
 *       non-zero and publishes nothing; stdout/stderr NEVER carry the secret,
 *       the hit path or any credential content — only sanitized categories
 *       and counts
 *   H4d a file swapped for a symlink MID-RUN can never smuggle denied material
 *       past the scan: either the swap is caught (fail closed, nothing
 *       published) or the published bytes are the ORIGINAL pre-swap bytes —
 *       never the symlink target's content
 *   H4e an unreadable source FILE and an unreadable source DIRECTORY are both
 *       fatal (fail closed, nothing published) — a traversal failure is never
 *       mistaken for an empty directory
 *   H5  teardown PID ownership: a pid is signalled only when its CURRENT command
 *       line matches this run's signature; a recycled/foreign pid fails loudly
 *       instead of being killed
 *   H5b the REAL recovery specs path (recoveredProcessSpecs → stopRecoveredPid):
 *       a recovered frontend/backend pid must match BOTH the command signature
 *       AND the run-scoped cwd; same command + same port + different cwd, an
 *       exited pid and a command mismatch are each refused — and the refusal
 *       provably sends no signal
 *   H6  the SNI parser accepts a real ClientHello and rejects non-hello bytes
 *   H6b the SNI parser enforces EVERY declared length boundary: zero/overflowing
 *       handshake, record, extension, server-name-list and name lengths, a
 *       non-host_name entry type, and a forged SNI placed beyond the
 *       record/handshake boundary are ALL rejected (null) — and through the
 *       live relay none of them ever reaches the upstream
 *   H7  a failed setup propagates a simultaneous cleanup failure as an
 *       AggregateError carrying BOTH errors — a cleanup error can never hide
 *       behind the original setup error
 *   H8  the CI artifact upload is gated on the sanitizer's OWN success
 *       (`failure() && steps.sanitize_auth006.outcome == 'success'`), so a
 *       failing sanitizer can never publish a partial sanitized directory
 *   H9  spec-spawned extra children own DURABLE records under
 *       <runDir>/extra-children/: a child registered in a worker (where the
 *       module-local stack handle is null — the exact worker-crash condition
 *       teardown faces) is stopped by the FRESH recovery path from the
 *       persisted record alone; a record whose cwd points outside this run's
 *       directory is refused WITHOUT any signal, and registration itself
 *       refuses a cwd outside the run
 *
 * H3, H4, H4b, H4c, H4d, H4e, H5, H5b, H6, H6b, H7, H8 and H9 are stack-independent: they start their own
 * throwaway listeners and stand-in child processes so a harness regression is
 * diagnosed without a full-stack run.
 */

import { expect, test } from "@playwright/test";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { bffClient, clientFor, generateDesignRequest } from "../helpers/api";
import { stackState } from "../helpers/run-state";
import { loginAsUser, syntheticUser } from "../helpers/login";
import { startBrowserRelay, parseSniFromClientHello } from "../fixtures/browser-relay";
import { processCommandFor, verifyProcessOwnership } from "../fixtures/process-identity";
import { sanitizeEvidence, SENSITIVE_PATTERNS } from "../scripts/sanitize-evidence.mjs";
import { generateClientHelloFor } from "../fixtures/client-hello-for-test.mts";
import { buildZip } from "../fixtures/trace-redact";
import {
  buildSetupFailure,
  recoverExtraChildren,
  recoveredProcessSpecs,
  registerStackChild,
  resolveRunDirectory,
  stopRecoveredPid,
  REPO_ROOT,
  type ExtraChildRecord,
  type RunState
} from "../fixtures/stack";

type Echoed = {
  method: string;
  url: string;
  contentType: string | undefined;
  rawBody: string;
};

/** The REAL sanitizer CLI, driven as a child process — never as an import. */
const SANITIZER_CLI = path.join(REPO_ROOT, "tests", "auth-e2e", "scripts", "sanitize-evidence.mjs");

function runSanitizerCli(
  args: string[],
  extraEnv: Record<string, string> = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SANITIZER_CLI, ...args], {
      env: { PATH: process.env.PATH ?? "", ...extraEnv }
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const finish = (code: number | null) => resolve({ code, stdout, stderr });
    child.on("exit", (code) => finish(code));
    child.on("error", () => finish(null));
  });
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(target)));
    } else {
      files.push(target);
    }
  }
  return files;
}

async function startEchoServer(): Promise<{ port: number; requests: Echoed[]; stop(): Promise<void> }> {
  const requests: Echoed[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        contentType: request.headers["content-type"],
        rawBody: Buffer.concat(chunks).toString("utf8")
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("echo server did not return a port");
  }
  return {
    port: address.port,
    requests,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      })
  };
}

test.describe("H. narrow harness regressions", () => {
  test("H1 the request helper encodes the JSON body exactly once", async ({ request }) => {
    const echo = await startEchoServer();
    try {
      const client = clientFor(request, async () => "http://127.0.0.1:1");
      const payload = {
        requestId: "auth006-h1",
        nested: { value: 42, list: ["a", "b"] },
        unicode: "玄矶"
      };
      const response = await client.post(`http://127.0.0.1:${echo.port}/echo`, payload);
      expect(response.status).toBe(200);
      expect(echo.requests).toHaveLength(1);

      const seen = echo.requests[0];
      expect(seen.method).toBe("POST");
      expect(seen.contentType).toContain("application/json");

      // The server must receive the JSON OBJECT, byte-for-byte — never a JSON
      // string wrapping the JSON text (double encoding).
      expect(seen.rawBody).toBe(JSON.stringify(payload));

      // The structural proof: exactly one JSON.parse yields the original object.
      const parsed: unknown = JSON.parse(seen.rawBody);
      expect(typeof parsed).toBe("object");
      expect(parsed).toEqual(payload);
    } finally {
      await echo.stop();
    }
  });

  test("H2 a request body that reaches the backend as a JSON string is rejected", async ({ page }) => {
    const user = syntheticUser("auth006-h2", "艾尺");
    await loginAsUser(page, user);
    const api = bffClient(page);
    const state = await stackState();
    const headers = { "content-type": "application/json", origin: state.urls.frontend };

    // The helper path (object as data — one encoding) succeeds against the real BFF.
    const good = await api.generateDesign(generateDesignRequest());
    expect(good.status, `object body must succeed: ${good.body}`).toBe(200);

    // The double-encoding shape: JSON.stringify applied twice. The wire body is a
    // JSON STRING (not an object), so the real backend schema must reject it —
    // proving a double-encoding regression in the helper fails loudly at D/E.
    const doubleEncoded = await page.request.post(`${state.urls.frontend}/api/design/generate`, {
      headers,
      data: JSON.stringify(JSON.stringify(generateDesignRequest())),
      failOnStatusCode: false,
      maxRedirects: 0
    });
    expect(doubleEncoded.status()).toBe(400);

    // The verbatim shape: a parsable JSON string under a JSON content type is sent
    // as-is by Playwright, so it stays a single encoding and must stay accepted.
    // Asserted to make the helper's wire contract (an object on the wire) explicit.
    const passthrough = await page.request.post(`${state.urls.frontend}/api/design/generate`, {
      headers,
      data: JSON.stringify(generateDesignRequest()),
      failOnStatusCode: false,
      maxRedirects: 0
    });
    expect(passthrough.status()).toBe(200);
  });

  test("H3 the CONNECT relay tunnels only the allowlisted host:port with a matching SNI", async () => {
    // A throwaway plain-TCP upstream standing in for the synthetic provider. The
    // relay only inspects the ClientHello and then pipes bytes, so the upstream
    // never needs to complete a TLS handshake for this regression.
    const upstream = net.createServer((socket) => {
      socket.on("data", () => {
        socket.write("UPSTREAM-REACHED marker=1\r\n");
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    const upstreamPort = (upstream.address() as net.AddressInfo).port;

    const ALLOWED_HOST = "allowed.auth006.internal";
    const relay = await startBrowserRelay({
      port: 0,
      allowlist: [{ host: ALLOWED_HOST, port: 443, upstreamPort }]
    });

    try {
      function connectThrough(
        target: string,
        firstBytes?: Buffer,
        resolveWhen?: (data: string) => boolean,
        timeoutMs = 5_000,
        rawRequest?: string
      ): Promise<{ status: string; body: string }> {
        return new Promise((resolve) => {
          const socket = net.connect(relay.port, "127.0.0.1");
          let data = "";
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            const header = data.split("\r\n\r\n")[0] ?? "";
            resolve({ status: header.split("\r\n")[0] ?? "", body: data });
          };
          const timer = setTimeout(finish, timeoutMs);
          socket.on("connect", () => {
            socket.write(rawRequest ?? `CONNECT ${target} HTTP/1.1\r\nhost: ${target}\r\n\r\n`);
            if (firstBytes) socket.write(firstBytes);
          });
          socket.on("data", (chunk: Buffer) => {
            data += chunk.toString("latin1");
            // When a resolveWhen probe is given, ONLY that condition completes the
            // read: the relay's "200 Connection Established\r\n\r\n" header always
            // arrives before any tunneled upstream byte, so finishing on the bare
            // header separator would destroy the socket before the marker lands.
            if (resolveWhen ? resolveWhen(data) : /\r\n\r\n/.test(data)) finish();
          });
          socket.on("error", finish);
          socket.on("close", finish);
        });
      }

      // (a) A plain-HTTP request line (not CONNECT) is refused with 405: the relay
      // is CONNECT-only and never offers plain-HTTP proxying. The 405 path is
      // uncounted by design — only CONNECT refusals are counted below.
      const plain = await connectThrough(
        "ignored.example:80",
        undefined,
        undefined,
        5_000,
        "GET http://ignored.example/ HTTP/1.1\r\nhost: ignored.example\r\n\r\n"
      );
      expect(plain.status).toContain("405");

      // (b) A different host on the allowlisted port is refused.
      const wrongHost = await connectThrough("evil.auth006.internal:443");
      expect(wrongHost.status).toContain("403");

      // (c) The allowlisted host on a DIFFERENT port is refused.
      const wrongPort = await connectThrough(`${ALLOWED_HOST}:8443`);
      expect(wrongPort.status).toContain("403");

      // (d) The allowlisted tuple with a MISMATCHED SNI: the tunnel is destroyed
      // after the 200 — the upstream marker must never reach the client.
      const sniMismatch = await connectThrough(
        `${ALLOWED_HOST}:443`,
        generateClientHelloFor("other.auth006.internal"),
        undefined,
        3_000
      );
      expect(sniMismatch.body).not.toContain("UPSTREAM-REACHED");

      // (e) The allowlisted tuple with a MATCHING SNI is tunneled to the upstream.
      const good = await connectThrough(
        `${ALLOWED_HOST}:443`,
        generateClientHelloFor(ALLOWED_HOST),
        (data) => data.includes("UPSTREAM-REACHED"),
        8_000
      );
      expect(good.status).toContain("200");
      expect(good.body).toContain("UPSTREAM-REACHED");

      // (f) The counters prove every decision was observed, not assumed.
      const stats = relay.stats();
      expect(stats.allowed).toBe(1);
      expect(stats.byHost[ALLOWED_HOST]).toBe(1);
      expect(stats.refused).toBe(2);
      expect(stats.sniRefused).toBe(1);
      expect(stats.refusedTargets).toContainEqual({ host: "evil.auth006.internal", port: 443 });
      expect(stats.refusedTargets).toContainEqual({ host: ALLOWED_HOST, port: 8443 });
    } finally {
      await relay.stop();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  test("H4 the evidence sanitizer publishes only allowlisted, fully scanned clean files", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth006-h4a-"));
    const sourceRoot = path.join(tmp, "run");
    const destinationRoot = path.join(tmp, "sanitized");
    const secretValue = `secret-${crypto.randomBytes(24).toString("hex")}`;

    try {
      await fs.mkdir(path.join(sourceRoot, "logs"), { recursive: true });
      await fs.mkdir(path.join(sourceRoot, "test-results", "failed-test"), { recursive: true });
      await fs.mkdir(path.join(sourceRoot, "tls"), { recursive: true });

      await fs.writeFile(path.join(sourceRoot, "run-state.json"), JSON.stringify({ runId: "h4a" }), "utf8");
      await fs.writeFile(path.join(sourceRoot, "logs", "backend.log"), "clean log line\n", "utf8");
      // TLS material and denied extensions are excluded WITHOUT being violations:
      // a fully clean run is still published.
      await fs.writeFile(path.join(sourceRoot, "tls", "synthetic-provider.key.pem"), "key material\n", "utf8");
      await fs.writeFile(path.join(sourceRoot, "blob.bin"), "binary", "utf8");
      const cleanZip = buildZip([
        { name: "0.trace", data: Buffer.from('{"name":"accept","value":"text/html"}') },
        { name: "1.trace", data: Buffer.from('{"name":"cookie","value":"[REDACTED-AUTH006]"}') }
      ]);
      await fs.writeFile(path.join(sourceRoot, "test-results", "failed-test", "trace.zip"), cleanZip);

      const summary = await sanitizeEvidence(sourceRoot, destinationRoot, { secrets: [secretValue] });

      // A clean run publishes: ok, and the published directory really exists.
      expect(summary.ok).toBe(true);
      expect(summary.violations).toHaveLength(0);

      const copied = summary.copied as string[];
      expect(copied).toContain("run-state.json");
      expect(copied).toContain("logs/backend.log");
      expect(copied).toContain("test-results/failed-test/trace.zip");
      expect(copied).not.toContain("blob.bin");
      expect(copied.filter((entry: string) => entry.startsWith("tls/"))).toHaveLength(0);

      const published = await fs.readdir(destinationRoot);
      expect(published).toContain("run-state.json");
      expect(published).toContain("sanitize-summary.json");
      const publishedSummary = JSON.parse(
        await fs.readFile(path.join(destinationRoot, "sanitize-summary.json"), "utf8")
      ) as { ok: boolean; copiedFiles: number };
      expect(publishedSummary.ok).toBe(true);
      expect(publishedSummary.copiedFiles).toBe(copied.length);

      // Nothing published contains the secret.
      for (const entry of copied) {
        const content = await fs.readFile(path.join(destinationRoot, entry), "utf8");
        expect(content.includes(secretValue)).toBe(false);
      }

      // No staging residue is left next to the destination.
      const siblings = await fs.readdir(tmp);
      expect(siblings.filter((name: string) => name.startsWith("sanitized.staging-"))).toHaveLength(0);

      // The shared sensitive pattern set is non-trivial and stays exported for the
      // teardown scan (global-teardown imports the same module).
      expect(SENSITIVE_PATTERNS.length).toBeGreaterThanOrEqual(7);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("H4b the sanitizer fails closed on symlinks, credential-bearing names, and publishes nothing on failure", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth006-h4b-"));
    const secretValue = `secret-${crypto.randomBytes(24).toString("hex")}`;

    try {
      // --- Case 1: a dirty source tree must never produce a published directory. ---
      const dirtySource = path.join(tmp, "dirty-run");
      const dirtyDestination = path.join(tmp, "dirty-sanitized");
      await fs.mkdir(path.join(dirtySource, "logs"), { recursive: true });
      await fs.mkdir(path.join(dirtySource, "tls"), { recursive: true });
      await fs.mkdir(path.join(dirtySource, "test-results"), { recursive: true });

      // An allowlisted .log NAME that is a symbolic link to TLS private key
      // material: must be refused without ever reading through the link.
      await fs.writeFile(
        path.join(dirtySource, "tls", "synthetic-provider.key.pem"),
        `-----BEGIN PRIVATE KEY-----\n${secretValue}\n-----END PRIVATE KEY-----\n`,
        "utf8"
      );
      await fs.symlink(
        path.join(dirtySource, "tls", "synthetic-provider.key.pem"),
        path.join(dirtySource, "logs", "safe.log")
      );
      // A file NAME that itself carries the credential.
      await fs.writeFile(path.join(dirtySource, "logs", `token-${secretValue}.log`), "clean body\n", "utf8");
      // A leaky body.
      await fs.writeFile(path.join(dirtySource, "logs", "leaky.log"), `token=${secretValue}\n`, "utf8");
      // A zip whose ENTRY NAME carries the credential.
      await fs.writeFile(
        path.join(dirtySource, "test-results", "dirty-name.zip"),
        buildZip([{ name: `token-${secretValue}.trace`, data: Buffer.from("{}") }])
      );
      // A zip whose entry BODY carries the credential.
      await fs.writeFile(
        path.join(dirtySource, "test-results", "dirty-trace.zip"),
        buildZip([
          {
            name: "0.trace",
            // JSON.stringify so this spec's own source never embeds the literal
            // violation shape (the teardown scan reads this file too).
            data: Buffer.from(JSON.stringify({ name: "authorization", value: `Bearer ${secretValue}` }))
          }
        ])
      );

      const dirtySummary = await sanitizeEvidence(dirtySource, dirtyDestination, { secrets: [secretValue] });
      expect(dirtySummary.ok).toBe(false);
      const dirtyPaths = dirtySummary.violations.map((violation: { path: string }) => violation.path);
      expect(dirtyPaths).toContain("logs/safe.log");
      expect(dirtyPaths).toContain(`logs/token-${secretValue}.log`);
      expect(dirtyPaths).toContain("logs/leaky.log");
      expect(dirtyPaths).toContain("test-results/dirty-name.zip");
      expect(dirtyPaths).toContain("test-results/dirty-trace.zip");

      // The symlink violation must carry the fail-closed reason.
      const symlinkViolation = dirtySummary.violations.find(
        (violation: { path: string }) => violation.path === "logs/safe.log"
      );
      expect(JSON.stringify(symlinkViolation?.hits)).toContain("symbolic link");

      // NOTHING was published: no uploadable destination, no staging residue, and
      // the private key material never left the source tree.
      await expect(fs.stat(dirtyDestination)).rejects.toThrow();
      const tmpEntries = await fs.readdir(tmp);
      expect(tmpEntries.filter((name: string) => name.startsWith("dirty-sanitized.staging-"))).toHaveLength(0);

      // --- Case 2: a pre-existing symlink in the destination chain is never
      // written through, even for a fully clean source. ---
      const cleanSource = path.join(tmp, "clean-run");
      const escapeRoot = path.join(tmp, "escape");
      const chainedDestination = path.join(tmp, "chained-sanitized");
      await fs.mkdir(path.join(cleanSource, "logs"), { recursive: true });
      await fs.writeFile(path.join(cleanSource, "run-state.json"), JSON.stringify({ runId: "h4b" }), "utf8");
      await fs.writeFile(path.join(cleanSource, "logs", "backend.log"), "clean log line\n", "utf8");
      await fs.mkdir(escapeRoot, { recursive: true });
      await fs.mkdir(chainedDestination, { recursive: true });
      await fs.symlink(escapeRoot, path.join(chainedDestination, "logs"));

      const chainedSummary = await sanitizeEvidence(cleanSource, chainedDestination, { secrets: [secretValue] });
      expect(chainedSummary.ok).toBe(false);
      expect(JSON.stringify(chainedSummary.violations)).toContain("symbolic link in destination chain");
      // The clean file was refused rather than written through the link...
      expect(chainedSummary.copied as string[]).not.toContain("logs/backend.log");
      // ...and the escape directory received nothing at all.
      expect(await fs.readdir(escapeRoot)).toHaveLength(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("H4c the real sanitizer CLI: usage exit, clean publish, dirty fail-closed, secret-free output", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth006-h4c-"));
    const secretValue = `secret-${crypto.randomBytes(24).toString("hex")}`;
    try {
      // (a) No arguments: non-zero exit and a safe usage line on stderr.
      const usage = await runSanitizerCli([]);
      expect(usage.code).not.toBe(null);
      expect(usage.code).not.toBe(0);
      expect(usage.stderr).toContain("usage:");
      expect(usage.stderr).toContain("AUTH006_CLIENT_SECRET");
      expect(usage.stderr.includes(secretValue)).toBe(false);

      // (b) Extra arguments are refused the same way — the CLI contract is
      // exactly two positional arguments.
      const extra = await runSanitizerCli(["one", "two", "three"]);
      expect(extra.code).not.toBe(0);
      expect(extra.stderr).toContain("usage:");

      // (c) A clean source: exit 0 and the sanitized destination really exists.
      // Secrets reach the CLI ONLY through the named environment, never argv.
      const cleanSource = path.join(tmp, "clean-run");
      const cleanDestination = path.join(tmp, "clean-sanitized");
      await fs.mkdir(path.join(cleanSource, "logs"), { recursive: true });
      await fs.writeFile(path.join(cleanSource, "run-state.json"), JSON.stringify({ runId: "h4c" }), "utf8");
      await fs.writeFile(path.join(cleanSource, "logs", "backend.log"), "clean log line\n", "utf8");
      const clean = await runSanitizerCli([cleanSource, cleanDestination], {
        AUTH006_CLIENT_SECRET: secretValue,
        AUTH006_SESSION_SECRET: secretValue,
        AUTH006_ADMIN_TOKEN: secretValue
      });
      expect(clean.code, `clean CLI run failed: ${clean.stderr}`).toBe(0);
      expect(clean.stdout).toContain("sanitized evidence ready");
      expect(clean.stdout).toContain("run secrets from env: 3");
      const published = await fs.readdir(cleanDestination);
      expect(published).toContain("run-state.json");
      expect(published).toContain("sanitize-summary.json");
      expect(await fs.readdir(path.join(cleanDestination, "logs"))).toContain("backend.log");
      const publishedSummary = JSON.parse(
        await fs.readFile(path.join(cleanDestination, "sanitize-summary.json"), "utf8")
      ) as { ok: boolean; copiedFiles: number; violations: unknown[] };
      expect(publishedSummary.ok).toBe(true);
      expect(publishedSummary.copiedFiles).toBe(2);
      expect(publishedSummary.violations).toHaveLength(0);
      expect(clean.stdout.includes(secretValue)).toBe(false);
      expect(clean.stderr.includes(secretValue)).toBe(false);

      // (d) A dirty source (secret in a file BODY and in a file NAME): non-zero
      // exit, nothing published — and the CLI output NEVER carries the secret,
      // the hit path or the credential-bearing file name: only sanitized
      // categories and counts.
      const dirtySource = path.join(tmp, "dirty-run");
      const dirtyDestination = path.join(tmp, "dirty-sanitized");
      await fs.mkdir(path.join(dirtySource, "logs"), { recursive: true });
      await fs.writeFile(path.join(dirtySource, "logs", "leaky.log"), `token=${secretValue}\n`, "utf8");
      await fs.writeFile(path.join(dirtySource, "logs", `token-${secretValue}.log`), "clean body\n", "utf8");
      const dirty = await runSanitizerCli([dirtySource, dirtyDestination], {
        AUTH006_CLIENT_SECRET: secretValue
      });
      expect(dirty.code).not.toBe(null);
      expect(dirty.code).not.toBe(0);
      expect(dirty.stderr).toContain("credential material detected");
      expect(dirty.stderr).toContain("credential-in-content");
      expect(dirty.stderr).toContain("credential-in-name");
      expect(dirty.stderr.includes(secretValue)).toBe(false);
      expect(dirty.stderr.includes("leaky.log")).toBe(false);
      expect(dirty.stdout.includes(secretValue)).toBe(false);
      expect(dirty.stdout.includes("leaky.log")).toBe(false);
      // Fail closed: no destination, no staging residue.
      await expect(fs.stat(dirtyDestination)).rejects.toThrow();
      expect((await fs.readdir(tmp)).filter((name) => name.startsWith("dirty-sanitized.staging-"))).toHaveLength(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("H4d a mid-run symlink swap can never smuggle denied material past the scan", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth006-h4d-"));
    const secretValue = `secret-${crypto.randomBytes(24).toString("hex")}`;
    try {
      const source = path.join(tmp, "swap-run");
      const destination = path.join(tmp, "swap-sanitized");
      const deniedDir = path.join(source, "tls");
      const logsDir = path.join(source, "logs");
      await fs.mkdir(deniedDir, { recursive: true });
      await fs.mkdir(logsDir, { recursive: true });

      // The denied material the swapped symlink will point at.
      const keyPath = path.join(deniedDir, "synthetic-provider.key.pem");
      await fs.writeFile(keyPath, `-----BEGIN PRIVATE KEY-----\n${secretValue}\n-----END PRIVATE KEY-----\n`, "utf8");

      // The victim: a large allowlisted file that holds the sanitizer mid-run,
      // giving the swap every chance to land between the directory listing and
      // the open — the exact TOCTOU window the single-descriptor design closes.
      const victimPath = path.join(logsDir, "victim.log");
      await fs.writeFile(victimPath, `clean-prefix\n${"x".repeat(24 * 1024 * 1024)}\n`, "utf8");
      const originalVictim = await fs.readFile(victimPath);

      const child = spawn(process.execPath, [SANITIZER_CLI, source, destination], {
        env: { PATH: process.env.PATH ?? "", AUTH006_CLIENT_SECRET: secretValue }
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      // Swap the victim for a symlink AT the denied material while the run is
      // live — at whatever point the sanitizer has reached it.
      await fs.rm(victimPath);
      await fs.symlink(keyPath, victimPath);
      const code = await new Promise<number | null>((resolve) => {
        child.on("exit", (exitCode) => resolve(exitCode));
        child.on("error", () => resolve(null));
      });

      // The CLI's own output never carries the secret, whatever happened.
      expect(stdout.includes(secretValue)).toBe(false);
      expect(stderr.includes(secretValue)).toBe(false);

      if (code === 0) {
        // The victim was fully read BEFORE the swap landed: the published bytes
        // are the ORIGINAL pre-swap bytes — the symlink target's content never
        // made it into the sanitized output.
        const publishedVictim = await fs.readFile(path.join(destination, "logs", "victim.log"));
        expect(publishedVictim.equals(originalVictim)).toBe(true);
        for (const file of await filesUnder(destination)) {
          expect((await fs.readFile(file)).includes(secretValue)).toBe(false);
        }
      } else {
        // The swap was caught — at collection (dirent type), at open (ELOOP
        // under O_NOFOLLOW) or as a vanished file — and the run fails closed:
        // NOTHING is published.
        expect(code).toBe(1);
        await expect(fs.stat(destination)).rejects.toThrow();
      }
      // No staging residue either way.
      expect((await fs.readdir(tmp)).filter((name) => name.startsWith("swap-sanitized.staging-"))).toHaveLength(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("H4e an unreadable source file and an unreadable directory are both fatal", async () => {
    test.skip(
      typeof process.getuid === "function" && process.getuid() === 0,
      "permission-denied fail-closed cases cannot be exercised as root"
    );
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth006-h4e-"));
    try {
      // (a) An unreadable source FILE: a recorded source-read-failure violation,
      // non-zero exit, nothing published — never a silent skip.
      const fileSource = path.join(tmp, "file-run");
      const fileDestination = path.join(tmp, "file-sanitized");
      const lockedLogs = path.join(fileSource, "logs");
      await fs.mkdir(lockedLogs, { recursive: true });
      await fs.writeFile(path.join(lockedLogs, "backend.log"), "clean log line\n", "utf8");
      const unreadable = path.join(lockedLogs, "unreadable.log");
      await fs.writeFile(unreadable, "clean but unreadable\n", "utf8");
      await fs.chmod(unreadable, 0o000);
      const fileRun = await runSanitizerCli([fileSource, fileDestination]);
      expect(fileRun.code).not.toBe(null);
      expect(fileRun.code).not.toBe(0);
      expect(fileRun.stderr).toContain("source-read-failure");
      await expect(fs.stat(fileDestination)).rejects.toThrow();

      // (b) An unreadable source DIRECTORY: a fatal traversal failure — never
      // mistaken for an empty directory that sanitizes "clean".
      const dirSource = path.join(tmp, "dir-run");
      const dirDestination = path.join(tmp, "dir-sanitized");
      const reachableLogs = path.join(dirSource, "logs");
      const lockedSubdir = path.join(reachableLogs, "locked");
      await fs.mkdir(lockedSubdir, { recursive: true });
      await fs.writeFile(path.join(reachableLogs, "backend.log"), "clean log line\n", "utf8");
      await fs.writeFile(path.join(lockedSubdir, "hidden.log"), "clean but unreachable\n", "utf8");
      await fs.chmod(lockedSubdir, 0o000);
      const dirRun = await runSanitizerCli([dirSource, dirDestination]);
      expect(dirRun.code).not.toBe(null);
      expect(dirRun.code).not.toBe(0);
      expect(dirRun.stderr).toContain("traversal or read failed");
      await expect(fs.stat(dirDestination)).rejects.toThrow();
      expect((await fs.readdir(tmp)).filter((name) => name.startsWith("dir-sanitized.staging-"))).toHaveLength(0);
    } finally {
      // Restore accessibility so the recursive cleanup can remove the trees.
      await fs.chmod(path.join(tmp, "file-run", "logs", "unreadable.log"), 0o644).catch(() => undefined);
      await fs.chmod(path.join(tmp, "dir-run", "logs", "locked"), 0o755).catch(() => undefined);
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("H5 teardown signals a pid only when its CURRENT command line matches this run", async () => {
    // This test process itself: owned when the pattern matches, foreign when not.
    const owned = await verifyProcessOwnership({
      pid: process.pid,
      patterns: [/node/i, /playwright/i]
    });
    expect(owned.kind).toBe("owned");

    const foreign = await verifyProcessOwnership({
      pid: process.pid,
      patterns: [/^this-pattern-matches-nothing-at-all$/]
    });
    expect(foreign.kind).toBe("foreign");
    if (foreign.kind === "foreign") {
      expect(foreign.pid).toBe(process.pid);
      expect(foreign.command.length).toBeGreaterThan(0);
    }

    // A pid that cannot exist (kernel pid_max ceiling on Linux) is "gone", never an error.
    const gone = await verifyProcessOwnership({
      pid: 4_194_303,
      patterns: [/./]
    });
    expect(gone.kind).toBe("gone");
  });

  test("H5b teardown refuses same-command foreign pids with a different run cwd (real specs path)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth006-h5b-"));
    // macOS TMPDIR is a symlink (/var → /private/var): the kernel resolves a
    // process cwd to the REAL path, so the run-scoped cwd expectation must be
    // built from the realpath or the owned case could never match.
    const realTmp = await fs.realpath(tmp);

    // The run-scoped checkout shape the stack writes (workDirs embed the run id).
    const backendDir = path.join(realTmp, "work", "apps", "backend");
    const frontendDir = path.join(realTmp, "work", "apps", "frontend");
    await fs.mkdir(path.join(backendDir, "dist"), { recursive: true });
    await fs.mkdir(path.join(frontendDir, "bin"), { recursive: true });
    // Stand-ins with the EXACT shapes the recovery specs match: a backend bundle
    // at <workDirs.backend>/dist/index.js, and a "next start -p <port>" frontend.
    await fs.writeFile(path.join(backendDir, "dist", "index.js"), "setInterval(() => {}, 1000);\n", "utf8");
    await fs.writeFile(path.join(frontendDir, "bin", "next"), "setInterval(() => {}, 1000);\n", "utf8");

    const state: RunState = {
      runId: "h5b",
      createdAt: new Date().toISOString(),
      ports: {
        providerTls: 0,
        providerAdmin: 0,
        browserRelay: 0,
        appTls: 0,
        apiTls: 0,
        backend: 0,
        frontend: 43210,
        frontendProd: 0,
        negativeBackend: 0,
        negativeFrontend: 0
      },
      urls: { frontend: "", frontendProd: "", backend: "", backendTls: "", providerIssuer: "", providerAdmin: "" },
      database: { name: "", host: "", port: 0, user: "" },
      workDirs: { backend: backendDir, frontend: frontendDir },
      processes: {},
      timings: { startedAt: new Date().toISOString() }
    };

    // The REAL recovery path: the exact specs teardown drives, unmodified.
    const specs = recoveredProcessSpecs(state);
    const backendSpec = specs.find((spec) => spec.label === "backend");
    const frontendSpec = specs.find((spec) => spec.label === "frontend");
    expect(backendSpec?.cwd).toBe(backendDir);
    expect(frontendSpec?.cwd).toBe(frontendDir);

    function spawnStandIn(args: string[], cwd: string): ChildProcess {
      return spawn(process.execPath, args, { cwd, stdio: "ignore" });
    }
    // Poll until ps can see the freshly spawned pid (exec race), then return it.
    async function waitForVisible(pid: number | undefined): Promise<number> {
      expect(pid).toBeDefined();
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if ((await processCommandFor(pid!)) !== null) return pid!;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`stand-in pid ${pid} never became visible to ps`);
    }
    function exited(child: ChildProcess): boolean {
      return child.exitCode !== null || child.signalCode !== null;
    }
    async function waitForExit(child: ChildProcess): Promise<void> {
      if (exited(child)) return;
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }

    try {
      // (a) correct command + correct run cwd → the REAL backend spec stops it.
      const ownedBackend = spawnStandIn([path.join(backendDir, "dist", "index.js")], backendDir);
      await waitForVisible(ownedBackend.pid);
      await stopRecoveredPid({ ...backendSpec!, pid: ownedBackend.pid });
      await waitForExit(ownedBackend);
      expect(exited(ownedBackend)).toBe(true);

      // (a') the REAL frontend spec — the exact `next start -p <port>` case the
      // review flagged — stops the child running in the run-scoped frontend cwd.
      const ownedFrontend = spawnStandIn(
        [path.join(frontendDir, "bin", "next"), "start", "-p", String(state.ports.frontend)],
        frontendDir
      );
      await waitForVisible(ownedFrontend.pid);
      await stopRecoveredPid({ ...frontendSpec!, pid: ownedFrontend.pid });
      await waitForExit(ownedFrontend);
      expect(exited(ownedFrontend)).toBe(true);

      // (b) SAME command, SAME port, DIFFERENT cwd → refused, and the refusal
      // provably sent no signal: the process is still alive afterwards.
      const foreignCwd = path.join(realTmp, "foreign-cwd");
      await fs.mkdir(foreignCwd, { recursive: true });
      const foreignFrontend = spawnStandIn(
        [path.join(frontendDir, "bin", "next"), "start", "-p", String(state.ports.frontend)],
        foreignCwd
      );
      await waitForVisible(foreignFrontend.pid);
      await expect(
        stopRecoveredPid({ ...frontendSpec!, pid: foreignFrontend.pid })
      ).rejects.toThrow(/foreign\/recycled .* current working directory .* does not equal/);
      expect(exited(foreignFrontend), "a refused pid must never have been signalled").toBe(false);
      expect(await processCommandFor(foreignFrontend.pid)).not.toBeNull();
      foreignFrontend.kill("SIGKILL");
      await waitForExit(foreignFrontend);

      // (c) a pid that already exited is skipped safely — no error, no signal.
      const goneChild = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
      await waitForExit(goneChild);
      await stopRecoveredPid({ ...backendSpec!, pid: goneChild.pid });

      // (d) command mismatch (even in the correct cwd) → refused, never signalled.
      const wrongCommand = spawnStandIn(["-e", "setInterval(() => {}, 1000)"], backendDir);
      await waitForVisible(wrongCommand.pid);
      await expect(
        stopRecoveredPid({ ...backendSpec!, pid: wrongCommand.pid })
      ).rejects.toThrow(/command line does not match/);
      expect(exited(wrongCommand), "a refused pid must never have been signalled").toBe(false);
      expect(await processCommandFor(wrongCommand.pid)).not.toBeNull();
      wrongCommand.kill("SIGKILL");
      await waitForExit(wrongCommand);
    } finally {
      await fs.rm(realTmp, { recursive: true, force: true });
    }
  });

  test("H6 the SNI parser accepts a real ClientHello and rejects non-hello bytes", async () => {
    const hello = generateClientHelloFor("sni-check.auth006.internal");
    expect(parseSniFromClientHello(hello)).toBe("sni-check.auth006.internal");

    expect(parseSniFromClientHello(Buffer.from("GET / HTTP/1.1\r\n\r\n"))).toBeNull();
    expect(parseSniFromClientHello(Buffer.alloc(0))).toBeNull();
    expect(parseSniFromClientHello(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x01, 0xff]))).toBeNull();
    // A handshake record that is not a ClientHello.
    expect(
      parseSniFromClientHello(Buffer.concat([Buffer.from([0x16, 0x03, 0x01, 0x00, 0x04]), Buffer.from([0x02, 0x00, 0x00, 0x00])]))
    ).toBeNull();
  });

  test("H6b the SNI parser enforces every declared length boundary — no forgery reaches the upstream", async () => {
    const HOST = "allowed.auth006.internal";

    // A ClientHello builder with EXPLICITLY forgable length fields — byte-for-byte
    // the shape of generateClientHelloFor when no override is given.
    const u16 = (value: number) => Buffer.from([(value >> 8) & 0xff, value & 0xff]);
    const u24 = (value: number) => Buffer.from([(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
    const forge = (overrides: {
      handshakeLength?: number;
      recordLength?: number;
      extensionsLength?: number;
      sniExtensionLength?: number;
      listLength?: number;
      nameLength?: number;
      nameType?: number;
      sniAfterHandshake?: boolean;
      sniAfterRecord?: boolean;
    }): Buffer => {
      const name = Buffer.from(HOST, "ascii");
      const sniExtension = Buffer.concat([
        Buffer.from([0x00, 0x00]),
        u16(overrides.sniExtensionLength ?? name.length + 5),
        u16(overrides.listLength ?? name.length + 3),
        Buffer.from([overrides.nameType ?? 0x00]),
        u16(overrides.nameLength ?? name.length),
        name
      ]);
      const includeSniInBody = !overrides.sniAfterHandshake && !overrides.sniAfterRecord;
      const extensions = Buffer.concat([
        ...(includeSniInBody ? [sniExtension] : []),
        Buffer.from([0x00, 0x0d, 0x00, 0x00])
      ]);
      const body = Buffer.concat([
        Buffer.from([0x03, 0x03]),
        crypto.randomBytes(32),
        Buffer.from([0x00]),
        Buffer.from([0x00, 0x02, 0xc0, 0x2f]),
        Buffer.from([0x01, 0x00]),
        u16(overrides.extensionsLength ?? extensions.length),
        extensions
      ]);
      const handshake = Buffer.concat([
        Buffer.from([0x01]),
        u24(overrides.handshakeLength ?? body.length),
        body
      ]);
      const payload = overrides.sniAfterHandshake ? Buffer.concat([handshake, sniExtension]) : handshake;
      const record = Buffer.concat([
        Buffer.from([0x16, 0x03, 0x01]),
        u16(overrides.recordLength ?? payload.length),
        payload
      ]);
      return overrides.sniAfterRecord ? Buffer.concat([record, sniExtension]) : record;
    };

    // The builder itself is sane: unmodified, it parses to the exact host.
    expect(parseSniFromClientHello(forge({}))).toBe(HOST);

    // Every declared length is enforced against its PARENT boundary: zero,
    // overflowing, truncated or trailing-forged declarations are rejected
    // outright — never silently clamped, never scanned past the boundary.
    const forgeries: Array<[string, Buffer]> = [
      ["zero handshake length", forge({ handshakeLength: 0 })],
      ["handshake length beyond the record", forge({ handshakeLength: 0xffffff })],
      ["extensions length beyond the handshake", forge({ extensionsLength: 0xffff })],
      ["zero server_name extension length", forge({ sniExtensionLength: 0 })],
      ["server_name extension length beyond the extensions block", forge({ sniExtensionLength: 0xffff })],
      ["server-name-list beyond its extension", forge({ listLength: HOST.length + 64 })],
      ["name length beyond the server-name list", forge({ nameLength: HOST.length + 64 })],
      ["non-host_name entry type", forge({ nameType: 0x01 })],
      // The SNI entry is physically present INSIDE the record but beyond the
      // declared handshake boundary — a parser slackened to recordEnd would
      // recover the allowlisted host here; strict bounds return null.
      ["forged SNI beyond the handshake boundary", forge({ sniAfterHandshake: true })],
      // The SNI entry sits entirely AFTER the declared record end.
      ["forged SNI beyond the record boundary", forge({ sniAfterRecord: true })]
    ];
    for (const [label, hello] of forgeries) {
      expect(parseSniFromClientHello(hello), `${label} must parse as null`).toBeNull();
    }

    // Through the LIVE relay: none of the forgeries may ever reach the upstream.
    // The upstream counts every tunneled byte — the gate must refuse every
    // forgery BEFORE a single byte is piped.
    let upstreamDataBytes = 0;
    const upstream = net.createServer((socket) => {
      socket.on("data", (chunk: Buffer) => {
        upstreamDataBytes += chunk.length;
        socket.write("UPSTREAM-REACHED marker=1\r\n");
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    const upstreamPort = (upstream.address() as net.AddressInfo).port;

    const relay = await startBrowserRelay({
      port: 0,
      allowlist: [{ host: HOST, port: 443, upstreamPort }]
    });

    try {
      const connectWithHello = async (hello: Buffer): Promise<void> => {
        const refusalsBefore = relay.stats().sniRefused;
        const socket = net.connect(relay.port, "127.0.0.1");
        await new Promise<void>((resolve) => {
          socket.on("connect", () => {
            socket.write(`CONNECT ${HOST}:443 HTTP/1.1\r\nhost: ${HOST}:443\r\n\r\n`);
            socket.write(hello);
            resolve();
          });
          socket.on("error", resolve);
        });
        try {
          // The relay's sniRefused COUNTER is the deterministic proof that this
          // forged hello was actually read, parsed and refused. (The relay's
          // destroy() only half-closes the TCP connection, so waiting for the
          // client-side close event would hang on a timeout instead — the
          // counter cannot be satisfied by silence.)
          const deadline = Date.now() + 5_000;
          while (relay.stats().sniRefused <= refusalsBefore && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          expect(relay.stats().sniRefused, "the relay must have refused the forged hello").toBeGreaterThan(
            refusalsBefore
          );
        } finally {
          socket.destroy();
        }
      };

      for (const [, hello] of forgeries) {
        await connectWithHello(hello);
      }

      // Not one tunneled byte reached the upstream, and nothing counted allowed.
      expect(upstreamDataBytes).toBe(0);
      const stats = relay.stats();
      expect(stats.allowed).toBe(0);
      expect(stats.sniRefused).toBe(forgeries.length);

      // The control: the same tunnel with the WELL-FORMED hello for this host
      // IS established and reaches the upstream — the refusals above were
      // refusals of the forgeries, not of a broken relay.
      const good = await new Promise<boolean>((resolve) => {
        const socket = net.connect(relay.port, "127.0.0.1");
        let data = "";
        const timer = setTimeout(() => {
          socket.destroy();
          resolve(false);
        }, 8_000);
        socket.on("connect", () => {
          socket.write(`CONNECT ${HOST}:443 HTTP/1.1\r\nhost: ${HOST}:443\r\n\r\n`);
          socket.write(generateClientHelloFor(HOST));
        });
        socket.on("data", (chunk: Buffer) => {
          data += chunk.toString("latin1");
          if (data.includes("UPSTREAM-REACHED")) {
            clearTimeout(timer);
            socket.destroy();
            resolve(true);
          }
        });
        socket.on("error", () => {
          clearTimeout(timer);
          socket.destroy();
          resolve(false);
        });
      });
      expect(good).toBe(true);
      expect(relay.stats().allowed).toBe(1);
      expect(upstreamDataBytes).toBeGreaterThan(0);
    } finally {
      await relay.stop();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  test("H7 a failed setup propagates a simultaneous cleanup failure instead of swallowing it", async () => {
    const setupError = new Error("setup failed: provider did not become ready");
    const cleanupError = new Error("cleanup failed: port 43210 still bound");

    // Cleanup succeeded → the ORIGINAL setup error propagates unchanged.
    expect(buildSetupFailure(setupError, null)).toBe(setupError);
    expect(buildSetupFailure(setupError, undefined)).toBe(setupError);

    // Cleanup failed too → BOTH errors survive, clearly labelled as such.
    const combined = buildSetupFailure(setupError, cleanupError);
    expect(combined).toBeInstanceOf(AggregateError);
    const aggregate = combined as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors).toContain(setupError);
    expect(aggregate.errors).toContain(cleanupError);
    expect(aggregate.message).toMatch(/setup FAILED/);
    expect(aggregate.message).toMatch(/cleanup FAILED/);
    // The message must say outright that BOTH phases failed, so residual
    // processes/ports/database are never mistaken for a clean partial failure.
    expect(aggregate.message).toMatch(/setup FAILED and the subsequent cleanup FAILED/);
  });

  test("H8 the CI artifact upload is gated on the sanitizer's own success, not just failure()", async () => {
    const workflow = await fs.readFile(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");

    const sanitizeStepIndex = workflow.indexOf("Sanitize run evidence on failure");
    expect(sanitizeStepIndex).toBeGreaterThan(-1);
    const uploadStepIndex = workflow.indexOf("Retain sanitized run evidence on failure");
    expect(uploadStepIndex).toBeGreaterThan(sanitizeStepIndex);

    // The sanitizer step carries the stable id its outcome is gated on, and is
    // itself failure-triggered.
    const sanitizeStep = workflow.slice(sanitizeStepIndex, uploadStepIndex);
    expect(sanitizeStep).toMatch(/^\s+id:\s*sanitize_auth006\s*$/m);
    expect(sanitizeStep).toMatch(/^\s+if:\s*failure\(\)\s*$/m);

    // The upload step is DOUBLE-gated: the run must have failed AND the
    // sanitizer must have concluded successfully. A failing sanitizer leaves
    // outcome 'failure' (or 'cancelled') and the upload must be skipped, so no
    // partial or unverified sanitized directory can ever be published.
    const uploadStep = workflow.slice(uploadStepIndex);
    const uploadIf = uploadStep.match(/^\s+if:\s*(.+)$/m);
    expect(uploadIf).not.toBeNull();
    expect(uploadIf![1].trim()).toBe("failure() && steps.sanitize_auth006.outcome == 'success'");
  });

  test("H9 spec-spawned extra children are stopped from durable records after the worker handle is lost", async () => {
    const runDir = resolveRunDirectory();
    const extraDir = path.join(runDir, "extra-children");
    const marker = `auth006-h9-${crypto.randomBytes(8).toString("hex")}`;

    const spawnMarkerChild = (cwd: string) =>
      spawn(process.execPath, ["-e", `setInterval(() => {}, 1000); // ${marker}`], {
        cwd,
        stdio: "ignore"
      });

    const waitForCommandLine = async (child: ChildProcess): Promise<string> => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const command = await processCommandFor(child.pid ?? 0);
        if (command) return command;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("h9 child never became visible in ps");
    };

    const records = async (): Promise<ExtraChildRecord[]> => {
      const names = (await fs.readdir(extraDir)).filter((name) => name.endsWith(".json"));
      const list: ExtraChildRecord[] = [];
      for (const name of names) {
        list.push(JSON.parse(await fs.readFile(path.join(extraDir, name), "utf8")) as ExtraChildRecord);
      }
      return list;
    };

    // (a) Registration itself refuses a cwd outside this run's directory — a
    // record that could authorize signalling a foreign process is never written.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "auth006-h9-out-"));
    let outsideChild: ChildProcess | null = null;
    let foreignRecordPath: string | null = null;
    try {
      outsideChild = spawnMarkerChild(outside);
      await waitForCommandLine(outsideChild);
      await expect(
        registerStackChild("h9 outside-cwd", outsideChild, { pattern: marker, cwd: outside })
      ).rejects.toThrow(/outside this run's directory/);

      // (b) A live child registered from a SPEC worker. The module-local stack
      // handle is null in this worker process — the exact worker-crash
      // condition teardown faces — so ownership lives ONLY in the durable record.
      const liveChild = spawnMarkerChild(runDir);
      await waitForCommandLine(liveChild);
      await registerStackChild("h9 live child", liveChild, { pattern: marker, cwd: runDir });

      // (c) A sibling that exits NORMALLY after registration: its own record
      // flips to exited — without ever clobbering the live sibling's record.
      const exitingChild = spawn(process.execPath, ["-e", `process.exit(0); // ${marker}`], {
        cwd: runDir,
        stdio: "ignore"
      });
      await registerStackChild("h9 exiting child", exitingChild, { pattern: marker, cwd: runDir });
      await new Promise<void>((resolve) => exitingChild.once("exit", () => resolve()));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await records()).find((record) => record.pid === exitingChild.pid)?.exited) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const liveRecord = (await records()).find((record) => record.pid === liveChild.pid);
      expect(liveRecord, "the live child's durable record must exist").toBeDefined();
      expect(liveRecord!.exited).toBe(false);
      expect(liveRecord!.cwd).toBe(runDir);
      expect(liveRecord!.commandPattern).toBe(marker);

      const exitingRecord = (await records()).find((record) => record.pid === exitingChild.pid);
      expect(exitingRecord, "the exited child's record must exist").toBeDefined();
      expect(exitingRecord!.exited).toBe(true);
      expect(exitingRecord!.exitCode).toBe(0);

      // (d) The FRESH recovery path — exactly what a crashed worker forces
      // teardown into — stops the live child from the record alone: command
      // signature AND run-scoped cwd are re-verified against the CURRENT pid
      // before any signal, then the consumed records are removed.
      await recoverExtraChildren();
      expect(await processCommandFor(liveChild.pid ?? 0)).toBeNull();
      const after = await records();
      expect(after.find((record) => record.pid === liveChild.pid)).toBeUndefined();
      expect(after.find((record) => record.pid === exitingChild.pid)).toBeUndefined();

      // (e) A durable record whose cwd points OUTSIDE this run: recovery
      // refuses it loudly and NEVER signals the pid it describes — the foreign
      // process is still alive afterwards.
      const foreignRecord: ExtraChildRecord = {
        id: `h9-foreign-${crypto.randomBytes(4).toString("hex")}`,
        label: "h9 foreign record",
        pid: outsideChild.pid ?? 0,
        commandPattern: marker,
        cwd: outside,
        startedAt: new Date().toISOString(),
        exited: false,
        exitCode: null
      };
      foreignRecordPath = path.join(extraDir, `${foreignRecord.id}.json`);
      await fs.writeFile(foreignRecordPath, JSON.stringify(foreignRecord, null, 2), "utf8");
      await expect(recoverExtraChildren()).rejects.toThrow(/outside this run's directory/);
      expect(await processCommandFor(foreignRecord.pid)).not.toBeNull();
    } finally {
      // The crafted refusal record MUST be removed here: leaving it would make
      // the REAL teardown fail closed on a record no real child ever wrote.
      if (foreignRecordPath) await fs.rm(foreignRecordPath, { force: true }).catch(() => undefined);
      if (outsideChild && outsideChild.exitCode === null) outsideChild.kill("SIGKILL");
      await fs.rm(outside, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
