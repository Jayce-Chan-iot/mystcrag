import type { PublicDesignV1 } from "@mystcrag/design-contract";
import { evaluateBraceletFit as evaluateEngineFit } from "@mystcrag/bracelet-engine";

export const MIN_BRACELET_CIRCUMFERENCE_MM = 130;
export const MAX_BRACELET_CIRCUMFERENCE_MM = 200;

export type BraceletFitStatus = "TOO_SMALL" | "VALID" | "TOO_LARGE";

export type BraceletFit = {
  assembledMaterialPathMm: number;
  canComplete: boolean;
  circumferenceCmLabel: string;
  circumferenceMm: number;
  deltaFromTargetMm: number;
  elasticAllowanceMm: number;
  estimatedBraceletFitMm: number;
  message: string | null;
  status: BraceletFitStatus;
  targetInnerCircumferenceMm: number;
  userWristCircumferenceMm: number;
};

export function inlineAccessoryLengthMm(
  accessory: Extract<PublicDesignV1["accessories"][number], { placementMode: "INLINE" }>
): number {
  return accessory.lengthAlongStringMm ?? accessory.dimensions.widthMm ?? accessory.dimensions.diameterMm ?? 0;
}

export function beadLengthMm(bead: PublicDesignV1["beads"][number]): number {
  return bead.lengthAlongStringMm ?? bead.diameterMm;
}

export function calculateBraceletCircumferenceMm(design: PublicDesignV1): number {
  const beadLengthTotal = design.beads.reduce((total, bead) => total + beadLengthMm(bead), 0);
  const inlineAccessoryLength = design.accessories.reduce(
    (total, accessory) => total + (accessory.placementMode === "INLINE" ? inlineAccessoryLengthMm(accessory) : 0),
    0
  );
  return beadLengthTotal + inlineAccessoryLength;
}

export function formatEstimatedFitCm(circumferenceMm: number): string {
  if (!Number.isFinite(circumferenceMm) || circumferenceMm < 0) {
    throw new RangeError("circumferenceMm must be a non-negative finite number");
  }
  const roundedMillimetres = Math.floor(circumferenceMm + 0.5);
  return (roundedMillimetres / 10).toFixed(1);
}

function fitMessage(status: BraceletFitStatus): string | null {
  if (status === "VALID") return null;
  return `常见建议范围 ${formatEstimatedFitCm(MIN_BRACELET_CIRCUMFERENCE_MM)}–${formatEstimatedFitCm(MAX_BRACELET_CIRCUMFERENCE_MM)}cm，不影响完成设计`;
}

export function evaluateBraceletFit(design: PublicDesignV1): BraceletFit {
  const assembledMaterialPathMm = calculateBraceletCircumferenceMm(design);
  const circumferenceCmLabel = formatEstimatedFitCm(assembledMaterialPathMm);
  const engineFit = evaluateEngineFit({
    assembledMaterialPathMm,
    elasticAllowanceMm: design.bracelet.elasticAllowanceMm,
    maxCircumferenceMm: MAX_BRACELET_CIRCUMFERENCE_MM,
    minCircumferenceMm: MIN_BRACELET_CIRCUMFERENCE_MM,
    targetInnerCircumferenceMm: design.bracelet.targetInnerCircumferenceMm,
    userWristCircumferenceMm: design.bracelet.wristCircumferenceMm
  });

  return {
    assembledMaterialPathMm: engineFit.assembledMaterialPathMm,
    canComplete: true,
    circumferenceCmLabel,
    circumferenceMm: engineFit.assembledMaterialPathMm,
    deltaFromTargetMm: engineFit.deltaFromTargetMm,
    elasticAllowanceMm: engineFit.elasticAllowanceMm,
    estimatedBraceletFitMm: engineFit.estimatedBraceletFitMm,
    message: fitMessage(engineFit.status),
    status: engineFit.status,
    targetInnerCircumferenceMm: engineFit.targetInnerCircumferenceMm,
    userWristCircumferenceMm: engineFit.userWristCircumferenceMm
  };
}
