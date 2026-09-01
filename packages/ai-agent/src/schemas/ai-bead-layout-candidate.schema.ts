import { z } from "zod";

import {
  BeadRoleSchema,
  BeadShapeSchema,
  CulturalInspirationSchema,
  IdentifierSchema,
  MillimeterSchema,
  NonEmptyTextSchema,
  PositionIndexSchema
} from "@mystcrag/design-contract";

export const AiBeadCandidateSchema = z.strictObject({
  componentType: z.literal("BEAD"),
  positionIndex: PositionIndexSchema,
  crystalId: IdentifierSchema,
  beadProductId: IdentifierSchema,
  shape: BeadShapeSchema,
  diameterMm: MillimeterSchema.positive(),
  role: BeadRoleSchema
});

export const AiBeadLayoutCandidateSchema = z
  .strictObject({
    designName: z.string().trim().min(1).max(200),
    emotionTags: z.array(IdentifierSchema).max(30),
    styleTags: z.array(IdentifierSchema).max(30),
    colorPalette: z.array(z.string().trim().min(1).max(80)).max(20),
    culturalInspiration: z.array(CulturalInspirationSchema).max(20),
    designStory: z.string().trim().max(4_000),
    recommendationReasons: z.array(NonEmptyTextSchema).max(30),
    sourceTemplateIds: z.array(IdentifierSchema).max(30),
    components: z.array(AiBeadCandidateSchema).min(1)
  })
  .superRefine((candidate, context) => {
    const positions = candidate.components
      .map((component) => component.positionIndex)
      .sort((left, right) => left - right);
    if (new Set(positions).size !== positions.length) {
      context.addIssue({
        code: "custom",
        message: "AI candidate positions must be unique",
        path: ["components"]
      });
    }
    positions.forEach((position, index) => {
      if (position !== index) {
        context.addIssue({
          code: "custom",
          message: "AI candidate positions must start at zero and remain contiguous",
          path: ["components"]
        });
      }
    });
  });

export type AiBeadCandidate = z.infer<typeof AiBeadCandidateSchema>;
export type AiBeadLayoutCandidate = z.infer<typeof AiBeadLayoutCandidateSchema>;
