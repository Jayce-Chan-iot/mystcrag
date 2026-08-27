/**
 * Playwright trace ZIP redaction for AUTH-006.
 *
 * `trace: "retain-on-failure"` archives every header the browser exchanged —
 * including the HttpOnly session cookie, the SDK transaction cookies (which carry
 * the authorization code / PKCE verifier material) and any authorization header.
 * Those archives are the suite's primary failure evidence, so they are retained —
 * but never with credential material inside.
 *
 * This module rewrites every retained `trace.zip` in place:
 *   - parses the central directory (sizes are authoritative there, never in the
 *     local headers, which Playwright writes with data descriptors),
 *   - inflates each entry, replaces the values of cookie / set-cookie /
 *     authorization headers in the JSON event streams with `[REDACTED-AUTH006]`,
 *   - rebuilds the archive with STORE entries (no compression, correct CRC-32).
 *
 * Scope decision: only credential-bearing HEADER values are redacted. Response
 * bodies the browser legitimately received (e.g. the public /auth/session
 * projection) stay intact — they are product-approved browser-visible data, not
 * harness-written secret material.
 *
 * No zip dependency is added: the harness must stay dependency-free, and the
 * rewrite is self-verifying — the caller re-extracts every entry afterwards and
 * fails the run if any sensitive header value survives.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIR_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntry = {
  name: string;
  data: Buffer;
};

export function parseZip(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  const scanFloor = Math.max(0, buffer.length - 22 - 65536);
  for (let i = buffer.length - 22; i >= scanFloor; i -= 1) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("trace redaction: end-of-central-directory signature not found");
  }

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const entries: ZipEntry[] = [];
  let cursor = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIR_HEADER) {
      throw new Error(`trace redaction: central directory entry ${i} is malformed`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`trace redaction: local header missing for entry ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);

    entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags: no data descriptor
    local.writeUInt16LE(0, 8); // method: STORE
    local.writeUInt16LE(0, 10); // dos time
    local.writeUInt16LE(0x2100, 12); // dos date (2000-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuffer, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_DIR_HEADER, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); // method: STORE
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x2100, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralDirectory.push(central, nameBuffer);

    offset += 30 + nameBuffer.length + entry.data.length;
  }

  const centralBuffer = Buffer.concat(centralDirectory);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(END_OF_CENTRAL_DIR, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralBuffer, eocd]);
}

/** Matches `{"name":"<sensitive>","value":"..."}` header pairs in trace JSON streams. */
const SENSITIVE_HEADER_PAIR =
  /("name"\s*:\s*"(?:cookie|set-cookie|authorization)"\s*,\s*"value"\s*:\s*")([^"]*)(")/gi;

/**
 * Matches the header dumps Playwright's API-request logging writes as log events,
 * e.g. `{"type":"log",...,"message":"  cookie: mystcrag_session=..."}` — the header
 * name sits at the start of the message value, not at a line boundary.
 */
const SENSITIVE_HEADER_MESSAGE =
  /("message"\s*:\s*"[ \t]*(?:cookie|set-cookie|authorization)[ \t]*:[ \t]*)([^"]*)(")/gi;

/**
 * Matches the HAR-style `cookies` arrays trace network files record per request and
 * response, e.g. `{"name":"mystcrag_session","value":"eyJ..."}`. The session cookie
 * value is the credential; the name is public and stays for debuggability.
 */
const SENSITIVE_COOKIE_ENTRY =
  /("name"\s*:\s*"mystcrag_session"\s*,\s*"value"\s*:\s*")([^"]*)(")/gi;

/**
 * Matches SDK transaction cookies in the same `cookies` arrays. BOTH halves are
 * credential material: the name embeds the OIDC state nonce and the value is the
 * encrypted transaction carrying the authorization code and PKCE verifier.
 */
const SENSITIVE_TXN_COOKIE_ENTRY =
  /("name"\s*:\s*")(__txn_[^"]*)("\s*,\s*"value"\s*:\s*")([^"]*)(")/gi;

/**
 * Matches credential-bearing query parameters in recorded URLs — most importantly
 * `/auth/callback?code=...&state=...`, where the browser URL itself carries the
 * authorization code. Provider authorize redirects also carry `state` / `nonce`.
 */
const SENSITIVE_URL_QUERY =
  /([?&](?:code|state|nonce|id_token|access_token|refresh_token|token)=)([^&"\s\\]*)/gi;

const REDACTED_VALUE = "[REDACTED-AUTH006]";

function redactText(content: string): string {
  return content
    .replace(SENSITIVE_HEADER_PAIR, (_match, prefix: string, _value: string, suffix: string) =>
      `${prefix}${REDACTED_VALUE}${suffix}`
    )
    .replace(SENSITIVE_HEADER_MESSAGE, (_match, prefix: string, _value: string, suffix: string) =>
      `${prefix}${REDACTED_VALUE}${suffix}`
    )
    .replace(SENSITIVE_COOKIE_ENTRY, (_match, prefix: string, _value: string, suffix: string) =>
      `${prefix}${REDACTED_VALUE}${suffix}`
    )
    .replace(
      SENSITIVE_TXN_COOKIE_ENTRY,
      (_match, namePrefix: string, _name: string, middle: string, _value: string, suffix: string) =>
        `${namePrefix}__txn_${REDACTED_VALUE}${middle}${REDACTED_VALUE}${suffix}`
    )
    .replace(SENSITIVE_URL_QUERY, (_match, prefix: string, _value: string) =>
      `${prefix}${REDACTED_VALUE}`
    );
}

function isRedactableText(name: string): boolean {
  return /\.(?:trace|network|har|json|txt|md|stacks)$/i.test(name) || !path.extname(name);
}

export type RedactionResult = {
  archives: number;
  redactedHeaderValues: number;
};

function countSensitiveHeaders(content: string): number {
  const counts = [
    SENSITIVE_HEADER_PAIR,
    SENSITIVE_HEADER_MESSAGE,
    SENSITIVE_COOKIE_ENTRY,
    SENSITIVE_TXN_COOKIE_ENTRY,
    SENSITIVE_URL_QUERY
  ].map((regex) => {
    const matches = content.match(regex);
    return matches ? matches.length : 0;
  });
  return counts.reduce((sum, count) => sum + count, 0);
}

/**
 * Rewrites every `trace.zip` under `root` with sensitive header values redacted and
 * returns how many archives and header values were processed. Throws when an archive
 * cannot be parsed — a corrupt redaction must fail loudly, never silently pass.
 */
export async function redactTraceArchives(root: string): Promise<RedactionResult> {
  const archives = await collectTraceArchives(root);
  let redactedHeaderValues = 0;

  for (const archive of archives) {
    const buffer = await fs.readFile(archive);
    const entries = parseZip(buffer);
    for (const entry of entries) {
      if (!isRedactableText(entry.name)) continue;
      const text = entry.data.toString("utf8");
      if (!text) continue;
      redactedHeaderValues += countSensitiveHeaders(text);
      entry.data = Buffer.from(redactText(text), "utf8");
    }
    await fs.writeFile(archive, buildZip(entries));
  }

  return { archives: archives.length, redactedHeaderValues };
}

async function collectTraceArchives(root: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectTraceArchives(target)));
    } else if (entry.isFile() && entry.name === "trace.zip") {
      found.push(target);
    }
  }
  return found;
}

/**
 * Verification half of the redaction contract: extracts every trace archive under
 * `root` and returns the decoded text of every entry, so the caller can assert that
 * no credential material survived. Also proves the rewritten archive is still a
 * structurally valid zip.
 */
export async function extractTraceTexts(root: string): Promise<Array<{ archive: string; name: string; text: string }>> {
  const texts: Array<{ archive: string; name: string; text: string }> = [];
  for (const archive of await collectTraceArchives(root)) {
    const entries = parseZip(await fs.readFile(archive));
    for (const entry of entries) {
      if (!isRedactableText(entry.name)) continue;
      const text = entry.data.toString("utf8");
      if (text) {
        texts.push({ archive: path.relative(root, archive), name: entry.name, text });
      }
    }
  }
  return texts;
}
