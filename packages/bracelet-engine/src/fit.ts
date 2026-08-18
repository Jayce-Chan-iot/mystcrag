import type { BraceletFitInput, BraceletFitResult } from "./types.js";

export function evaluateBraceletFit(input: BraceletFitInput): BraceletFitResult {
  const min = input.minCircumferenceMm ?? 130;
  const max = input.maxCircumferenceMm ?? 200;
  const values = [input.assembledMaterialPathMm, input.elasticAllowanceMm, input.targetInnerCircumferenceMm, input.userWristCircumferenceMm, min, max];
  if (values.some((value) => !Number.isFinite(value) || value < 0) || min > max) throw new Error("INVALID_FIT_INPUT");
  const estimatedBraceletFitMm = input.assembledMaterialPathMm;
  return {
    ...input,
    deltaFromTargetMm: estimatedBraceletFitMm - input.targetInnerCircumferenceMm,
    estimatedBraceletFitMm,
    status: estimatedBraceletFitMm < min ? "TOO_SMALL" : estimatedBraceletFitMm > max ? "TOO_LARGE" : "VALID"
  };
}
