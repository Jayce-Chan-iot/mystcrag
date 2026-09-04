export type DetectedAssetSourceKind = "ARW" | "JPEG" | "PNG" | "WEBP";

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const TIFF_LITTLE_ENDIAN_MAGIC = [0x49, 0x49, 0x2a, 0x00] as const;
const TIFF_BIG_ENDIAN_MAGIC = [0x4d, 0x4d, 0x00, 0x2a] as const;

const TIFF_MAGIC = 42;
const TIFF_HEADER_SIZE = 8;
const IFD_ENTRY_SIZE = 12;
const TAG_COMPRESSION = 0x0103;
const TAG_PHOTOMETRIC = 0x0106;
const TAG_MAKE = 0x010f;
const TAG_SUB_IFDS = 0x014a;
const TAG_TYPE_ASCII = 2;
const TAG_TYPE_SHORT = 3;
const TAG_TYPE_LONG = 4;
const TAG_TYPE_IFD = 13;
// Sony's RAW compression code used by current ARW payloads.
const SONY_RAW_COMPRESSION = 32767;
// CFA photometric interpretation: the sensor mosaic layout only RAW files carry.
const CFA_PHOTOMETRIC = 32803;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return (
    startsWith(bytes.subarray(0, 4), [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes.subarray(8, 12), [0x57, 0x45, 0x42, 0x50])
  );
}

function decodeAscii(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    if (byte === 0) break;
    text += String.fromCharCode(byte);
  }
  return text;
}

/**
 * Reads the first SHORT or LONG value of an IFD entry, honoring the entry's
 * type, count, endianness and inline/external value placement. Returns null
 * when the entry is malformed or points outside the buffer — a malformed
 * entry simply provides no evidence.
 */
function readShortOrLongValue(
  view: DataView,
  entryAt: number,
  type: number,
  count: number,
  littleEndian: boolean,
  byteLength: number
): number | null {
  if (count < 1) return null;
  const valueSize = type === TAG_TYPE_SHORT ? 2 : type === TAG_TYPE_LONG ? 4 : 0;
  if (valueSize === 0) return null;
  const total = valueSize * count;
  let offset: number;
  if (total <= 4) {
    offset = entryAt + 8;
  } else {
    offset = view.getUint32(entryAt + 8, littleEndian);
    if (offset + total > byteLength) return null;
  }
  if (offset + valueSize > byteLength) return null;
  return type === TAG_TYPE_SHORT
    ? view.getUint16(offset, littleEndian)
    : view.getUint32(offset, littleEndian);
}

/** True when the entry's SHORT/LONG value equals the wanted RAW marker. */
function entryCarriesRawMarker(
  view: DataView,
  entryAt: number,
  tag: number,
  type: number,
  count: number,
  littleEndian: boolean,
  byteLength: number
): boolean {
  const value = readShortOrLongValue(view, entryAt, type, count, littleEndian, byteLength);
  if (value === null) return false;
  return (tag === TAG_COMPRESSION && value === SONY_RAW_COMPRESSION) ||
    (tag === TAG_PHOTOMETRIC && value === CFA_PHOTOMETRIC);
}

/**
 * Real ARWs keep their sensor strips in SubIFD chains, but SubIFDs themselves
 * are generic TIFF structure — ordinary multi-page/RGB TIFFs carry them too.
 * A SubIFDs tag therefore only counts as evidence when at least one pointed-to
 * SubIFD is fully in bounds AND one of its entries is itself a RAW marker:
 * the Sony RAW compression code (32767) or a CFA photometric interpretation
 * (32803). An empty or RGB SubIFD provides no evidence.
 */
