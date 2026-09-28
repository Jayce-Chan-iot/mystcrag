import type { OracleTrigram } from "./types";

export type TrigramYangLines = readonly [boolean, boolean, boolean];

const TRIGRAM_BY_BOTTOM_TO_TOP_PATTERN: Readonly<Record<string, OracleTrigram>> = Object.freeze({
  "111": "HEAVEN",
  "110": "LAKE",
  "101": "FIRE",
  "100": "THUNDER",
  "011": "WIND",
  "010": "WATER",
  "001": "MOUNTAIN",
  "000": "EARTH"
});

export const TRIGRAMS = Object.freeze([
  "HEAVEN",
  "LAKE",
  "FIRE",
  "THUNDER",
  "WIND",
  "WATER",
  "MOUNTAIN",
  "EARTH"
] as const satisfies readonly OracleTrigram[]);

export function lookupTrigramByYangLines(lines: TrigramYangLines): OracleTrigram {
  const pattern = lines.map((isYang) => (isYang ? "1" : "0")).join("");
  const trigram = TRIGRAM_BY_BOTTOM_TO_TOP_PATTERN[pattern];
  if (trigram === undefined) {
    throw new Error(`unknown trigram pattern: ${pattern}`);
  }
  return trigram;
}
