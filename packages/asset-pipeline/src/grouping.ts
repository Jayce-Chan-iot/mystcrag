import sharp from "sharp";

import { normalizeAssetRelativePath } from "@mystcrag/design-contract";

import { type DetectedAssetSourceKind } from "./content-type.js";

/**
 * Conservative grouping thresholds (spec §7). Merging requires BOTH visual
 * signals AND capture proximity to agree; anything visually near but without
 * agreeing signals becomes a low-confidence review suggestion that a human
 * confirms — never an automatic merge. Values are deliberately strict:
 * a dHash distance of 6/64 bits is a near-identical frame, 14 already allows
 * small subject motion; an L1 histogram distance of 0.15 is a nearly
 * identical color distribution, and a 60 s window matches camera bursts.
 */
export const GROUPING_THRESHOLDS = {
  dHashConfident: 6,
  dHashReview: 14,
  histogramConfident: 0.15,
  histogramReview: 0.35,
  captureGapConfidentMs: 60_000
} as const;

export type GroupingThresholds = typeof GROUPING_THRESHOLDS;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DHASH_PATTERN = /^[0-9a-f]{16}$/;
const HISTOGRAM_BINS = 64;
const KINDS: readonly string[] = ["ARW", "JPEG", "PNG", "WEBP"];

/**
 * Deterministic UTF-16 code-unit comparison. clientFileId accepts arbitrary
 * Unicode, and localeCompare may report `é` (U+00E9) and `e\u0301` as equal
 * depending on the runtime locale, which would make member order, group
 * representatives, and evidence order depend on input order or the host
 * environment. Code-unit order is fixed for every environment.
 */
function compareByCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type GroupingCandidate = {
  clientFileId: string;
  relativePath: string;
  sha256: string;
  kind: DetectedAssetSourceKind;
  dHash: string | null;
  histogram: number[] | null;
  capturedAtMs: number | null;
};

export type GroupSimilarityEvidence = {
  fileId: string;
  relatedFileId: string | null;
  exactDuplicateOf: string | null;
  stemPairedWith: string | null;
  dHashDistance: number | null;
  histogramDistance: number | null;
  captureGapMs: number | null;
  sameDirectory: boolean;
};

export type GroupSuggestion = {
  memberFileIds: string[];
  confidence: "high" | "low";
  evidence: GroupSimilarityEvidence[];
};

export type GroupingOutcome = {
  suggestions: GroupSuggestion[];
  reviewSuggestions: GroupSuggestion[];
};

/**
 * Grayscale difference hash (dHash): 9×8 pixels, 64 adjacent-pixel
 * comparisons, hex-encoded. Deterministic for identical bytes.
 */
export async function computeDHash(imageBytes: Uint8Array): Promise<string> {
  const { data } = await sharp(imageBytes)
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = "";
  let nibble = 0;
  let bits = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const left = data[row * 9 + column] ?? 0;
      const right = data[row * 9 + column + 1] ?? 0;
      nibble = (nibble << 1) | (left > right ? 1 : 0);
      bits += 1;
      if (bits === 4) {
        hash += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hash;
}

/**
 * Compact 4×4×4 RGB color histogram over a 32×32 thumbnail, normalized so
 * every bin sums to 1. The L1 distance between two histograms is at most 2.
 */
export async function computeColorHistogram(imageBytes: Uint8Array): Promise<number[]> {
  const { data } = await sharp(imageBytes)
    .removeAlpha()
    .resize(32, 32, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
  const channels = 3;
  const pixelCount = data.length / channels;
  for (let offset = 0; offset + 2 < data.length; offset += channels) {
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    const bin = ((red >> 6) << 4) | ((green >> 6) << 2) | (blue >> 6);
    bins[bin] = (bins[bin] ?? 0) + 1;
  }
  return bins.map((count) => count / pixelCount);
}

export function hammingDistance(left: string, right: string): number {
  assertDHash(left);
  assertDHash(right);
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16);
    distance += POPCOUNT[difference] ?? 0;
  }
  return distance;
}

export function histogramDistance(left: readonly number[], right: readonly number[]): number {
  assertHistogram(left);
  assertHistogram(right);
  let distance = 0;
  for (let index = 0; index < HISTOGRAM_BINS; index += 1) {
    distance += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
  }
  return distance;
}

const POPCOUNT: readonly number[] = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

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

