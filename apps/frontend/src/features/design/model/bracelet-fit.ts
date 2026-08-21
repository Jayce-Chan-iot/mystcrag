import type { PublicDesignV1 } from "@mystcrag/design-contract";
import { evaluateBraceletFit as evaluateEngineFit } from "@mystcrag/bracelet-engine";

export const MIN_BRACELET_CIRCUMFERENCE_MM = 130;
export const MAX_BRACELET_CIRCUMFERENCE_MM = 200;

export type BraceletFitStatus = "TOO_SMALL" | "VALID" | "TOO_LARGE";

export type BraceletFit = {
  canComplete: boolean;
  circumferenceMm: number;
  circumferenceCmLabel: string;
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

export function evaluateBraceletFit(design: PublicDesignV1): BraceletFit {
  const circumferenceMm = calculateBraceletCircumferenceMm(design);
  const circumferenceCmLabel = (circumferenceMm / 10).toFixed(1);
  const engineFit = evaluateEngineFit({
    assembledMaterialPathMm: circumferenceMm,
    elasticAllowanceMm: design.bracelet.elasticAllowanceMm,
    targetInnerCircumferenceMm: design.bracelet.targetInnerCircumferenceMm,
    userWristCircumferenceMm: design.bracelet.wristCircumferenceMm
  });
  const shared = {
    targetInnerCircumferenceMm: engineFit.targetInnerCircumferenceMm,
    userWristCircumferenceMm: engineFit.userWristCircumferenceMm
  };

  if (circumferenceMm < MIN_BRACELET_CIRCUMFERENCE_MM) {
    return {
      canComplete: false,
      circumferenceMm,
      circumferenceCmLabel,
      message: `珠子太少，当前 ${circumferenceCmLabel}cm，无法串成手串`,
      status: "TOO_SMALL",
      ...shared
    };
  }

  if (circumferenceMm > MAX_BRACELET_CIRCUMFERENCE_MM) {
    return {
      canComplete: false,
      circumferenceMm,
      circumferenceCmLabel,
      message: `手串过大，当前 ${circumferenceCmLabel}cm，请减少珠子`,
      status: "TOO_LARGE",
      ...shared
    };
  }

  return {
    canComplete: true,
    circumferenceMm,
    circumferenceCmLabel,
    message: null,
    status: "VALID",
    ...shared
  };
}
