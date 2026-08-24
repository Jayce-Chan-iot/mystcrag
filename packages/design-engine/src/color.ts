/// <reference path="./culori.d.ts" />
import { oklch } from "culori";

/**
 * Canonical color taxonomy → representative hex, used for deterministic
 * color-harmony math (culori OKLCH). Multicolor maps to a neutral mid tone
 * so it neither anchors nor clashes.
 */
export const COLOR_HEX_BY_TAXONOMY_ID: Readonly<Record<string, string>> = {
  "color:white": "#f2f0eb",
  "color:purple": "#8a5bd6",
  "color:pink": "#e8a0b8",
  "color:red": "#c0392b",
  "color:orange": "#e67e22",
  "color:yellow": "#e6c229",
  "color:green": "#4c9a5f",
  "color:teal": "#2aa7a0",
  "color:blue": "#3f74c9",
  "color:gray": "#8d9199",
  "color:black": "#26282b",
  "color:brown": "#8b5a3c",
  "color:multicolor": "#a89ea6"
};

export type OklchColor = { l: number; c: number; h: number };

const oklchCache = new Map<string, OklchColor>();

export function taxonomyColorOklch(colorTag: string): OklchColor | undefined {
  const cached = oklchCache.get(colorTag);
  if (cached !== undefined) return cached;
  const hex = COLOR_HEX_BY_TAXONOMY_ID[colorTag];
  if (hex === undefined) return undefined;
  const parsed = oklch(hex);
  if (parsed === undefined) return undefined;
  const value = { l: parsed.l, c: parsed.c, h: parsed.h ?? 0 };
  oklchCache.set(colorTag, value);
  return value;
}

/** Shortest hue distance in degrees (0–180). */
export function hueDistance(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360 + 360) % 360);
  return Math.min(diff, 360 - diff);
}

/**
 * Pairwise harmony contribution: analogous hue spreads (≤60°) score highest,
 * complementary (~150–180°) earns a balanced middle score, and clashing
 * mid-range spreads are discounted. Chroma similarity adds a small bonus.
 */
export function pairHarmony(a: OklchColor, b: OklchColor): number {
  const hue = hueDistance(a.h, b.h);
  let score: number;
  if (hue <= 60) {
    score = 1 - hue / 120;
  } else if (hue >= 150) {
    score = 0.7;
  } else {
    score = 0.45;
  }
  const chromaGap = Math.abs(a.c - b.c);
  const lightnessGap = Math.abs(a.l - b.l);
  const balanceBonus = 0.1 * (1 - Math.min(1, chromaGap * 2)) +
    0.1 * (1 - Math.min(1, lightnessGap * 2));
  return Math.max(0, Math.min(1, score + balanceBonus));
}
