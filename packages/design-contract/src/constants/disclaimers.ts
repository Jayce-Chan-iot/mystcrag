export const DISCLAIMER_KEYS = [
  "CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT",
  "DESIGN_INSPIRATION_ONLY"
] as const;

export type DisclaimerKey = (typeof DISCLAIMER_KEYS)[number];
