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
  | "ifdCfaLong"
  | "ifdCfaShortCount2"
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
    makeNoNul?: boolean;
    rawEvidence?: RawEvidence;
    dngTag?: "dngVersion" | "dngBackward";
    corruptMagic?: boolean;
    ifdOffsetOverride?: number;
    entryCountOverride?: number;
    valueOffsetOverride?: number;
    subIfdOffsetOverride?: number;
    subIfdPointers?: Array<number | "self">;
    subIfdBadPointer?: boolean;
    truncateAt?: number;
  } = {}
): Buffer {
  const littleEndian = options.littleEndian ?? true;
  const make = options.make === undefined ? "SONY" : options.make;
  const rawEvidence = options.rawEvidence ?? "subIfdCfa";
  const ifdOffset = 8;

  const makeBytes =
    make === null
      ? null
      : options.makeNoNul
        ? Buffer.from(make, "latin1")
        : Buffer.from(`${make}\0`, "latin1");
  const makeInline = makeBytes !== null && makeBytes.length <= 4;

  type Entry = { tag: number; type: number; count: number; inline?: Buffer; offset?: number };
  const entries: Entry[] = [];

  if (makeBytes !== null) {
    entries.push(
      makeInline
        ? { tag: 0x010f, type: 2, count: makeBytes.length, inline: makeBytes }
        : { tag: 0x010f, type: 2, count: makeBytes.length, offset: options.valueOffsetOverride ?? 0 }
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
  } else if (rawEvidence === "ifdCfaLong") {
    // PhotometricInterpretation illegally carried as a LONG.
    entries.push({ tag: 0x0106, type: 4, count: 1, inline: encodeLong(32803, littleEndian) });
  } else if (rawEvidence === "ifdCfaShortCount2") {
    // PhotometricInterpretation illegally carrying two SHORT values, the first
    // of which happens to be the CFA code.
    entries.push({
      tag: 0x0106,
      type: 3,
      count: 2,
      inline: Buffer.concat([encodeShort(32803, littleEndian), encodeShort(0, littleEndian)])
    });
  } else if (rawEvidence.startsWith("subIfd")) {
    entries.push({ tag: 0x014a, type: 4, count: 1, offset: options.subIfdOffsetOverride ?? 0 });
  }

  if (options.dngTag === "dngVersion") {
    entries.push({ tag: 0xc612, type: 1, count: 4, inline: Buffer.from([1, 4, 0, 0]) });
  } else if (options.dngTag === "dngBackward") {
    entries.push({ tag: 0xc714, type: 1, count: 4, inline: Buffer.from([1, 1, 0, 0]) });
  }
  entries.sort((left, right) => left.tag - right.tag);

  const entryCount = entries.length;
  const ifdEnd = ifdOffset + 2 + entryCount * 12 + 4;
  let cursor = ifdEnd;
  const makeValueOffset = cursor;
  if (makeBytes !== null && !makeInline) {
    entries[entries.findIndex((entry) => entry.tag === 0x010f)]!.offset =
      options.valueOffsetOverride ?? makeValueOffset;
    cursor += makeBytes.length;
  }
  const subIfdPtrOffset = cursor;
  const multiPointer = options.subIfdPointers !== undefined || options.subIfdBadPointer === true;
  const pointerCount = multiPointer
    ? (options.subIfdPointers?.length ?? 1) + (options.subIfdBadPointer ? 1 : 0)
    : 0;
  if (multiPointer) cursor += 4 * pointerCount;
  const subIfdOffset = cursor;
  const subIfdLength = rawEvidence === "subIfdEmpty" ? 6 : rawEvidence.startsWith("subIfd") ? 18 : 0;
  const badSubIfdOffset = subIfdOffset + subIfdLength;
  const badSubIfdLength = options.subIfdBadPointer ? 20 : 0;

  // Patch the SubIFDs entry BEFORE the buffer is written: multi-pointer builds
  // point at an external pointer array, single-pointer builds at the SubIFD.
  const subIfdsEntry = entries.find((entry) => entry.tag === 0x014a);
  if (subIfdsEntry) {
    if (multiPointer) {
      subIfdsEntry.count = pointerCount;
      subIfdsEntry.offset = subIfdPtrOffset;
    } else {
      subIfdsEntry.count = 1;
      subIfdsEntry.offset = options.subIfdOffsetOverride ?? subIfdOffset;
    }
  }

  const buffer = Buffer.alloc(subIfdOffset + subIfdLength + badSubIfdLength);
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

  if (multiPointer) {
    const pointers: Array<number | "self" | "bad"> = [
      ...(options.subIfdPointers ?? ["self"]),
      ...(options.subIfdBadPointer ? (["bad"] as const) : [])
    ];
    pointers.forEach((pointer, index) => {
      const value = pointer === "self" ? subIfdOffset : pointer === "bad" ? badSubIfdOffset : pointer;
      view.setUint32(subIfdPtrOffset + index * 4, value, littleEndian);
    });
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

  if (badSubIfdLength > 0) {
    // A pointer destination that is inside the file but structurally broken:
    // an entry count of 65535 cannot fit in any real buffer.
    view.setUint16(badSubIfdOffset, 65535, littleEndian);
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

// ---------------------------------------------------------------------------
// Round 5: strict ARW tag grammar — Make NUL termination, TIFF type/count
// conformance, DNG rejection, and fail-closed multi-SubIFD pointers.
// ---------------------------------------------------------------------------

test("a Make value that merely starts with SONY is not a Sony camera", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ make: "SONYFAKE", rawEvidence: "subIfdCfa" })),
    null,
    "SONYFAKE must not pass a prefix match on the Make tag"
  );
});

test("a four-byte SONY Make without NUL termination is not a valid ASCII tag", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ makeNoNul: true, rawEvidence: "subIfdCfa" })),
    null,
    "an unterminated ASCII value must not qualify as SONY"
  );
});

test("a CFA PhotometricInterpretation carried as LONG is not RAW evidence", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ rawEvidence: "ifdCfaLong" })),
    null,
    "PhotometricInterpretation must be a SHORT with count 1 per the TIFF spec"
  );
});

test("a CFA PhotometricInterpretation with count 2 is not RAW evidence", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ rawEvidence: "ifdCfaShortCount2" })),
    null,
    "a SHORT count of 2 whose first value happens to be 32803 must not count"
  );
});

test("a Sony TIFF carrying DNGVersion is a DNG, never an ARW", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ rawEvidence: "subIfdCfa", dngTag: "dngVersion" })),
    null,
    "DNGVersion marks a DNG container even with CFA evidence and a SONY Make"
  );
});

test("a Sony TIFF carrying DNGBackwardVersion is a DNG, never an ARW", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ rawEvidence: "ifdCfa", dngTag: "dngBackward" })),
    null,
    "DNGBackwardVersion marks a DNG container even with CFA evidence and a SONY Make"
  );
});

test("one out-of-bounds SubIFD pointer fails the whole file closed", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ rawEvidence: "subIfdCfa", subIfdPointers: ["self", 1000] })),
    null,
    "a declared SubIFD pointer that leaves the file must disqualify every other pointer"
  );
});

test("one structurally broken in-bounds SubIFD pointer fails the whole file closed", () => {
  assert.equal(
    detectAssetSourceKind(buildTiff({ rawEvidence: "subIfdCfa", subIfdBadPointer: true })),
    null,
    "a pointer to an in-bounds but structurally illegal SubIFD must fail closed"
  );
});
