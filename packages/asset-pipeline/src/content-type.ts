export type DetectedAssetSourceKind = "ARW" | "JPEG" | "PNG" | "WEBP";

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const TIFF_LITTLE_ENDIAN_MAGIC = [0x49, 0x49, 0x2a, 0x00] as const;
const TIFF_BIG_ENDIAN_MAGIC = [0x4d, 0x4d, 0x00, 0x2a] as const;

const TIFF_MAGIC = 42;
const TIFF_HEADER_SIZE = 8;
const IFD_ENTRY_SIZE = 12;
const TAG_MAKE = 0x010f;
const TAG_TYPE_ASCII = 2;

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
 * Sony ARW is a TIFF container, so the byte order alone proves nothing: any
 * 4-byte `II*\0` header would also accept plain TIFFs and corrupt files. A
 * payload only counts as ARW when the TIFF structure is intact — magic 42,
 * an in-bounds IFD0 offset, an entry table that fits inside the buffer — and
 * IFD0 carries an ASCII Make tag identifying Sony. Both byte orders are
 * honored for real camera files.
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

  for (let index = 0; index < entryCount; index += 1) {
    const entryAt = ifdOffset + 2 + index * IFD_ENTRY_SIZE;
    if (view.getUint16(entryAt, littleEndian) !== TAG_MAKE) continue;
    if (view.getUint16(entryAt + 2, littleEndian) !== TAG_TYPE_ASCII) return false;
    const count = view.getUint32(entryAt + 4, littleEndian);
    if (count < 4 || count > bytes.length) return false;

    let valueOffset: number;
    if (count <= 4) {
      valueOffset = entryAt + 8;
    } else {
      valueOffset = view.getUint32(entryAt + 8, littleEndian);
      if (valueOffset + count > bytes.length) return false;
    }
    const make = decodeAscii(bytes.subarray(valueOffset, valueOffset + count));
    return make === "SONY" || make.startsWith("SONY");
  }
  return false;
}

/**
 * Sniffs the asset source kind from content only. File extensions and
 * client-declared kinds are never trusted: a mislabeled file is classified by
 * its actual content so archives never store a payload under a wrong kind.
 * ARW additionally requires a structurally valid Sony TIFF (see isSonyArw);
 * plain or truncated TIFFs are rejected.
 */
export function detectAssetSourceKind(bytes: Uint8Array): DetectedAssetSourceKind | null {
  if (startsWith(bytes, JPEG_MAGIC)) return "JPEG";
  if (startsWith(bytes, PNG_MAGIC)) return "PNG";
  if (isWebp(bytes)) return "WEBP";
  if (isSonyArw(bytes)) return "ARW";
  return null;
}
