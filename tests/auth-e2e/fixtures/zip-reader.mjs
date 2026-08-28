/**
 * Minimal ZIP reader shared by the trace redactor (Playwright runtime, .mts) and the
 * CI evidence sanitizer (plain Node, .mjs). Lives as .mjs so both runtimes can load
 * it without any dependency.
 *
 * Parses the central directory (sizes are authoritative there, never in the local
 * headers, which Playwright writes with data descriptors) and inflates every entry.
 */

import { inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIR_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;

export function parseZip(buffer) {
  let eocd = -1;
  const scanFloor = Math.max(0, buffer.length - 22 - 65536);
  for (let i = buffer.length - 22; i >= scanFloor; i -= 1) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("zip reader: end-of-central-directory signature not found");
  }

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const entries = [];
  let cursor = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIR_HEADER) {
      throw new Error(`zip reader: central directory entry ${i} is malformed`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`zip reader: local header missing for entry ${name}`);
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
