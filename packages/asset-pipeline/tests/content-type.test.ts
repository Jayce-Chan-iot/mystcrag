import assert from "node:assert/strict";
import test from "node:test";

import { detectAssetSourceKind } from "../src/content-type.js";

/**
 * Minimal synthetic Sony ARW fixture: a structurally valid TIFF container
 * whose IFD0 carries an ASCII Make tag "SONY" plus RAW-specific evidence.
 * Evidence may live in IFD0 (Sony RAW compression 32767, CFA photometric
 * 32803) or inside a SubIFD pointed to by the SubIFDs tag — real ARWs keep
 * their sensor strips in SubIFDs, so both placements are exercised.
 * `subIfdEmpty`/`subIfdRgb`/`none` build ordinary SONY TIFFs (empty SubIFD,
 * RGB SubIFD, plain RGB IFD0) that must NOT qualify. No real camera files
 * are ever committed.
 */
type RawEvidence =
  | "ifdCompression"
  | "ifdCfa"
  | "subIfdCfa"
  | "subIfdCompression"
  | "subIfdRgb"
  | "subIfdEmpty"
  | "none";

function encodeShort(value: number, littleEndian: boolean): Buffer {
  const buffer = Buffer.alloc(2);
  new DataView(buffer.buffer).setUint16(0, value, littleEndian);
  return buffer;
}

function encodeLong(value: number, littleEndian: boolean): Buffer {
  const buffer = Buffer.alloc(4);
  new DataView(buffer.buffer).setUint32(0, value, littleEndian);
  return buffer;
}

