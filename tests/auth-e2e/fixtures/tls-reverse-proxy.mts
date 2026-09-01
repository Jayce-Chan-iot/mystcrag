/**
 * TLS reverse proxy for the AUTH-006 production topology (scenario I).
 *
 * The production configuration validator only accepts HTTPS non-loopback origins, so
 * the production proof needs real TLS endpoints on synthetic DNS hostnames:
 *
 *   browser ──HTTPS──▶ app.mystcrag.auth006.internal:<appTls> ──HTTP──▶ next start (NODE_ENV=production)
 *   BFF ─────HTTPS──▶ api.mystcrag.auth006.internal:<apiTls> ──HTTP──▶ backend
 *
 * This module terminates TLS with the run's multi-SAN certificate and forwards every
 * request — method, path, query, headers, and the exact request body bytes — to the
 * plain-HTTP upstream on loopback. It adds nothing, rewrites nothing, and caches
 * nothing: the application under test sees an unmodified request, and the browser/BFF
 * see a valid HTTPS origin whose certificate matches the synthetic DNS hostname.
 *
 * Non-goals (would weaken the proof): no WebSocket upgrade, no keep-alive pooling, no
 * header mangling. Plain request/response forwarding only.
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";

export type TlsReverseProxy = {
  port: number;
  stop(): Promise<void>;
};

export async function startTlsReverseProxy(options: {
  port: number;
  upstreamPort: number;
  tlsKey: string;
  tlsCert: string;
}): Promise<TlsReverseProxy> {
  const [key, cert] = await Promise.all([fs.readFile(options.tlsKey), fs.readFile(options.tlsCert)]);

  const server = https.createServer({ key, cert }, (request, response) => {
    const headers = { ...request.headers };
    delete headers.connection;
    delete headers["keep-alive"];
    delete headers["proxy-connection"];
    delete headers["transfer-encoding"];

    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: options.upstreamPort,
        method: request.method,
        path: request.url,
        headers
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      }
    );
    upstream.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "application/json" });
      }
      response.end(JSON.stringify({ error: "upstream_unavailable" }));
    });
    request.pipe(upstream);
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
