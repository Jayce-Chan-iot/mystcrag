/**
 * NODE_OPTIONS preload for AUTH-006 Node.js server processes (frontend BFF and backend).
 *
 * The synthetic OIDC issuer is https://synthetic.auth006.internal/ (port 443 by spec),
 * but the provider actually listens on a high loopback port. Non-root processes cannot
 * bind 443, so this preload rewrites the TCP destination of any connect() call that
 * targets <synthetic host>:443 to the real loopback address. TLS verification still
 * runs against the synthetic hostname (SNI/servername is untouched), trusted through
 * NODE_EXTRA_CA_CERTS pointing at the generated provider certificate.
 *
 * Only the synthetic host on port 443 is rewritten; every other connection (including
 * the backend HTTP loopback origin) passes through unchanged.
 *
 * Configuration (read from the process environment at load time):
 *   AUTH006_SYNTHETIC_HOST   — synthetic DNS hostname (default synthetic.auth006.internal)
 *   AUTH006_SYNTHETIC_PORT   — real TLS port of the provider on 127.0.0.1
 */

"use strict";

const host = process.env.AUTH006_SYNTHETIC_HOST || "synthetic.auth006.internal";
const port = Number(process.env.AUTH006_SYNTHETIC_PORT || 0);

if (!Number.isInteger(port) || port <= 0) {
  // Fail loudly rather than silently bypassing the rewrite: without it the server
  // would try to bind 443 on loopback and every provider call would fail.
  throw new Error(
    "AUTH006 node-connect-preload requires AUTH006_SYNTHETIC_PORT to be set to the provider TLS port."
  );
}

const net = require("node:net");
const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function patchedConnect(options) {
  try {
    if (
      options !== null &&
      typeof options === "object" &&
      Number(options.port) === 443 &&
      typeof options.host === "string" &&
      options.host.toLowerCase() === host.toLowerCase()
    ) {
      const rewritten = Object.assign({}, options, { host: "127.0.0.1", port });
      return originalConnect.call(this, rewritten, ...Array.prototype.slice.call(arguments, 1));
    }
  } catch {
    // Any patch failure falls through to the unpatched connect call.
  }
  return originalConnect.apply(this, arguments);
};