function assertDHash(value: string): void {
  if (typeof value !== "string" || !DHASH_PATTERN.test(value)) {
    throw new Error("dHash must be 16 lowercase hex characters");
  }
}

function assertHistogram(value: readonly number[]): void {
  if (!Array.isArray(value) || value.length !== HISTOGRAM_BINS || value.some((bin) => !Number.isFinite(bin))) {
    throw new Error("histogram must contain 64 finite normalized bins");
  }
}

function assertSha256(value: string): void {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error("SHA-256 must be 64 lowercase hex characters");
  }
}

/**
 * Deterministic, conservative grouping suggestions (spec §7): exact
 * duplicates collapse first, an unambiguous same-stem ARW+JPEG pair groups
 * next (exactly one distinct ARW and one distinct JPEG per stem — ambiguous
 * stems never merge on the file name), and remaining neighbors merge only
 * when visual thresholds and capture proximity agree. Borderline pairs never
 * auto-merge — they surface as low-confidence review suggestions carrying
 * their similarity evidence so the UI can explain the proposal. Suggestions
 * and their evidence are fully deterministic and independent of input order.
 */
export function suggestGroups(
  candidates: readonly GroupingCandidate[],
  options: { thresholds?: Partial<GroupingThresholds> } = {}
): GroupingOutcome {
  const thresholds: GroupingThresholds = { ...GROUPING_THRESHOLDS, ...options.thresholds };
  if (candidates.length === 0) {
    throw new Error("Grouping requires at least one candidate");
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate.clientFileId !== "string" || candidate.clientFileId.length === 0) {
      throw new Error("Grouping candidates require a non-empty clientFileId");
    }
    if (seen.has(candidate.clientFileId)) {
      throw new Error(`clientFileId ${candidate.clientFileId} must be unique`);
    }
    seen.add(candidate.clientFileId);
    assertSha256(candidate.sha256);
    if (!KINDS.includes(candidate.kind)) {
      throw new Error(`Grouping candidate ${candidate.clientFileId} has an invalid kind: ${String(candidate.kind)}`);
    }
    if (candidate.dHash !== null) assertDHash(candidate.dHash);
    if (candidate.histogram !== null) assertHistogram(candidate.histogram);
    if (candidate.capturedAtMs !== null && (!Number.isFinite(candidate.capturedAtMs) || candidate.capturedAtMs < 0)) {
      throw new Error(`capturedAtMs of ${candidate.clientFileId} must be a non-negative number`);
    }
    try {
      normalizeAssetRelativePath(candidate.relativePath);
    } catch (error) {
      throw new Error(`Grouping candidate ${candidate.clientFileId} has an invalid relative path`, {
        cause: error
      });
    }
  }

  const sorted = [...candidates].sort((left, right) => compareByCodeUnits(left.clientFileId, right.clientFileId));
  const parent = sorted.map((_, index) => index);

  const find = (index: number): number => {
    let current = index;
    for (;;) {
      const value = parent[current] ?? current;
      if (value === current) return current;
      const grandparent = parent[value] ?? value;
      parent[current] = grandparent;
      current = grandparent;
    }
  };

  const evidenceByFileId = new Map<string, GroupSimilarityEvidence[]>();
  const record = (evidence: GroupSimilarityEvidence): void => {
    const list = evidenceByFileId.get(evidence.fileId) ?? [];
    list.push(evidence);
    evidenceByFileId.set(evidence.fileId, list);
  };

  const union = (leftIndex: number, rightIndex: number, evidence: GroupSimilarityEvidence): void => {
    const leftRoot = find(leftIndex);
    const rightRoot = find(rightIndex);
    if (leftRoot === rightRoot) return;
    parent[rightRoot] = leftRoot;
    record(evidence);
  };

  const sameDirectory = (left: GroupingCandidate, right: GroupingCandidate): boolean =>
    directoryOf(left.relativePath) === directoryOf(right.relativePath);

  // 1. Exact duplicates collapse.
  for (let left = 0; left < sorted.length; left += 1) {
    for (let right = left + 1; right < sorted.length; right += 1) {
      const a = sorted[left]!;
      const b = sorted[right]!;
      if (a.sha256 !== b.sha256 || find(left) === find(right)) continue;
      union(left, right, {
        fileId: b.clientFileId,
        relatedFileId: a.clientFileId,
        exactDuplicateOf: a.clientFileId,
        stemPairedWith: null,
        dHashDistance: null,
        histogramDistance: null,
        captureGapMs: null,
        sameDirectory: sameDirectory(a, b)
      });
    }
  }

  // 2. Same-stem RAW/JPEG pairing (different digests only). A Sony burst
  // stores the ARW and its in-camera JPEG under one stem, so a stem pairs
  // ONLY when the ORIGINAL candidate set holds exactly one ARW side and
  // exactly one JPEG side — anything else (2 ARW + 1 JPEG, 1 + 2, 2 + 2, …)
  // is ambiguous: repeated camera filenames must not fuse unrelated shots,
  // so no stem-based merge happens and the members stay independent unless
  // the visual thresholds below prove a merge. Counting is deliberately done
  // on raws/jpegs, not on collapsed components: exact duplicates fold into
  // one root, so two identical ARWs would collapse to a single root and let
  // the stem edge smuggle their JPEG into the duplicate group. This is
  // deliberately stricter than pairRawAndJpeg (pairing.ts), which resolves
  // ambiguity by deterministically picking a winner: grouping must never
  // silently choose, so the one-pairing rule is enforced here on its own.
  const stemBuckets = new Map<string, { raws: number[]; jpegs: number[] }>();
  for (let index = 0; index < sorted.length; index += 1) {
    const candidateAt = sorted[index]!;
    if (candidateAt.kind !== "ARW" && candidateAt.kind !== "JPEG") continue;
    const stem = stemOf(candidateAt.relativePath);
    const bucket = stemBuckets.get(stem) ?? { raws: [], jpegs: [] };
    if (candidateAt.kind === "ARW") bucket.raws.push(index);
    else bucket.jpegs.push(index);
    stemBuckets.set(stem, bucket);
  }
  for (const { raws, jpegs } of stemBuckets.values()) {
    if (raws.length === 0 || jpegs.length === 0) continue;
    // Exactly one ARW and one JPEG may pair, counted on the original
    // candidates: identical duplicates already collapsed into one component,
    // so component counts would falsely report "one ARW" for two identical
    // ARWs and wrongly attach the JPEG.
    if (raws.length !== 1 || jpegs.length !== 1) continue;

    const jpegRepIndex = jpegs[0]!;
    const jpegRep = sorted[jpegRepIndex]!;
    const jpegRoot = find(jpegRepIndex);
    for (const rawIndex of raws) {
      if (find(rawIndex) === jpegRoot) continue; // already linked by a duplicate chain
      record({
        fileId: sorted[rawIndex]!.clientFileId,
        relatedFileId: jpegRep.clientFileId,
        exactDuplicateOf: null,
        stemPairedWith: jpegRep.clientFileId,
        dHashDistance: null,
        histogramDistance: null,
        captureGapMs: null,
        sameDirectory: sameDirectory(sorted[rawIndex]!, jpegRep)
      });
      parent[find(rawIndex)] = jpegRoot;
    }
  }

  // 3a. Confident merges need both visual thresholds and capture proximity.
  for (let left = 0; left < sorted.length; left += 1) {
    for (let right = left + 1; right < sorted.length; right += 1) {
      const a = sorted[left]!;
      const b = sorted[right]!;
      if (find(left) === find(right)) continue;
      if (a.dHash === null || b.dHash === null || a.histogram === null || b.histogram === null) continue;

      const dHashDistance = hammingDistance(a.dHash, b.dHash);
      const histogramDelta = histogramDistance(a.histogram, b.histogram);
      const captureGapMs =
        a.capturedAtMs !== null && b.capturedAtMs !== null
          ? Math.abs(a.capturedAtMs - b.capturedAtMs)
          : null;

      const confident =
        dHashDistance <= thresholds.dHashConfident &&
        histogramDelta <= thresholds.histogramConfident &&
        captureGapMs !== null &&
        captureGapMs <= thresholds.captureGapConfidentMs;
      if (!confident) continue;

      union(left, right, {
        fileId: b.clientFileId,
        relatedFileId: a.clientFileId,
        exactDuplicateOf: null,
        stemPairedWith: null,
        dHashDistance,
        histogramDistance: histogramDelta,
        captureGapMs,
        sameDirectory: sameDirectory(a, b)
      });
    }
  }

  // 3b. Borderline pairs: visually near, but signals did not all agree.
  // Only items that are still singletons participate, so confident groups
  // never leak into review suggestions.
  const componentSizes = new Map<number, number>();
  for (let index = 0; index < sorted.length; index += 1) {
    const root = find(index);
    componentSizes.set(root, (componentSizes.get(root) ?? 0) + 1);
  }
  const reviewParent = new Map<number, number>();
  const reviewRoot = (index: number): number => {
    let current = index;
    while (reviewParent.get(current) !== undefined && reviewParent.get(current) !== current) {
      const next = reviewParent.get(current)!;
      const grandparent = reviewParent.get(next) ?? next;
      reviewParent.set(current, grandparent);
      current = grandparent;
    }
    reviewParent.set(current, current);
    return current;
  };
  const reviewEvidenceByFileId = new Map<string, GroupSimilarityEvidence[]>();
  const recordReview = (evidence: GroupSimilarityEvidence): void => {
    const list = reviewEvidenceByFileId.get(evidence.fileId) ?? [];
    list.push(evidence);
    reviewEvidenceByFileId.set(evidence.fileId, list);
  };

  for (let left = 0; left < sorted.length; left += 1) {
    for (let right = left + 1; right < sorted.length; right += 1) {
      const a = sorted[left]!;
      const b = sorted[right]!;
      if ((componentSizes.get(find(left)) ?? 0) !== 1) continue;
      if ((componentSizes.get(find(right)) ?? 0) !== 1) continue;
      if (a.dHash === null || b.dHash === null || a.histogram === null || b.histogram === null) continue;

      const dHashDistance = hammingDistance(a.dHash, b.dHash);
      const histogramDelta = histogramDistance(a.histogram, b.histogram);
      const captureGapMs =
        a.capturedAtMs !== null && b.capturedAtMs !== null
          ? Math.abs(a.capturedAtMs - b.capturedAtMs)
          : null;

      const borderline =
        dHashDistance <= thresholds.dHashReview && histogramDelta <= thresholds.histogramReview;
      if (!borderline) continue;

      recordReview({
        fileId: b.clientFileId,
        relatedFileId: a.clientFileId,
        exactDuplicateOf: null,
        stemPairedWith: null,
        dHashDistance,
        histogramDistance: histogramDelta,
        captureGapMs,
        sameDirectory: sameDirectory(a, b)
      });

      const leftRoot = reviewRoot(left);
      const rightRoot = reviewRoot(right);
      if (leftRoot !== rightRoot) {
        reviewParent.set(rightRoot, leftRoot);
      }
    }
  }

  // Assemble confident components as suggestions.
  const suggestionsByRoot = new Map<number, string[]>();
  for (let index = 0; index < sorted.length; index += 1) {
    const root = find(index);
    const members = suggestionsByRoot.get(root) ?? [];
    members.push(sorted[index]!.clientFileId);
    suggestionsByRoot.set(root, members);
  }

  const suggestions: GroupSuggestion[] = [...suggestionsByRoot.entries()].map(([, members]) => {
    const orderedMembers = [...members].sort(compareByCodeUnits);
    const evidence = orderedMembers.flatMap(
      (member) => evidenceByFileId.get(member) ?? []
    );
    return { memberFileIds: orderedMembers, confidence: "high" as const, evidence };
  });
  suggestions.sort((left, right) => compareByCodeUnits(left.memberFileIds[0]!, right.memberFileIds[0]!));

  // Assemble borderline components as review suggestions.
  const reviewGroupsByRoot = new Map<number, string[]>();
  for (let index = 0; index < sorted.length; index += 1) {
    if (!reviewParent.has(index)) continue;
    const root = reviewRoot(index);
    const members = reviewGroupsByRoot.get(root) ?? [];
    members.push(sorted[index]!.clientFileId);
    reviewGroupsByRoot.set(root, members);
  }

  const reviewSuggestions: GroupSuggestion[] = [...reviewGroupsByRoot.values()]
    .filter((members) => members.length > 1)
    .map((members) => {
      const orderedMembers = [...members].sort(compareByCodeUnits);
      const evidence = orderedMembers.flatMap((member) => reviewEvidenceByFileId.get(member) ?? []);
      return { memberFileIds: orderedMembers, confidence: "low" as const, evidence };
    });
  reviewSuggestions.sort((left, right) => compareByCodeUnits(left.memberFileIds[0]!, right.memberFileIds[0]!));

  return { suggestions, reviewSuggestions };
}
