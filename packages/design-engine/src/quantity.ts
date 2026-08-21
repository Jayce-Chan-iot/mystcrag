import { beadUnitLengthMm, type AllocatedProduct } from "./allocation.js";
import type { StockSnapshot } from "./types.js";

const MAIN_SHARE = 0.62;
const ACCENT_SHARE = 0.38;

export type QuantityPlan = {
  /** productId → bead count (always ≥ 1 per allocated product). */
  counts: ReadonlyMap<string, number>;
  totalBeadCount: number;
  assembledMaterialPathMm: number;
  deltaFromTargetMm: number;
};

function stockCap(stock: StockSnapshot | undefined, productId: string): number {
  return stock === undefined ? Number.POSITIVE_INFINITY : stock.get(productId) ?? 0;
}

/**
 * Deterministically fills the target inner circumference: one focal bead,
 * then main/accent counts by fixed share, then top-up rounds onto the main
 * bead while the smallest unit still fits. Stock caps each product count.
 * When a hard budget is set, trimming removes accent beads first (never the
 * focal, never below one bead per allocated product) until the cost fits.
 */
export function planQuantities(input: {
  targetInnerCircumferenceMm: number;
  beadGapMm: number;
  allocation: readonly AllocatedProduct[];
  stock?: StockSnapshot;
  maxBudgetMinor?: number;
}): QuantityPlan {
  const { targetInnerCircumferenceMm, beadGapMm, allocation, stock, maxBudgetMinor } = input;

  const byRole = (role: AllocatedProduct["role"]) =>
    allocation.find((entry) => entry.role === role);
  const focal = byRole("FOCAL");
  const main = byRole("MAIN");
  const accent = byRole("ACCENT");
  if (focal === undefined || main === undefined) {
    return {
      counts: new Map(),
      totalBeadCount: 0,
      assembledMaterialPathMm: 0,
      deltaFromTargetMm: -targetInnerCircumferenceMm
    };
  }

  const counts = new Map<string, number>();
  const addBead = (entry: AllocatedProduct): boolean => {
    const current = counts.get(entry.product.beadProductId) ?? 0;
    if (current >= stockCap(stock, entry.product.beadProductId)) return false;
    counts.set(entry.product.beadProductId, current + 1);
    return true;
  };

  addBead(focal);
  if (accent !== undefined) addBead(accent);

  const assembledLength = (): number => {
    let total = 0;
    let beadTotal = 0;
    for (const entry of allocation) {
      const count = counts.get(entry.product.beadProductId) ?? 0;
      total += count * beadUnitLengthMm(entry.product);
      beadTotal += count;
    }
    return total + beadTotal * beadGapMm;
  };

  const materialCost = (): number => {
    let total = 0;
    for (const entry of allocation) {
      const count = counts.get(entry.product.beadProductId) ?? 0;
      total += count * entry.product.unitPriceMinor;
    }
    return total;
  };

  const remaining = targetInnerCircumferenceMm - assembledLength();
  const mainBudget = remaining * MAIN_SHARE;
  const accentBudget = remaining * ACCENT_SHARE;

  const mainCap = Math.min(
    Math.max(1, Math.floor(mainBudget / (beadUnitLengthMm(main.product) + beadGapMm))),
    stockCap(stock, main.product.beadProductId)
  );
  for (let i = counts.get(main.product.beadProductId) ?? 0; i < mainCap; i += 1) {
    counts.set(main.product.beadProductId, i + 1);
  }

  if (accent !== undefined && accent.product.beadProductId !== main.product.beadProductId) {
    const accentCap = Math.min(
      Math.max(1, Math.floor(accentBudget / (beadUnitLengthMm(accent.product) + beadGapMm))),
      stockCap(stock, accent.product.beadProductId)
    );
    for (
      let i = counts.get(accent.product.beadProductId) ?? 0;
      i < accentCap;
      i += 1
    ) {
      counts.set(accent.product.beadProductId, i + 1);
    }
  }

  const topUpOrder = [main, accent ?? main];
  let progress = true;
  while (progress) {
    progress = false;
    for (const entry of topUpOrder) {
      const unit = beadUnitLengthMm(entry.product) + beadGapMm;
      const before = assembledLength();
      const withinBudget =
        maxBudgetMinor === undefined ||
        materialCost() + entry.product.unitPriceMinor <= maxBudgetMinor;
      if (before + unit <= targetInnerCircumferenceMm && withinBudget && addBead(entry)) {
        progress = true;
        break;
      }
    }
  }

  if (maxBudgetMinor !== undefined) {
    const trimOrder = [
      ...(accent !== undefined && accent.product.beadProductId !== focal.product.beadProductId
        ? [accent]
        : []),
      main
    ];
    let cost = materialCost();
    let trimmed = true;
    while (cost > maxBudgetMinor && trimmed) {
      trimmed = false;
      for (const entry of trimOrder) {
        const current = counts.get(entry.product.beadProductId) ?? 0;
        if (current <= 1) continue;
        counts.set(entry.product.beadProductId, current - 1);
        cost = materialCost();
        trimmed = true;
        break;
      }
    }
  }

  const assembled = assembledLength();
  let totalBeadCount = 0;
  for (const count of counts.values()) totalBeadCount += count;

  return {
    counts,
    totalBeadCount,
    assembledMaterialPathMm: Number(assembled.toFixed(3)),
    deltaFromTargetMm: Number((assembled - targetInnerCircumferenceMm).toFixed(3))
  };
}
