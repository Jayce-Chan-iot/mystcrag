/**
 * Builds a minimal, well-formed TLS 1.2 ClientHello buffer carrying exactly one
 * SNI hostname. Shared by the H3 relay regression and the H6 SNI-parser regression
 * so the parser is tested against bytes a real client could send.
 */

import crypto from "node:crypto";

export function generateClientHelloFor(host: string): Buffer {
  const name = Buffer.from(host, "ascii");
  const serverName = Buffer.concat([
    Buffer.from([0x00, 0x00]), // extension type: server_name
    Buffer.from([0x00, name.length + 5]), // extension length
    Buffer.from([0x00, name.length + 3]), // server_name list length
    Buffer.from([0x00]), // host_name type
    Buffer.from([0x00, name.length]),
    name
  ]);
  const extensions = Buffer.concat([
    serverName,
    Buffer.from([0x00, 0x0d, 0x00, 0x00]) // signature_algorithms (empty)
  ]);
  const body = Buffer.concat([
    Buffer.from([0x03, 0x03]), // client version TLS 1.2
    crypto.randomBytes(32), // random
    Buffer.from([0x00]), // empty session id
    Buffer.from([0x00, 0x02, 0xc0, 0x2f]), // one cipher suite
    Buffer.from([0x01, 0x00]), // null compression
    Buffer.from([0x00, extensions.length]),
    extensions
  ]);
  const handshake = Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from([0x00, body.length >> 8, body.length & 0xff]),
    body
  ]);
  return Buffer.concat([
    Buffer.from([0x16, 0x03, 0x01]),
    Buffer.from([0x00, handshake.length]),
    handshake
  ]);
}
