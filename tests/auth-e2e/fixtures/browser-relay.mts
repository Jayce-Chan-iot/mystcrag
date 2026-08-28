/**
 * CONNECT-only HTTP proxy relay for the AUTH-006 browser — STRICT allowlist.
 *
 * The synthetic OIDC issuer must be a canonical `https://dns-host/` URL (no port) —
 * the Auth0 SDK rejects domains containing ports, and both issuer validators only
 * accept canonical HTTPS hostnames. Non-root processes cannot bind port 443, so the
 * provider's TLS listener lives on a high port and traffic to
 * `synthetic.auth006.internal:443` is remapped:
 *
 *   - Node (BFF/backend): fixtures/node-connect-preload.cjs rewrites net.connect.
 *   - Browser: Chromium cannot remap ports via --host-resolver-rules, so Playwright
 *     launches the browser with a context proxy pointing at this relay. The relay
 *     answers `CONNECT synthetic.auth006.internal:443` with a raw TCP pipe to the
 *     provider TLS port — TLS stays end-to-end (SNI/cert validation untouched).
 *
 * Security contract (regression-tested by H3):
 *   - ONLY the exact allowlisted host:port tuples are tunneled. Any other CONNECT
 *     target (different host OR different port) is refused with 403 and closed —
 *     the relay must never become an open proxy that hides where traffic went, so a
 *     misconfigured/attacker issuer FAILS VISIBLY instead of being silently piped to
 *     the synthetic provider.
 *   - The first tunneled bytes must be a TLS ClientHello whose SNI equals the
 *     CONNECT host. A plaintext request or a ClientHello naming a different host
 *     destroys the tunnel — no application byte ever flows on a mismatch.
 *   - Every decision is counted (allowed / refused / sni-refused, per host) and the
 *     counters are published through the provider admin plane, so specs can assert
 *     the provider really received the relayed requests and that refusals happened.
 */

import net from "node:net";

/** One allowlisted CONNECT target: exact host, exact port, and its upstream port. */
export type RelayTarget = {
  host: string;
  port: number;
  upstreamPort: number;
};

export type RelayStats = {
  allowed: number;
  refused: number;
  sniRefused: number;
  byHost: Record<string, number>;
  refusedTargets: Array<{ host: string; port: number }>;
};

export type BrowserRelay = {
  port: number;
  stop(): Promise<void>;
  stats(): Readonly<RelayStats>;
};

/**
 * Parses the SNI hostname out of a TLS ClientHello record buffer, or returns null
 * when the bytes are not a parseable ClientHello.
 */
export function parseSniFromClientHello(buffer: Buffer): string | null {
  // TLS record header: type(1) version(2) length(2); must be a handshake record.
  if (buffer.length < 5 || buffer[0] !== 0x16) return null;
  const recordLength = buffer.readUInt16BE(3);
  if (buffer.length < 5 + recordLength) return null;
  let cursor = 5;
  // Handshake header: type(1) length(3); must be ClientHello (1).
  if (buffer[cursor] !== 0x01) return null;
  cursor += 4;
  // ClientHello body: version(2) random(32) session_id(1..32) cipher_suites(2..)
  cursor += 2 + 32;
  if (cursor >= buffer.length) return null;
  const sessionIdLength = buffer[cursor];
  cursor += 1 + sessionIdLength;
  if (cursor + 2 > buffer.length) return null;
  const cipherSuitesLength = buffer.readUInt16BE(cursor);
  cursor += 2 + cipherSuitesLength;
  if (cursor >= buffer.length) return null;
  const compressionLength = buffer[cursor];
  cursor += 1 + compressionLength;
  if (cursor + 2 > buffer.length) return null;
  const extensionsLength = buffer.readUInt16BE(cursor);
  cursor += 2;
  const extensionsEnd = Math.min(cursor + extensionsLength, buffer.length);
  while (cursor + 4 <= extensionsEnd) {
    const extensionType = buffer.readUInt16BE(cursor);
    const extensionLength = buffer.readUInt16BE(cursor + 2);
    const extensionStart = cursor + 4;
    if (extensionType === 0x0000) {
      // server_name extension: list_length(2) name_type(1) name_length(2) name
      if (extensionStart + 5 > buffer.length) return null;
      const nameLength = buffer.readUInt16BE(extensionStart + 3);
      const nameStart = extensionStart + 5;
      if (nameStart + nameLength > buffer.length) return null;
      return buffer.toString("ascii", nameStart, nameStart + nameLength);
    }
    cursor = extensionStart + extensionLength;
  }
  return null;
}

