export type MaterialQuality = "LOW" | "MEDIUM" | "HIGH";

export type MaterialQualityProfile = {
  readonly quality: MaterialQuality;
  readonly transmission: number;
  readonly roughness: number;
  readonly environmentIntensity: number;
  readonly indexOfRefraction: number;
  readonly samples: number;
  readonly maxDpr: number;
};

export const MATERIAL_QUALITY_PROFILES: Readonly<Record<MaterialQuality, MaterialQualityProfile>> = {
  LOW: {
    quality: "LOW",
    transmission: 0.25,
    roughness: 0.34,
    environmentIntensity: 0.45,
    indexOfRefraction: 1.34,
    samples: 1,
    maxDpr: 1.25
  },
  MEDIUM: {
    quality: "MEDIUM",
    transmission: 0.62,
    roughness: 0.2,
    environmentIntensity: 0.8,
    indexOfRefraction: 1.42,
    samples: 4,
    maxDpr: 1.75
  },
  HIGH: {
    quality: "HIGH",
    transmission: 0.88,
    roughness: 0.1,
    environmentIntensity: 1.1,
    indexOfRefraction: 1.5,
    samples: 8,
    maxDpr: 2
  }
};

export function resolveMaterialQuality(
  requested: MaterialQuality | undefined,
  isMobile: boolean
): MaterialQuality {
  if (isMobile && (requested === undefined || requested === "HIGH")) return "LOW";
  return requested ?? "MEDIUM";
}

export function isMobileViewport(width: number, coarsePointer = false): boolean {
  return width < 768 || coarsePointer;
}
