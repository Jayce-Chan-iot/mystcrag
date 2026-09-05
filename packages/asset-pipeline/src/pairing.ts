import { normalizeAssetRelativePath } from "@mystcrag/design-contract";

export type PairableSourceFile = {
  clientFileId: string;
  relativePath: string;
  kind: "ARW" | "JPEG" | "PNG" | "WEBP";
};

export type RawJpegPair = {
  stem: string;
  jpeg: PairableSourceFile;
  raw: PairableSourceFile;
  pairingBasis: "same-directory" | "cross-directory";
  alternatives: string[];
};

/**
 * A stem that holds RAW and JPEG candidates but not exactly one of each:
 * no pair is invented and the bucket is surfaced so a human can resolve it.
 */
export type AmbiguousRawJpegBucket = {
  stem: string;
  jpegs: PairableSourceFile[];
  raws: PairableSourceFile[];
};

export type PairingOutcome = {
  pairs: RawJpegPair[];
  unpairedJpeg: PairableSourceFile[];
  unpairedRaw: PairableSourceFile[];
  nonPairable: PairableSourceFile[];
  ambiguousBuckets: AmbiguousRawJpegBucket[];
};

const PAIRABLE_KINDS: readonly string[] = ["ARW", "JPEG", "PNG", "WEBP"];

/**
 * Deterministic UTF-16 code-unit comparison. relativePath accepts arbitrary
 * Unicode, and localeCompare collates "z" and "ä" together in most locales,
 * which would make pair winners and output order depend on the runtime
 * environment. Code-unit order is fixed for every environment.
 */
function compareByCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const byRelativePathThenId = (left: PairableSourceFile, right: PairableSourceFile): number =>
  compareByCodeUnits(left.relativePath, right.relativePath) ||
  compareByCodeUnits(left.clientFileId, right.clientFileId);

function stemOf(relativePath: string): string {
  const lastSegment = relativePath.split("/").at(-1) ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0) return lastSegment;
  return lastSegment.slice(0, dotIndex);
}

function directoryOf(relativePath: string): string {
  const segments = relativePath.split("/");
  segments.pop();
  return segments.join("/");
}

function validateFile(file: PairableSourceFile): void {
  if (typeof file.clientFileId !== "string" || file.clientFileId.length === 0) {
    throw new Error("Pairing requires a non-empty clientFileId for every file");
  }
  if (typeof file.relativePath !== "string" || file.relativePath.length === 0) {
    throw new Error(`Pairing requires a relative path for file ${file.clientFileId}`);
  }
  if (!PAIRABLE_KINDS.includes(file.kind)) {
    throw new Error(`File ${file.clientFileId} has an invalid kind: ${String(file.kind)}`);
  }
  try {
    normalizeAssetRelativePath(file.relativePath);
  } catch (error) {
    throw new Error(
      `File ${file.clientFileId} has an invalid relative path: ${(error as Error).message}`,
      { cause: error }
    );
  }
}

/**
 * Conservative RAW/JPEG pairing on the file stem (spec §12.3: `ZDX01535` in
 * different numbered directories still pairs). A stem pairs ONLY when the
 * candidate set holds exactly one JPEG and exactly one ARW — the same
 * one-pairing rule grouping enforces. Anything else with both sides present
 * (1 JPEG + 2 ARW, 2 + 1, 2 + 2, …) is an explicit ambiguous bucket for human
 * review: repeated camera filenames must never produce a silently chosen
 * winner, a raw occupied by two pairs, or a same-directory favorite that
 * steals the pairing. Every file belongs to at most one pair, and every
 * output list is ordered by the `relativePath → clientFileId` code-unit
 * comparator so the outcome is identical for every input permutation and
 * every runtime locale.
 */
export function pairRawAndJpeg(files: readonly PairableSourceFile[]): PairingOutcome {
  if (files.length === 0) {
    throw new Error("Pairing requires at least one file");
  }

  const seenClientIds = new Set<string>();
  for (const file of files) {
    validateFile(file);
    if (seenClientIds.has(file.clientFileId)) {
      throw new Error(`clientFileId ${file.clientFileId} must be unique`);
    }
    seenClientIds.add(file.clientFileId);
  }

  const nonPairable: PairableSourceFile[] = [];
  const stemBuckets = new Map<string, { jpegs: PairableSourceFile[]; raws: PairableSourceFile[] }>();
  for (const file of files) {
    if (file.kind === "PNG" || file.kind === "WEBP") {
      nonPairable.push(file);
      continue;
    }
    const stem = stemOf(file.relativePath);
    const bucket = stemBuckets.get(stem) ?? { jpegs: [], raws: [] };
    if (file.kind === "JPEG") bucket.jpegs.push(file);
    else bucket.raws.push(file);
    stemBuckets.set(stem, bucket);
  }

  const pairs: RawJpegPair[] = [];
  const unpairedJpeg: PairableSourceFile[] = [];
  const unpairedRaw: PairableSourceFile[] = [];
  const ambiguousBuckets: AmbiguousRawJpegBucket[] = [];

  for (const [stem, bucket] of stemBuckets) {
    if (bucket.jpegs.length === 0 && bucket.raws.length === 0) continue;
    if (bucket.jpegs.length === 0) {
      unpairedRaw.push(...bucket.raws);
      continue;
    }
    if (bucket.raws.length === 0) {
      unpairedJpeg.push(...bucket.jpegs);
      continue;
    }
    if (bucket.jpegs.length !== 1 || bucket.raws.length !== 1) {
      ambiguousBuckets.push({
        stem,
        jpegs: [...bucket.jpegs].sort(byRelativePathThenId),
        raws: [...bucket.raws].sort(byRelativePathThenId)
      });
      continue;
    }

    const jpeg = bucket.jpegs[0]!;
    const raw = bucket.raws[0]!;
    pairs.push({
      stem,
      jpeg,
      raw,
      pairingBasis:
        directoryOf(jpeg.relativePath) === directoryOf(raw.relativePath)
          ? "same-directory"
          : "cross-directory",
      alternatives: []
    });
  }

  return {
    pairs: pairs.sort(
      (left, right) =>
        compareByCodeUnits(left.stem, right.stem) ||
        byRelativePathThenId(left.jpeg, right.jpeg)
    ),
    unpairedJpeg: unpairedJpeg.sort(byRelativePathThenId),
    unpairedRaw: unpairedRaw.sort(byRelativePathThenId),
    nonPairable: nonPairable.sort(byRelativePathThenId),
    ambiguousBuckets: ambiguousBuckets.sort((left, right) =>
      compareByCodeUnits(left.stem, right.stem)
    )
  };
}
