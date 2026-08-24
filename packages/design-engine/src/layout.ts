import type { BeadV1, LayoutStrategy } from "@mystcrag/design-contract";

import type { AllocatedProduct, BeadRole } from "./allocation.js";
import { taxonomyColorOklch } from "./color.js";
import type { CatalogProduct } from "./types.js";

export const LAYOUT_STRATEGIES: readonly LayoutStrategy[] = [
  "SYMMETRIC_BALANCE",
  "CENTER_FOCAL",
  "REPEAT_RHYTHM",
  "LOW_CONTRAST_FLOW"
];

type BeadInstance = { product: CatalogProduct; role: BeadRole };

function expandInstances(
  allocation: readonly AllocatedProduct[],
  counts: ReadonlyMap<string, number>
): BeadInstance[] {
  const instances: BeadInstance[] = [];
  for (const entry of allocation) {
    const count = counts.get(entry.product.beadProductId) ?? 0;
    for (let i = 0; i < count; i += 1) {
      instances.push({ product: entry.product, role: entry.role });
    }
  }
  return instances;
}

function primaryLightness(product: CatalogProduct): number {
  const tag = product.colorTags[0];
  if (tag === undefined) return 0.5;
  return taxonomyColorOklch(tag)?.l ?? 0.5;
}

function takeRole(pool: BeadInstance[], role: BeadRole): BeadInstance | undefined {
  const index = pool.findIndex((instance) => instance.role === role);
  if (index === -1) return undefined;
  const [instance] = pool.splice(index, 1);
  return instance;
}

function takeAny(pool: BeadInstance[]): BeadInstance | undefined {
  return pool.shift();
}

/**
 * [a ... m f m ... a] — mirrored wings built from role pairs; odd-count
 * leftovers cluster beside the focal (the visually distinct core), so every
 * outer position i mirrors position len-1-i on the same product.
 */
function symmetricBalance(instances: BeadInstance[]): BeadInstance[] {
  const pool = [...instances];
  const focal = takeRole(pool, "FOCAL") ?? takeAny(pool);
  if (focal === undefined) return [];

  const sideA: BeadInstance[] = [];
  const sideB: BeadInstance[] = [];
  const leftovers: BeadInstance[] = [];
  let preferMain = true;

  while (pool.length > 0) {
    const roleOrder: BeadRole[] = preferMain ? ["MAIN", "ACCENT"] : ["ACCENT", "MAIN"];
    let chosen: BeadRole | undefined;
    for (const role of roleOrder) {
      if (pool.filter((instance) => instance.role === role).length >= 2) {
        chosen = role;
        break;
      }
    }
    if (chosen === undefined) {
      leftovers.push(...pool.splice(0, pool.length));
      break;
    }
    const first = takeRole(pool, chosen);
    const second = takeRole(pool, chosen);
    if (first === undefined || second === undefined) break;
    sideA.push(first);
    sideB.push(second);
    preferMain = !preferMain;
  }

  return [...sideA, ...leftovers, focal, ...[...sideB].reverse()];
}

/** [m ... a f a ... m] — focal cluster at center, main bead wings. */
function centerFocal(instances: BeadInstance[]): BeadInstance[] {
  const pool = [...instances];
  const focal = takeRole(pool, "FOCAL") ?? takeAny(pool);
  if (focal === undefined) return [];
  const accentA = takeRole(pool, "ACCENT") ?? takeAny(pool);
  const accentB = takeRole(pool, "ACCENT") ?? takeAny(pool);

  const mains: BeadInstance[] = [];
  while (pool.length > 0) {
    const next = takeRole(pool, "MAIN") ?? takeRole(pool, "ACCENT") ?? takeAny(pool);
    if (next === undefined) break;
    mains.push(next);
  }

  const half = Math.floor(mains.length / 2);
  const center = [
    ...(accentA !== undefined ? [accentA] : []),
    focal,
    ...(accentB !== undefined ? [accentB] : [])
  ];
  return [...mains.slice(0, half), ...center, ...mains.slice(half)];
}

