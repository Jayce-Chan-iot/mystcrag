/**
 * CONNECT-only HTTP proxy relay for the AUTH-006 browser.
 *
 * The synthetic OIDC issuer must be a canonical `https://dns-host/` URL (no port) —
 * the Auth0 SDK rejects domains containing ports, and both issuer validators only
 * accept canonical HTTPS hostnames. Non-root processes cannot bind port 443, so the
 * provider's TLS listener lives on a high port and traffic to `synthetic.host:443`
 * is remapped:
 *
 *   - Node (BFF/backend): fixtures/node-connect-preload.cjs rewrites net.connect.
 *   - Browser: Chromium cannot remap ports via --host-resolver-rules, so Playwright
 *     launches the browser with a context proxy pointing at this relay. The relay
 *     answers `CONNECT synthetic.auth006.internal:443` with a raw TCP pipe to the
 *     provider TLS port — TLS stays end-to-end (SNI/cert validation untouched).
 *
 * The relay intentionally understands ONLY CONNECT. Any plain-HTTP proxied request is
 * destroyed (fail closed); the bypass list keeps all app traffic off the relay.
 */

import net from "node:net";

export type BrowserRelay = {
  port: number;
  stop(): Promise<void>;
};

export async function startBrowserRelay(options: {
  port: number;
  upstreamHost: string;
  upstreamPort: number;
}): Promise<BrowserRelay> {
  const server = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      const head = chunk.toString("latin1");
      const requestLine = head.split("\r\n", 1)[0] ?? "";
      const match = /^CONNECT (\S+):(\d+) HTTP\/1\.[01]$/.exec(requestLine);
      if (!match) {
        socket.destroy();
        return;
      }
      const upstream = net.connect(
        { host: options.upstreamHost, port: options.upstreamPort },
        () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          const bodyStart = head.indexOf("\r\n\r\n") + 4;
          if (chunk.length > bodyStart) upstream.write(chunk.subarray(bodyStart));
          socket.pipe(upstream);
          upstream.pipe(socket);
        }
      );
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());
      upstream.on("close", () => socket.destroy());
    });
    socket.on("error", () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  });

  return {
    port: options.port,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      })
  };
}
