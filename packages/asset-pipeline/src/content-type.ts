export type DetectedAssetSourceKind = "ARW" | "JPEG" | "PNG" | "WEBP";

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const TIFF_LITTLE_ENDIAN_MAGIC = [0x49, 0x49, 0x2a, 0x00] as const;
const TIFF_BIG_ENDIAN_MAGIC = [0x4d, 0x4d, 0x00, 0x2a] as const;

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

/**
 * Sniffs the asset source kind from magic bytes only. File extensions and
 * client-declared kinds are never trusted: a mislabeled file is classified by
 * its actual content so archives never store a payload under a wrong kind.
 * Sony ARW is a TIFF container, so both TIFF byte orders map to ARW.
 */
export function detectAssetSourceKind(bytes: Uint8Array): DetectedAssetSourceKind | null {
  if (startsWith(bytes, JPEG_MAGIC)) return "JPEG";
  if (startsWith(bytes, PNG_MAGIC)) return "PNG";
  if (isWebp(bytes)) return "WEBP";
  if (startsWith(bytes, TIFF_LITTLE_ENDIAN_MAGIC)) return "ARW";
  if (startsWith(bytes, TIFF_BIG_ENDIAN_MAGIC)) return "ARW";
  return null;
}