function buildTiff(
  options: {
    littleEndian?: boolean;
    make?: string | null;
    rawEvidence?: RawEvidence;
    corruptMagic?: boolean;
    ifdOffsetOverride?: number;
    entryCountOverride?: number;
    valueOffsetOverride?: number;
    subIfdOffsetOverride?: number;
    truncateAt?: number;
  } = {}
): Buffer {
  const littleEndian = options.littleEndian ?? true;
  const make = options.make === undefined ? "SONY" : options.make;
  const rawEvidence = options.rawEvidence ?? "subIfdCfa";
  const ifdOffset = 8;
  const entryCount = 2;
  const makeValueOffset = 38;
  const subIfdOffset = 43;
  const subIfdLength = rawEvidence === "subIfdEmpty" ? 6 : rawEvidence.startsWith("subIfd") ? 18 : 0;

  const makeBytes = make === null ? null : Buffer.from(`${make}\0`, "latin1");
  const makeInline = makeBytes !== null && makeBytes.length <= 4;

  type Entry = { tag: number; type: number; count: number; inline?: Buffer; offset?: number };
  const entries: Entry[] = [];

  if (makeBytes !== null) {
    entries.push(
      makeInline
        ? { tag: 0x010f, type: 2, count: makeBytes.length, inline: makeBytes }
        : { tag: 0x010f, type: 2, count: makeBytes.length, offset: options.valueOffsetOverride ?? makeValueOffset }
    );
  } else {
    // A structurally valid TIFF without any Make entry (e.g. a plain TIFF).
    entries.push({ tag: 0x8769, type: 4, count: 1, inline: encodeLong(0, littleEndian) }); // ExifIFD pointer
  }

  if (rawEvidence === "ifdCompression") {
    entries.push({ tag: 0x0103, type: 3, count: 1, inline: encodeShort(32767, littleEndian) });
  } else if (rawEvidence === "ifdCfa" || rawEvidence === "none") {
    entries.push({
      tag: 0x0106,
      type: 3,
      count: 1,
      inline: encodeShort(rawEvidence === "ifdCfa" ? 32803 : 2, littleEndian)
    });
  } else if (rawEvidence.startsWith("subIfd")) {
    entries.push({ tag: 0x014a, type: 4, count: 1, offset: options.subIfdOffsetOverride ?? subIfdOffset });
  }
  entries.sort((left, right) => left.tag - right.tag);

  const buffer = Buffer.alloc(subIfdOffset + subIfdLength);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  buffer.write(littleEndian ? "II" : "MM", 0, "latin1");
  view.setUint16(2, options.corruptMagic ? 43 : 42, littleEndian);
  view.setUint32(4, options.ifdOffsetOverride ?? ifdOffset, littleEndian);
  view.setUint16(ifdOffset, options.entryCountOverride ?? entryCount, littleEndian);

  entries.forEach((entry, index) => {
    const entryAt = ifdOffset + 2 + index * 12;
    view.setUint16(entryAt, entry.tag, littleEndian);
    view.setUint16(entryAt + 2, entry.type, littleEndian);
    view.setUint32(entryAt + 4, entry.count, littleEndian);
    if (entry.inline !== undefined) {
      entry.inline.copy(buffer, entryAt + 8);
    } else {
      view.setUint32(entryAt + 8, entry.offset ?? 0, littleEndian);
    }
  });
  view.setUint32(ifdOffset + 2 + entryCount * 12, 0, littleEndian); // no next IFD

  if (makeBytes !== null && !makeInline) {
    makeBytes.copy(buffer, makeValueOffset);
  }

  if (subIfdLength > 0) {
    if (rawEvidence === "subIfdEmpty") {
      // A minimal empty SubIFD: entry count 0 and no next IFD.
      view.setUint16(subIfdOffset, 0, littleEndian);
      view.setUint32(subIfdOffset + 2, 0, littleEndian);
    } else {
      view.setUint16(subIfdOffset, 1, littleEndian); // one entry
      const subTag = rawEvidence === "subIfdCompression" ? 0x0103 : 0x0106;
      const subValue =
        rawEvidence === "subIfdCompression" ? 32767 : rawEvidence === "subIfdCfa" ? 32803 : 2;
      view.setUint16(subIfdOffset + 2, subTag, littleEndian);
      view.setUint16(subIfdOffset + 4, 3, littleEndian); // SHORT
      view.setUint32(subIfdOffset + 6, 1, littleEndian); // count 1
      encodeShort(subValue, littleEndian).copy(buffer, subIfdOffset + 10);
      view.setUint32(subIfdOffset + 14, 0, littleEndian); // no next SubIFD
    }
  }

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

test("detects a minimal synthetic little-endian Sony ARW by structure, Make and CFA evidence inside a SubIFD", () => {
  assert.equal(detectAssetSourceKind(buildTiff({ littleEndian: true })), "ARW");
});

test("detects a minimal synthetic big-endian Sony ARW", () => {
  assert.equal(detectAssetSourceKind(buildTiff({ littleEndian: false })), "ARW");
});

test("each RAW-specific evidence marks a SONY TIFF as ARW on both byte orders", () => {
  const evidences = ["ifdCompression", "ifdCfa", "subIfdCfa", "subIfdCompression"] as const;
  for (const rawEvidence of evidences) {
    assert.equal(
      detectAssetSourceKind(buildTiff({ rawEvidence, littleEndian: true })),
      "ARW",
      `${rawEvidence} little-endian must be detected as ARW`
    );
    assert.equal(
      detectAssetSourceKind(buildTiff({ rawEvidence, littleEndian: false })),
      "ARW",
      `${rawEvidence} big-endian must be detected as ARW`
    );
  }
});

test("a plain TIFF with a SONY Make but no RAW-specific evidence is not an ARW", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ rawEvidence: "none" })),
    null,
    "a structurally valid RGB TIFF whose Make is SONY must not be archived as ARW"
  );
});

test("an empty SubIFD provides no RAW evidence on its own", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ rawEvidence: "subIfdEmpty" })),
    null,
    "a SubIFDs tag pointing at a well-formed but empty SubIFD is a generic TIFF feature, not RAW evidence"
  );
});

test("a SONY TIFF with an ordinary RGB SubIFD is not an ARW", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ rawEvidence: "subIfdRgb" })),
    null,
    "a SubIFD carrying photometric 2 (RGB) is ordinary TIFF structure, not RAW evidence"
  );
});

test("a SubIFDs pointer that leaves the file does not count as RAW evidence", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ rawEvidence: "subIfdCfa", subIfdOffsetOverride: 1_000 })),
    null,
    "an out-of-bounds SubIFD pointer must not qualify a SONY TIFF as ARW"
  );
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
