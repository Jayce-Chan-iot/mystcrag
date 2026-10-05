import { z } from "zod";

import { IdentifierSchema, PositiveSafeIntegerSchema } from "./component.schema";
import { TarotSlotSchema } from "./tarot.schema";

export const PresentationLocaleSchema = z.enum(["zh-CN", "zh-TW", "en-US"]);

export const LocalizedPresentationRequestSchema = z.strictObject({
  locale: PresentationLocaleSchema
});

const PresentationHeadlineSchema = z.string().trim().min(1).max(48);
const PresentationSummarySchema = z.string().trim().min(1).max(240);
const PresentationLabelSchema = z.string().trim().min(1).max(160);
const PresentationCueTextSchema = z.string().trim().min(1).max(120);
const PresentationTitleSchema = z.string().trim().min(1).max(120);
const PresentationDescriptionSchema = z.string().trim().min(1).max(240);
const PresentationStorySchema = z.string().trim().min(1).max(2_000);

export const OraclePresentationCueKindSchema = z.enum(["COLOR", "RHYTHM", "ACCENT"]);

export const OraclePresentationCueSchema = z.strictObject({
  kind: OraclePresentationCueKindSchema,
  text: PresentationCueTextSchema
});

export const OraclePresentationMaterialSchema = z.strictObject({
  beadProductId: IdentifierSchema,
  role: IdentifierSchema,
  label: PresentationLabelSchema
});

export const OraclePresentationCardSchema = z.strictObject({
  designId: IdentifierSchema,
  title: PresentationTitleSchema,
  description: PresentationDescriptionSchema
});

export const OraclePresentationResponseSchema = z.strictObject({
  sessionId: IdentifierSchema,
  sourceRevision: PositiveSafeIntegerSchema,
  locale: PresentationLocaleSchema,
  headline: PresentationHeadlineSchema,
  summary: PresentationSummarySchema,
  cues: z.array(OraclePresentationCueSchema).min(1).max(12),
  materials: z.array(OraclePresentationMaterialSchema).min(1).max(24),
  cards: z.array(OraclePresentationCardSchema).min(1).max(3)
});

export const DesignPresentationMaterialLabelSchema = z.strictObject({
  beadProductId: IdentifierSchema,
  label: PresentationLabelSchema
});

export const DesignPresentationResponseSchema = z.strictObject({
  designId: IdentifierSchema,
  sourceRevision: PositiveSafeIntegerSchema,
  locale: PresentationLocaleSchema,
  title: PresentationTitleSchema,
  story: PresentationStorySchema,
  materialLabels: z.array(DesignPresentationMaterialLabelSchema).min(1).max(64)
});

export const TarotPresentationCardReflectionSchema = z.strictObject({
  slot: TarotSlotSchema,
  text: PresentationDescriptionSchema
});

export const TarotPresentationResponseSchema = z.strictObject({
  sessionId: IdentifierSchema,
  sourceRevision: PositiveSafeIntegerSchema,
  locale: PresentationLocaleSchema,
  headline: PresentationHeadlineSchema,
  summary: PresentationSummarySchema,
  cardReflections: z.array(TarotPresentationCardReflectionSchema).min(1).max(3),
  colorStory: PresentationDescriptionSchema,
  designRationale: PresentationDescriptionSchema,
  disclaimer: PresentationDescriptionSchema
});

export type PresentationLocale = z.infer<typeof PresentationLocaleSchema>;
export type LocalizedPresentationRequest = z.infer<typeof LocalizedPresentationRequestSchema>;
export type OraclePresentationCueKind = z.infer<typeof OraclePresentationCueKindSchema>;
export type OraclePresentationCue = z.infer<typeof OraclePresentationCueSchema>;
export type OraclePresentationMaterial = z.infer<typeof OraclePresentationMaterialSchema>;
export type OraclePresentationCard = z.infer<typeof OraclePresentationCardSchema>;
export type OraclePresentationResponse = z.infer<typeof OraclePresentationResponseSchema>;
export type DesignPresentationMaterialLabel = z.infer<typeof DesignPresentationMaterialLabelSchema>;
export type DesignPresentationResponse = z.infer<typeof DesignPresentationResponseSchema>;
export type TarotPresentationCardReflection = z.infer<typeof TarotPresentationCardReflectionSchema>;
export type TarotPresentationResponse = z.infer<typeof TarotPresentationResponseSchema>;