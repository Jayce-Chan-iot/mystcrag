import type { BraceletDesignOutput } from "../contracts/legacy-design";
import {
  AiBeadLayoutCandidateSchema,
  type AiBeadLayoutCandidate
} from "../schemas/ai-bead-layout-candidate.schema";

export function legacyDesignToAiBeadLayoutCandidate(
  legacy: BraceletDesignOutput,
  beadProductIdByCrystalId: Readonly<Record<string, string>>
): AiBeadLayoutCandidate {
  let positionIndex = 0;
  const components = legacy.beads.flatMap((group) => {
    const beadProductId = beadProductIdByCrystalId[group.crystalId];
    if (beadProductId === undefined) {
      throw new Error(`No compatibility product mapping for crystal ${group.crystalId}`);
    }
    return Array.from({ length: group.count }, () => ({
      componentType: "BEAD" as const,
      positionIndex: positionIndex++,
      crystalId: group.crystalId,
      beadProductId,
      shape: "ROUND" as const,
      diameterMm: group.sizeMm,
      role: "MAIN" as const
    }));
  });

  return AiBeadLayoutCandidateSchema.parse({
    designName: legacy.designName,
    emotionTags: [],
    styleTags: [legacy.style],
    colorPalette: [],
    culturalInspiration: [],
    designStory: legacy.story,
    recommendationReasons: [],
    sourceTemplateIds: [],
    components
  });
}