function subIfdCarriesRawEvidence(
  view: DataView,
  entryAt: number,
  type: number,
  count: number,
  littleEndian: boolean,
  byteLength: number
): boolean {
  if (count < 1) return false;
  if (type !== TAG_TYPE_LONG && type !== TAG_TYPE_IFD) return false;
  const total = 4 * count;
  let base: number;
  if (total <= 4) {
    base = entryAt + 8;
  } else {
    base = view.getUint32(entryAt + 8, littleEndian);
    if (base + total > byteLength) return false;
  }
  for (let index = 0; index < count; index += 1) {
    const pointer = view.getUint32(base + index * 4, littleEndian);
    if (pointer < TIFF_HEADER_SIZE || pointer + 2 > byteLength) continue;
    const subEntryCount = view.getUint16(pointer, littleEndian);
    if (pointer + 2 + subEntryCount * IFD_ENTRY_SIZE + 4 > byteLength) continue;
    for (let subIndex = 0; subIndex < subEntryCount; subIndex += 1) {
      const subEntryAt = pointer + 2 + subIndex * IFD_ENTRY_SIZE;
      const subTag = view.getUint16(subEntryAt, littleEndian);
      if (subTag !== TAG_COMPRESSION && subTag !== TAG_PHOTOMETRIC) continue;
      const subType = view.getUint16(subEntryAt + 2, littleEndian);
      const subCount = view.getUint32(subEntryAt + 4, littleEndian);
      if (
        entryCarriesRawMarker(view, subEntryAt, subTag, subType, subCount, littleEndian, byteLength)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Sony ARW is a TIFF container, so the byte order alone proves nothing: any
 * 4-byte `II*\0` header would also accept plain TIFFs and corrupt files. A
 * payload only counts as ARW when the TIFF structure is intact — magic 42,
 * an in-bounds IFD0 offset, an entry table that fits inside the buffer —
 * AND IFD0 carries BOTH an ASCII Make tag identifying Sony AND at least one
 * RAW-specific marker that plain Sony TIFFs never carry: the Sony RAW
 * compression code 32767 or a CFA photometric interpretation (32803), either
 * directly in IFD0 or inside a SubIFD the SubIFDs tag points to. A bare
 * SubIFDs tag is generic TIFF structure and never evidence by itself; a Make
 * tag alone is not evidence either — Sony also produces plain TIFFs — so a
 * file that cannot be proven RAW is rejected rather than archived as ARW.
 */
function isSonyArw(bytes: Uint8Array): boolean {
  const littleEndian = startsWith(bytes, TIFF_LITTLE_ENDIAN_MAGIC);
  const bigEndian = !littleEndian && startsWith(bytes, TIFF_BIG_ENDIAN_MAGIC);
  if (!littleEndian && !bigEndian) return false;
  if (bytes.length < TIFF_HEADER_SIZE) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(2, littleEndian) !== TIFF_MAGIC) return false;

  const ifdOffset = view.getUint32(4, littleEndian);
  if (ifdOffset < TIFF_HEADER_SIZE || ifdOffset + 2 > bytes.length) return false;
  const entryCount = view.getUint16(ifdOffset, littleEndian);
  const ifdEnd = ifdOffset + 2 + entryCount * IFD_ENTRY_SIZE + 4;
  if (ifdEnd > bytes.length) return false;

  let makeIsSony = false;
  let hasRawEvidence = false;

  for (let index = 0; index < entryCount; index += 1) {
    const entryAt = ifdOffset + 2 + index * IFD_ENTRY_SIZE;
    const tag = view.getUint16(entryAt, littleEndian);
    const type = view.getUint16(entryAt + 2, littleEndian);
    const count = view.getUint32(entryAt + 4, littleEndian);

    if (tag === TAG_MAKE) {
      if (type !== TAG_TYPE_ASCII) return false;
      if (count < 4 || count > bytes.length) return false;
      let valueOffset: number;
      if (count <= 4) {
        valueOffset = entryAt + 8;
      } else {
        valueOffset = view.getUint32(entryAt + 8, littleEndian);
        if (valueOffset + count > bytes.length) return false;
      }
      const make = decodeAscii(bytes.subarray(valueOffset, valueOffset + count));
      makeIsSony = make === "SONY" || make.startsWith("SONY");
      continue;
    }

    if (tag === TAG_COMPRESSION || tag === TAG_PHOTOMETRIC) {
      if (entryCarriesRawMarker(view, entryAt, tag, type, count, littleEndian, bytes.length)) {
        hasRawEvidence = true;
      }
      continue;
    }

    if (tag === TAG_SUB_IFDS) {
      if (subIfdCarriesRawEvidence(view, entryAt, type, count, littleEndian, bytes.length)) {
        hasRawEvidence = true;
      }
    }
  }

  return makeIsSony && hasRawEvidence;
}

/**
 * Sniffs the asset source kind from content only. File extensions and
 * client-declared kinds are never trusted: a mislabeled file is classified by
 * its actual content so archives never store a payload under a wrong kind.
 * ARW requires a structurally valid Sony TIFF plus RAW-specific evidence
 * (see isSonyArw); plain SONY TIFFs, truncated or corrupt TIFFs are
 * rejected — when in doubt the result is null, never ARW.
 */
export function detectAssetSourceKind(bytes: Uint8Array): DetectedAssetSourceKind | null {
  if (startsWith(bytes, JPEG_MAGIC)) return "JPEG";
  if (startsWith(bytes, PNG_MAGIC)) return "PNG";
  if (isWebp(bytes)) return "WEBP";
  if (isSonyArw(bytes)) return "ARW";
  return null;
}
