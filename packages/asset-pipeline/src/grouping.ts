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
  confidence: "high" | "low";
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
 * next (exactly one original ARW candidate and one original JPEG candidate
 * per stem — ambiguous stems never merge on the file name, in the stem stage
 * or in the visual stage), and remaining neighbors merge only when visual
 * thresholds and capture proximity agree. Borderline pairs never auto-merge —
 * they surface as low-confidence review suggestions carrying their similarity
 * evidence so the UI can explain the proposal. Suggestions and their evidence
 * are fully deterministic and independent of input order.
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
  const shaKinds = new Map<string, string>();
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
    const knownKind = shaKinds.get(candidate.sha256);
    if (knownKind !== undefined && knownKind !== candidate.kind) {
      throw new Error(
        `One SHA-256 digest cannot belong to two different kinds: ${candidate.sha256} appears as both ${knownKind} and ${candidate.kind}`
      );
    }
    shaKinds.set(candidate.sha256, candidate.kind);
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
  const n = sorted.length;
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

  // Stem buckets are counted on the ORIGINAL candidates before any merge:
  // exact duplicates fold into one component, so component counts would
  // falsely report "one ARW" for two identical ARWs and let a stem edge
  // smuggle their JPEG into the duplicate group. A stem is ambiguous when it
  // holds more than one original ARW candidate or more than one original
  // JPEG candidate — repeated camera filenames must not fuse unrelated shots.
  const stemBuckets = new Map<string, { raws: number[]; jpegs: number[] }>();
  for (let index = 0; index < n; index += 1) {
    const candidateAt = sorted[index]!;
    if (candidateAt.kind !== "ARW" && candidateAt.kind !== "JPEG") continue;
    const stem = stemOf(candidateAt.relativePath);
    const bucket = stemBuckets.get(stem) ?? { raws: [], jpegs: [] };
    if (candidateAt.kind === "ARW") bucket.raws.push(index);
    else bucket.jpegs.push(index);
    stemBuckets.set(stem, bucket);
  }
  const isAmbiguousStem = (relativePath: string): boolean => {
    const bucket = stemBuckets.get(stemOf(relativePath));
    if (bucket === undefined) return false;
    return bucket.raws.length > 1 || bucket.jpegs.length > 1;
  };

  // Component ambiguity flags, aggregated at the component root. An ARW (or
  // JPEG) whose stem bucket is ambiguous may never share a component with the
  // opposite kind: its true counterpart is undecided, so ANY opposite-kind
  // member — same stem or bridged through a different stem — would smuggle a
  // pairing decision the stem stage refused to make.
  const FLAG_HAS_ARW = 1;
  const FLAG_HAS_JPEG = 2;
  const FLAG_ARW_AMBIGUOUS_STEM = 4;
  const FLAG_JPEG_AMBIGUOUS_STEM = 8;
  const memberFlags = sorted.map((candidate) => {
    if (candidate.kind === "ARW") {
      return isAmbiguousStem(candidate.relativePath) ? FLAG_HAS_ARW | FLAG_ARW_AMBIGUOUS_STEM : FLAG_HAS_ARW;
    }
    if (candidate.kind === "JPEG") {
      return isAmbiguousStem(candidate.relativePath) ? FLAG_HAS_JPEG | FLAG_JPEG_AMBIGUOUS_STEM : FLAG_HAS_JPEG;
    }
    return 0;
  });
  const compFlags = [...memberFlags];
  const compMembers: number[][] = sorted.map((_, index) => [index]);

  const forbiddenUnion = (leftRoot: number, rightRoot: number): boolean => {
    const a = compFlags[leftRoot] ?? 0;
    const b = compFlags[rightRoot] ?? 0;
    return (
      ((a & FLAG_ARW_AMBIGUOUS_STEM) !== 0 && (b & FLAG_HAS_JPEG) !== 0) ||
      ((a & FLAG_JPEG_AMBIGUOUS_STEM) !== 0 && (b & FLAG_HAS_ARW) !== 0) ||
      ((b & FLAG_ARW_AMBIGUOUS_STEM) !== 0 && (a & FLAG_HAS_JPEG) !== 0) ||
      ((b & FLAG_JPEG_AMBIGUOUS_STEM) !== 0 && (a & FLAG_HAS_ARW) !== 0)
    );
  };

  const evidenceByFileId = new Map<string, GroupSimilarityEvidence[]>();
  const record = (evidence: GroupSimilarityEvidence): void => {
    const list = evidenceByFileId.get(evidence.fileId) ?? [];
    list.push(evidence);
    evidenceByFileId.set(evidence.fileId, list);
  };

  const union = (leftIndex: number, rightIndex: number, evidence: GroupSimilarityEvidence): boolean => {
    const leftRoot = find(leftIndex);
    const rightRoot = find(rightIndex);
    if (leftRoot === rightRoot) return false;
    parent[rightRoot] = leftRoot;
    compFlags[leftRoot] = (compFlags[leftRoot] ?? 0) | (compFlags[rightRoot] ?? 0);
    for (const member of compMembers[rightRoot] ?? []) {
      compMembers[leftRoot]!.push(member);
    }
    record(evidence);
    return true;
  };

  const sameDirectory = (left: GroupingCandidate, right: GroupingCandidate): boolean =>
    directoryOf(left.relativePath) === directoryOf(right.relativePath);

  // 1. Exact duplicates collapse. Identical bytes always decode to one kind,
  // so a digest seen under two different kinds is a data integrity error,
  // never a merge — the archive would store one payload under two kinds.
  for (let left = 0; left < n; left += 1) {
    for (let right = left + 1; right < n; right += 1) {
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
        sameDirectory: sameDirectory(a, b),
        confidence: "high"
      });
    }
  }

  // 2. Same-stem RAW/JPEG pairing (different digests only). A Sony burst
  // stores the ARW and its in-camera JPEG under one stem, so a stem pairs
  // ONLY when the ORIGINAL candidate set holds exactly one original ARW
  // candidate and one original JPEG candidate — the same conservative 1+1
  // rule pairRawAndJpeg enforces. Both members of a 1+1 bucket are singletons
  // at this stage, so this merge can never introduce an ambiguity violation.
  for (const { raws, jpegs } of stemBuckets.values()) {
    if (raws.length !== 1 || jpegs.length !== 1) continue;

    const jpegIndex = jpegs[0]!;
    const rawIndex = raws[0]!;
    union(rawIndex, jpegIndex, {
      fileId: sorted[rawIndex]!.clientFileId,
      relatedFileId: sorted[jpegIndex]!.clientFileId,
      exactDuplicateOf: null,
      stemPairedWith: sorted[jpegIndex]!.clientFileId,
      dHashDistance: null,
      histogramDistance: null,
      captureGapMs: null,
      sameDirectory: sameDirectory(sorted[rawIndex]!, sorted[jpegIndex]!),
      confidence: "high"
    });
  }

  // 3a. Confident visual merges: complete-link clustering over precomputed
  // confident pairs. A cross-kind pair from an ambiguous same-stem set never
  // merges here — on either side of the pair — and neither does any merge
  // that would place an ambiguous-stem ARW (or JPEG) into a component holding
  // the opposite kind. Every pair across the two components must itself be
  // confident, so A–B and B–C confident edges never fuse a group whose A–C
  // edge disagrees. The scan repeats until a full pass merges nothing, which
  // makes the fixed candidate order the only input to the outcome.
  const ambiguousCrossKind = (a: GroupingCandidate, b: GroupingCandidate): boolean => {
    const aRawJpeg = a.kind === "ARW" || a.kind === "JPEG";
    const bRawJpeg = b.kind === "ARW" || b.kind === "JPEG";
    if (!aRawJpeg || !bRawJpeg || a.kind === b.kind) return false;
    return isAmbiguousStem(a.relativePath) || isAmbiguousStem(b.relativePath);
  };

  const confidentPair: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  for (let left = 0; left < n; left += 1) {
    const a = sorted[left]!;
    for (let right = left + 1; right < n; right += 1) {
      const b = sorted[right]!;
      if (a.dHash === null || b.dHash === null || a.histogram === null || b.histogram === null) continue;
      if (ambiguousCrossKind(a, b)) continue;
      if (hammingDistance(a.dHash, b.dHash) > thresholds.dHashConfident) continue;
      if (histogramDistance(a.histogram, b.histogram) > thresholds.histogramConfident) continue;
      const captureGapMs =
        a.capturedAtMs !== null && b.capturedAtMs !== null
          ? Math.abs(a.capturedAtMs - b.capturedAtMs)
          : null;
      if (captureGapMs === null || captureGapMs > thresholds.captureGapConfidentMs) continue;
      confidentPair[left]![right] = true;
    }
  }

  const pairIsConfident = (x: number, y: number): boolean =>
    x === y || (x < y ? confidentPair[x]![y]! : confidentPair[y]![x]!);

  const completeLinkAllows = (leftRoot: number, rightRoot: number): boolean => {
    for (const x of compMembers[leftRoot] ?? []) {
      for (const y of compMembers[rightRoot] ?? []) {
        if (!pairIsConfident(x, y)) return false;
      }
    }
    return true;
  };

  for (let mergedInPass = true; mergedInPass; ) {
    mergedInPass = false;
    for (let left = 0; left < n; left += 1) {
      for (let right = left + 1; right < n; right += 1) {
        if (!confidentPair[left]![right]) continue;
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot === rightRoot) continue;
        if (forbiddenUnion(leftRoot, rightRoot)) continue;
        if (!completeLinkAllows(leftRoot, rightRoot)) continue;
        union(left, right, {
          fileId: sorted[right]!.clientFileId,
          relatedFileId: sorted[left]!.clientFileId,
          exactDuplicateOf: null,
          stemPairedWith: null,
          dHashDistance: hammingDistance(sorted[left]!.dHash!, sorted[right]!.dHash!),
          histogramDistance: histogramDistance(sorted[left]!.histogram!, sorted[right]!.histogram!),
          captureGapMs: Math.abs(sorted[left]!.capturedAtMs! - sorted[right]!.capturedAtMs!),
          sameDirectory: sameDirectory(sorted[left]!, sorted[right]!),
          confidence: "high"
        });
        mergedInPass = true;
      }
    }
  }

  // 3b. Borderline pairs: visually near, but signals did not all agree.
  // Only items that are still singletons participate, so confident groups
  // never leak into review suggestions. Each review group keeps a spanning
  // tree of explanation edges — one edge recorded per actual merge — so
  // evidence grows linearly with the number of files instead of quadratically.
  const componentSizes = new Map<number, number>();
  for (let index = 0; index < n; index += 1) {
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

  for (let left = 0; left < n; left += 1) {
    for (let right = left + 1; right < n; right += 1) {
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

      const leftRoot = reviewRoot(left);
      const rightRoot = reviewRoot(right);
      if (leftRoot === rightRoot) continue;

      recordReview({
        fileId: b.clientFileId,
        relatedFileId: a.clientFileId,
        exactDuplicateOf: null,
        stemPairedWith: null,
        dHashDistance,
        histogramDistance: histogramDelta,
        captureGapMs,
        sameDirectory: sameDirectory(a, b),
        confidence: "low"
      });
      reviewParent.set(rightRoot, leftRoot);
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
