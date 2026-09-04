import assert from "node:assert/strict";
import test from "node:test";

import { detectAssetSourceKind } from "../src/content-type.js";

/**
 * Minimal synthetic Sony ARW fixture: a structurally valid TIFF container
 * whose IFD0 carries a Make tag with the ASCII value "SONY". No real camera
 * files are ever committed.
 */
function buildTiff(
  options: {
    littleEndian?: boolean;
    make?: string | null;
    corruptMagic?: boolean;
    ifdOffsetOverride?: number;
    entryCountOverride?: number;
    valueOffsetOverride?: number;
    truncateAt?: number;
  } = {}
): Buffer {
  const littleEndian = options.littleEndian ?? true;
  const make = options.make === undefined ? "SONY" : options.make;
  const entryCount = 1;
  const ifdOffset = 8;
  const ifdSize = 2 + entryCount * 12 + 4;
  const valueAreaStart = ifdOffset + ifdSize;

  const makeBytes = make === null ? null : Buffer.from(`${make}\0`, "latin1");
  const inline = makeBytes !== null && makeBytes.length <= 4;
  const totalLength = valueAreaStart + (inline || makeBytes === null ? 0 : makeBytes.length);

  const buffer = Buffer.alloc(totalLength);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  buffer.write(littleEndian ? "II" : "MM", 0, "latin1");
  view.setUint16(2, options.corruptMagic ? 43 : 42, littleEndian);
  view.setUint32(4, options.ifdOffsetOverride ?? ifdOffset, littleEndian);
  view.setUint16(ifdOffset, options.entryCountOverride ?? entryCount, littleEndian);

  const entryAt = ifdOffset + 2;
  if (makeBytes === null) {
    // A structurally valid TIFF without any Make entry (e.g. a plain TIFF).
    view.setUint16(entryAt, 0x8769, littleEndian); // ExifIFD pointer tag
    view.setUint16(entryAt + 2, 4, littleEndian); // LONG
    view.setUint32(entryAt + 4, 1, littleEndian);
    view.setUint32(entryAt + 8, 0, littleEndian); // inline value
  } else {
    view.setUint16(entryAt, 0x010f, littleEndian); // Make
    view.setUint16(entryAt + 2, 2, littleEndian); // ASCII
    view.setUint32(entryAt + 4, makeBytes.length, littleEndian);
    if (inline) {
      makeBytes.copy(buffer, entryAt + 8);
    } else {
      view.setUint32(entryAt + 8, options.valueOffsetOverride ?? valueAreaStart, littleEndian);
      makeBytes.copy(buffer, valueAreaStart);
    }
  }
  view.setUint32(ifdOffset + 2 + entryCount * 12, 0, littleEndian); // next IFD

  const truncated = options.truncateAt === undefined ? buffer : buffer.subarray(0, options.truncateAt);
  return Buffer.from(truncated);
}

test("detects JPEG from magic bytes regardless of extension", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(detectAssetSourceKind(jpeg), "JPEG");
});

test("detects PNG magic bytes", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  assert.equal(detectAssetSourceKind(png), "PNG");
});

test("detects WebP from RIFF container", () => {
  const webp = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38
  ]);
  assert.equal(detectAssetSourceKind(webp), "WEBP");
});

test("detects a minimal synthetic little-endian Sony ARW by structure and Make", () => {
  assert.equal(detectAssetSourceKind(buildTiff({ littleEndian: true })), "ARW");
});

test("detects a minimal synthetic big-endian Sony ARW", () => {
  assert.equal(detectAssetSourceKind(buildTiff({ littleEndian: false })), "ARW");
});

test("a bare TIFF header without a valid IFD is not an ARW", () => {
  const bareHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  assert.equal(detectAssetSourceKind(bareHeader), null);
  const bareBigEndian = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
  assert.equal(detectAssetSourceKind(bareBigEndian), null);
});

test("a plain TIFF from another vendor is not an ARW", () => {
  assert.equal(detectAssetSourceKind(buildTiff({ make: "CANON" })), null);
});

test("a structurally valid TIFF without a Make entry is not an ARW", () => {
  assert.equal(detectAssetSourceKind(buildTiff({ make: null })), null);
});

test("truncated and structurally broken TIFF payloads are rejected", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ ifdOffsetOverride: 1_000 })),
    null,
    "IFD offset beyond the file is rejected"
  );
  assert.equal(
    detectAssetSourceKind(buildTiff({ entryCountOverride: 200 })),
    null,
    "an entry count larger than the file is rejected"
  );
  assert.equal(
    detectAssetSourceKind(buildTiff({ valueOffsetOverride: 1_000 })),
    null,
    "a Make value offset beyond the file is rejected"
  );
  assert.equal(
    detectAssetSourceKind(buildTiff({ truncateAt: 12 })),
    null,
    "a truncated IFD is rejected"
  );
  assert.equal(detectAssetSourceKind(buildTiff({ corruptMagic: true })), null, "magic 43 is rejected");
});

test("returns null for unknown magic bytes even with a familiar extension", () => {
  const text = Buffer.from("not an image at all, just text pretending to be DSC01234.JPG");
  assert.equal(detectAssetSourceKind(text), null);
});

test("returns null for truncated buffers", () => {
  assert.equal(detectAssetSourceKind(new Uint8Array(0)), null);
  assert.equal(detectAssetSourceKind(Buffer.from([0xff, 0xd8])), null);
  assert.equal(detectAssetSourceKind(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00])), null);
});

test("never inspects anything beyond the header", () => {
  const jpegWithPngTail = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ]);
  assert.equal(detectAssetSourceKind(jpegWithPngTail), "JPEG");
});