/** [m a m m] × n with the focal inserted at regular intervals. */
function repeatRhythm(instances: BeadInstance[]): BeadInstance[] {
  const pool = [...instances];
  const focals: BeadInstance[] = [];
  let focal = takeRole(pool, "FOCAL");
  while (focal !== undefined) {
    focals.push(focal);
    focal = takeRole(pool, "FOCAL");
  }

  const others: BeadInstance[] = [];
  while (pool.length > 0) {
    const next = takeRole(pool, "MAIN") ?? takeRole(pool, "ACCENT") ?? takeAny(pool);
    if (next === undefined) break;
    others.push(next);
  }

  if (others.length === 0) return focals;

  const rhythmUnit = 4;
  const focalInterval = Math.max(1, Math.ceil(others.length / Math.max(1, focals.length)));
  const sequence: BeadInstance[] = [];
  let focalIndex = 0;
  others.forEach((instance, index) => {
    sequence.push(instance);
    const isCycleEnd = (index + 1) % rhythmUnit === 0;
    const isFocalSlot = (index + 1) % focalInterval === 0;
    if (isCycleEnd || isFocalSlot) {
      const nextFocal = focals[focalIndex];
      if (nextFocal !== undefined) {
        sequence.push(nextFocal);
        focalIndex += 1;
      }
    }
  });
  while (focalIndex < focals.length) {
    sequence.push(focals[focalIndex]!);
    focalIndex += 1;
  }
  return sequence;
}

/** Beads sorted into a lightness gradient (dark → light → dark). */
function lowContrastFlow(instances: BeadInstance[]): BeadInstance[] {
  const sorted = [...instances].sort((a, b) => {
    const delta = primaryLightness(a.product) - primaryLightness(b.product);
    if (Math.abs(delta) > 1e-9) return delta;
    if (a.product.beadProductId !== b.product.beadProductId) {
      return a.product.beadProductId < b.product.beadProductId ? -1 : 1;
    }
    return 0;
  });
  const half = Math.ceil(sorted.length / 2);
  const ascending = sorted.slice(0, half);
  const descending = [...sorted.slice(half)].reverse();
  return [...ascending, ...descending];
}

/**
 * Orders the counted bead instances into a position sequence per strategy.
 * All strategies are pure and deterministic; every allocated bead appears
 * exactly once.
 */
export function layoutSequence(input: {
  strategy: LayoutStrategy;
  allocation: readonly AllocatedProduct[];
  counts: ReadonlyMap<string, number>;
}): BeadInstance[] {
  const instances = expandInstances(input.allocation, input.counts);
  switch (input.strategy) {
    case "SYMMETRIC_BALANCE":
      return symmetricBalance(instances);
    case "CENTER_FOCAL":
      return centerFocal(instances);
    case "REPEAT_RHYTHM":
      return repeatRhythm(instances);
    case "LOW_CONTRAST_FLOW":
      return lowContrastFlow(instances);
  }
}

export function toBeadV1Sequence(
  sequence: readonly BeadInstance[],
  options: { idPrefix: string }
): BeadV1[] {
  return sequence.map((instance, index) => ({
    componentId: `${options.idPrefix}-bead-${index}`,
    positionIndex: index,
    beadProductId: instance.product.beadProductId,
    crystalId: instance.product.crystalId,
    materialKey: instance.product.materialKey,
    shape: instance.product.shape,
    diameterMm: instance.product.diameterMm,
    ...(instance.product.lengthAlongStringMm !== undefined
      ? { lengthAlongStringMm: instance.product.lengthAlongStringMm }
      : {}),
    quantity: 1 as const,
    role: instance.role,
    modelAssetKey: instance.product.modelAssetKey,
    textureAssetKey: instance.product.textureAssetKey,
    unitPriceMinor: instance.product.unitPriceMinor
  }));
}

export type { BeadInstance };
