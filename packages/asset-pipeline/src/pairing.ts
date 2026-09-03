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

export type PairingOutcome = {
  pairs: RawJpegPair[];
  unpairedJpeg: PairableSourceFile[];
  unpairedRaw: PairableSourceFile[];
  nonPairable: PairableSourceFile[];
};

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
 * different numbered directories still pairs). A same-directory RAW always
 * beats cross-directory candidates; remaining ties resolve to the
 * lexicographically smallest path so the outcome never depends on input
 * order. Losing candidates are surfaced as alternatives instead of being
 * silently dropped, and ambiguous data never invents a pair.
 */
export function pairRawAndJpeg(files: readonly PairableSourceFile[]): PairingOutcome {
  if (files.length === 0) {
    throw new Error("Pairing requires at least one file");
  }
  const validated = files.map((file) => {
    validateFile(file);
    return file;
  });

  const jpegs: PairableSourceFile[] = [];
  const raws: PairableSourceFile[] = [];
  const nonPairable: PairableSourceFile[] = [];
  for (const file of validated) {
    if (file.kind === "JPEG") jpegs.push(file);
    else if (file.kind === "ARW") raws.push(file);
    else nonPairable.push(file);
  }

  const pairs: RawJpegPair[] = [];
  const unpairedJpeg: PairableSourceFile[] = [];

  for (const jpeg of jpegs) {
    const stem = stemOf(jpeg.relativePath);
    const candidates = raws.filter((raw) => stemOf(raw.relativePath) === stem);
    if (candidates.length === 0) {
      unpairedJpeg.push(jpeg);
      continue;
    }

    const jpegDirectory = directoryOf(jpeg.relativePath);
    const sameDirectory = candidates.filter((raw) => directoryOf(raw.relativePath) === jpegDirectory);
    const pool = sameDirectory.length > 0 ? sameDirectory : candidates;
    pool.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const winner = pool[0]!;
    const losers = candidates.filter((raw) => raw !== winner);

    pairs.push({
      stem,
      jpeg,
      raw: winner,
      pairingBasis: sameDirectory.length > 0 ? "same-directory" : "cross-directory",
      alternatives: losers.map((raw) => raw.relativePath).sort((left, right) => left.localeCompare(right))
    });
  }

  const pairedRaws = new Set(pairs.map((pair) => pair.raw));
  const unpairedRaw = raws.filter((raw) => !pairedRaws.has(raw));

  const byRelativePath = (left: PairableSourceFile, right: PairableSourceFile) =>
    left.relativePath.localeCompare(right.relativePath);
  return {
    pairs: pairs.sort((left, right) => left.stem.localeCompare(right.stem)),
    unpairedJpeg: [...unpairedJpeg].sort(byRelativePath),
    unpairedRaw: [...unpairedRaw].sort(byRelativePath),
    nonPairable: [...nonPairable].sort(byRelativePath)
  };
}