export async function startBrowserRelay(options: {
  port: number;
  /** The only CONNECT targets the relay will tunnel; everything else is refused. */
  allowlist: RelayTarget[];
}): Promise<BrowserRelay> {
  const targets = new Map<string, RelayTarget>();
  for (const target of options.allowlist) {
    targets.set(`${target.host.toLowerCase()}:${target.port}`, target);
  }

  const stats: RelayStats = {
    allowed: 0,
    refused: 0,
    sniRefused: 0,
    byHost: {},
    refusedTargets: []
  };

  const server = net.createServer((socket) => {
    // The CONNECT request head must be FULLY buffered before parsing: TCP
    // segmentation can split the head itself, and a head without its terminating
    // CRLF CRLF would otherwise be misread as "head plus pipelined tunnel bytes",
    // feeding request-line fragments to the ClientHello gate and destroying a
    // legitimate tunnel. The first \r\n\r\n in the stream is always the head
    // separator — the client cannot send tunnel bytes before the head ends.
    let headerBuffer: Buffer | null = Buffer.alloc(0);
    const readHead = (chunk: Buffer) => {
      if (headerBuffer === null) return;
      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      const separator = headerBuffer.indexOf("\r\n\r\n");
      if (separator === -1) {
        if (headerBuffer.length > 8192) {
          headerBuffer = null;
          socket.end("HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\n\r\n");
          return;
        }
        socket.once("data", readHead);
        return;
      }
      const head = headerBuffer.subarray(0, separator).toString("latin1");
      const tail = headerBuffer.subarray(separator + 4);
      headerBuffer = null;
      handleHead(head, tail.length > 0 ? tail : null);
    };
    const handleHead = (head: string, pipelined: Buffer | null) => {
      const requestLine = head.split("\r\n", 1)[0] ?? "";
      const match = /^CONNECT (\S+):(\d+) HTTP\/1\.[01]$/.exec(requestLine);
      if (!match) {
        // Plain-HTTP proxying is never offered; fail closed.
        socket.end("HTTP/1.1 405 Method Not Allowed\r\ncontent-length: 0\r\n\r\n");
        return;
      }
      const connectHost = match[1];
      const connectPort = Number(match[2]);
      const target = targets.get(`${connectHost.toLowerCase()}:${connectPort}`);
      if (!target) {
        stats.refused += 1;
        stats.refusedTargets.push({ host: connectHost, port: connectPort });
        socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n");
        return;
      }

      // The socket is already flowing (readHead). A client that pipelines tunnel
      // bytes right behind the CONNECT head (as H3 does, and as any non-compliant
      // or racing client may) can deliver them BEFORE the upstream connection
      // completes — with no "data" listener registered yet, flowing mode would
      // discard those bytes silently. Pausing here parks them in the socket's
      // internal buffer; resume() below re-emits them once the SNI gate is armed,
      // so no byte is ever lost in the head→gate gap.
      socket.pause();
      const upstream = net.connect({ host: "127.0.0.1", port: target.upstreamPort });
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());

      upstream.on("connect", () => {
        const hostKey = target.host.toLowerCase();
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

        // The first tunneled bytes must be a COMPLETE TLS ClientHello record whose
        // SNI equals the CONNECT host. TCP segmentation can split the CONNECT
        // head, the record header, and the record body across chunks — the
        // parser must never see a partial record (a truncated ClientHello parses
        // as "not a hello" and would destroy a perfectly legitimate tunnel), so
        // bytes are buffered until the 5-byte record header declares the record
        // fully present. Plaintext (non-handshake) first bytes are refused at once.
        const refuseSni = () => {
          stats.sniRefused += 1;
          socket.destroy();
          upstream.destroy();
        };
        const establish = (buffered: Buffer) => {
          upstream.write(buffered);
          socket.pipe(upstream);
          upstream.pipe(socket);
          upstream.on("close", () => socket.destroy());
        };
        const beginTunnel = (first: Buffer) => {
          let buffered = first;
          const attempt = (chunk: Buffer) => {
            buffered = Buffer.concat([buffered, chunk]);
            consume();
          };
          const consume = () => {
            if (buffered.length < 5) {
              socket.once("data", attempt);
              return;
            }
            if (buffered[0] !== 0x16) {
              refuseSni();
              return;
            }
            const recordLength = buffered.readUInt16BE(3);
            if (buffered.length < 5 + recordLength) {
              socket.once("data", attempt);
              return;
            }
            const sni = parseSniFromClientHello(buffered);
            if (sni === null || sni.toLowerCase() !== hostKey) {
              refuseSni();
              return;
            }
            // Counted only AFTER the SNI check passes: "allowed" must mean the exact
            // host:port AND a matching SNI were both accepted — an SNI-refused
            // connection is never reported as allowed traffic.
            stats.allowed += 1;
            stats.byHost[hostKey] = (stats.byHost[hostKey] ?? 0) + 1;
            establish(buffered);
          };
          consume();
        };

        if (pipelined && pipelined.length > 0) {
          beginTunnel(pipelined);
        } else {
          socket.once("data", beginTunnel);
        }
        // Flow resumes only after the gate is armed (or pipe() owns the stream):
        // every byte parked by pause() above is re-emitted to the armed listener,
        // never dropped. refusals already destroyed the socket, where resume is a
        // harmless no-op.
        socket.resume();
      });
    };
    socket.once("data", readHead);
    socket.on("error", () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("browser relay did not return a bound port");
  }

  return {
    port: address.port,
    stats: () => JSON.parse(JSON.stringify(stats)) as RelayStats,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      })
  };
}
