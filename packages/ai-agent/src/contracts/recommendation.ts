import { z } from "zod";

import { CurrencySchema, IdentifierSchema, MillimeterSchema } from "@mystcrag/design-contract";

export const STANDARD_EMOTION_TAGS = [
  "calm",
  "focus",
  "confidence",
  "joy",
  "connection",
  "renewal"
] as const;

export const STANDARD_STYLE_TAGS = [
  "minimal",
  "eastern-contemporary",
  "romantic",
  "natural",
  "modern",
  "vintage"
] as const;

export const EmotionTagSchema = z.enum(STANDARD_EMOTION_TAGS);
export const StyleTagSchema = z.enum(STANDARD_STYLE_TAGS);

export const RecommendationRequestSchema = z.strictObject({
  answers: z.strictObject({
    emotionGoals: z.array(z.string().trim().min(1).max(80)).max(12),
    styleTags: z.array(z.string().trim().min(1).max(80)).max(12),
    colorTags: z.array(IdentifierSchema).max(12),
    freeText: z.string().trim().max(1_000).optional()
  }),
  currency: CurrencySchema,
  budgetMinor: z.number().int().safe().positive(),
  wristCircumferenceMm: MillimeterSchema.positive(),
  excludedBeadProductIds: z.array(IdentifierSchema).max(50).default([])
});

export type EmotionTag = z.infer<typeof EmotionTagSchema>;
export type StyleTag = z.infer<typeof StyleTagSchema>;
export type RecommendationRequest = z.infer<typeof RecommendationRequestSchema>;

export type BudgetBand = "ENTRY" | "CORE" | "PREMIUM";

export type PricingContext = {
  readonly currency: RecommendationRequest["currency"];
  readonly budgetBand: BudgetBand;
  readonly eligibleProductIds: readonly string[];
};
