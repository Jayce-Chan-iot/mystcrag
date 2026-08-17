import type { PublicDesignV1 } from "@mystcrag/design-contract";

export const MIN_BRACELET_CIRCUMFERENCE_MM = 130;
export const MAX_BRACELET_CIRCUMFERENCE_MM = 200;

export type BraceletFitStatus = "TOO_SMALL" | "VALID" | "TOO_LARGE";

export type BraceletFit = {
  canComplete: boolean;
  circumferenceMm: number;
  circumferenceCmLabel: string;
  message: string | null;
  status: BraceletFitStatus;
};

export function inlineAccessoryLengthMm(
  accessory: Extract<PublicDesignV1["accessories"][number], { placementMode: "INLINE" }>
): number {
  return accessory.dimensions.widthMm ?? accessory.dimensions.diameterMm ?? 0;
}

export function calculateBraceletCircumferenceMm(design: PublicDesignV1): number {
  const beadLengthMm = design.beads.reduce((total, bead) => total + bead.diameterMm, 0);
  const inlineAccessoryLength = design.accessories.reduce(
    (total, accessory) => total + (accessory.placementMode === "INLINE" ? inlineAccessoryLengthMm(accessory) : 0),
    0
  );
  return beadLengthMm + inlineAccessoryLength;
}

export function evaluateBraceletFit(design: PublicDesignV1): BraceletFit {
  const circumferenceMm = calculateBraceletCircumferenceMm(design);
  const circumferenceCmLabel = (circumferenceMm / 10).toFixed(1);

  if (circumferenceMm < MIN_BRACELET_CIRCUMFERENCE_MM) {
    return {
      canComplete: false,
      circumferenceMm,
      circumferenceCmLabel,
      message: `珠子太少，当前 ${circumferenceCmLabel}cm，无法串成手串`,
      status: "TOO_SMALL"
    };
  }

  if (circumferenceMm > MAX_BRACELET_CIRCUMFERENCE_MM) {
    return {
      canComplete: false,
      circumferenceMm,
      circumferenceCmLabel,
      message: `手串过大，当前 ${circumferenceCmLabel}cm，请减少珠子`,
      status: "TOO_LARGE"
    };
  }

  return {
    canComplete: true,
    circumferenceMm,
    circumferenceCmLabel,
    message: null,
    status: "VALID"
  };
}
