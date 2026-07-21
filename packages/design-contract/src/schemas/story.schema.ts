import { z } from "zod";

import { DISCLAIMER_KEYS } from "../constants/disclaimers";
import { IdentifierSchema, NonEmptyTextSchema } from "./component.schema";

export const CulturalInspirationSchema = z.strictObject({
  reference: NonEmptyTextSchema,
  inspiration: NonEmptyTextSchema,
  disclaimerKey: z.enum(DISCLAIMER_KEYS)
});

export const StoryV1Schema = z.strictObject({
  emotionTags: z.array(IdentifierSchema).max(30),
  styleTags: z.array(IdentifierSchema).max(30),
  colorPalette: z.array(z.string().trim().min(1).max(80)).max(20),
  culturalInspiration: z.array(CulturalInspirationSchema).max(20),
  designStory: z.string().trim().max(4_000),
  recommendationReasons: z.array(NonEmptyTextSchema).max(30),
  sourceTemplateIds: z.array(IdentifierSchema).max(30)
});

export type CulturalInspiration = z.infer<typeof CulturalInspirationSchema>;
export type StoryV1 = z.infer<typeof StoryV1Schema>;
