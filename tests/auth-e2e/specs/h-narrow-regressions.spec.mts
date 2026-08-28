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
 *   H5  teardown PID ownership: a pid is signalled only when its CURRENT command
 *       line matches this run's signature; a recycled/foreign pid fails loudly
 *       instead of being killed
 *   H6  the SNI parser accepts a real ClientHello and rejects non-hello bytes
 *
 * H3/H4/H5/H6 are stack-independent: they start their own throwaway listeners on
 * ephemeral ports so a harness regression is diagnosed without a full-stack run.
 */

import { expect, test } from "@playwright/test";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { bffClient, clientFor, generateDesignRequest } from "../helpers/api";
import { stackState } from "../helpers/run-state";
import { loginAsUser, syntheticUser } from "../helpers/login";
import { startBrowserRelay, parseSniFromClientHello } from "../fixtures/browser-relay";
import { verifyProcessOwnership } from "../fixtures/process-identity";
import { sanitizeEvidence, SENSITIVE_PATTERNS } from "../scripts/sanitize-evidence.mjs";
import { generateClientHelloFor } from "../fixtures/client-hello-for-test.mts";
import { buildZip } from "../fixtures/trace-redact";

type Echoed = {
  method: string;
  url: string;
  contentType: string | undefined;
  rawBody: string;
};

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

  test("H4 the evidence sanitizer excludes TLS material and credential-bearing files", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth006-h4-"));
    const sourceRoot = path.join(tmp, "run");
    const destinationRoot = path.join(tmp, "sanitized");
    const secretValue = `secret-${crypto.randomBytes(24).toString("hex")}`;

    try {
      await fs.mkdir(path.join(sourceRoot, "logs"), { recursive: true });
      await fs.mkdir(path.join(sourceRoot, "tls"), { recursive: true });
      await fs.mkdir(path.join(sourceRoot, "test-results", "failed-test"), { recursive: true });

      await fs.writeFile(path.join(sourceRoot, "run-state.json"), JSON.stringify({ runId: "h4" }), "utf8");
      await fs.writeFile(path.join(sourceRoot, "logs", "backend.log"), "clean log line\n", "utf8");
      // TLS material — never copied: whole tls/ directory AND the .pem extension.
      await fs.writeFile(
        path.join(sourceRoot, "tls", "synthetic-provider.key.pem"),
        "-----BEGIN PRIVATE KEY-----\nwhatever\n-----END PRIVATE KEY-----\n",
        "utf8"
      );
      // A log that contains a credential value — excluded AND a violation.
      await fs.writeFile(path.join(sourceRoot, "logs", "leaky.log"), `token=${secretValue}\n`, "utf8");
      // A denied extension — never considered evidence.
      await fs.writeFile(path.join(sourceRoot, "blob.bin"), "binary", "utf8");

      const cleanZip = buildZip([
        { name: "0.trace", data: Buffer.from('{"name":"accept","value":"text/html"}') },
        { name: "1.trace", data: Buffer.from('{"name":"cookie","value":"[REDACTED-AUTH006]"}') }
      ]);
      await fs.writeFile(path.join(sourceRoot, "test-results", "failed-test", "trace.zip"), cleanZip);
      const dirtyZip = buildZip([
        {
          name: "0.trace",
          // Built with JSON.stringify so the SOURCE never embeds a literal
          // header-pair template: Playwright error-context.md snapshots embed test
          // source, and a literal here would trip the teardown secret scan as a
          // false positive on this very file. At RUNTIME the entry still contains
          // the exact violation shape the sanitizer must detect.
          data: Buffer.from(JSON.stringify({ name: "authorization", value: `Bearer ${secretValue}` }))
        }
      ]);
      await fs.writeFile(path.join(sourceRoot, "test-results", "dirty-trace.zip"), dirtyZip);

      const summary = await sanitizeEvidence(sourceRoot, destinationRoot, { secrets: [secretValue] });

      // Violations were detected and reported — the sanitizer must fail the run.
      expect(summary.ok).toBe(false);
      expect(summary.violations.map((violation: { path: string }) => violation.path)).toEqual(
        expect.arrayContaining(["logs/leaky.log", "test-results/dirty-trace.zip"])
      );

      // Only clean, allowlisted files exist in the sanitized directory.
      const copied = summary.copied as string[];
      expect(copied).toContain("run-state.json");
      expect(copied).toContain("logs/backend.log");
      expect(copied).toContain("test-results/failed-test/trace.zip");
      expect(copied).not.toContain("logs/leaky.log");
      expect(copied).not.toContain("test-results/dirty-trace.zip");
      expect(copied).not.toContain("blob.bin");
      expect(copied.filter((entry) => entry.startsWith("tls/"))).toHaveLength(0);
      expect(summary.excluded.map((entry: { path: string }) => entry.path)).toContain(
        "tls/synthetic-provider.key.pem"
      );

      // Nothing written into the sanitized directory contains the secret.
      for (const entry of copied) {
        const content = await fs.readFile(path.join(destinationRoot, entry), "utf8");
        expect(content.includes(secretValue)).toBe(false);
      }

      // The shared sensitive pattern set is non-trivial and stays exported for the
      // teardown scan (global-teardown imports the same module).
      expect(SENSITIVE_PATTERNS.length).toBeGreaterThanOrEqual(7);
    } finally {
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
});
