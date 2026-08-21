import {
  IdentifierSchema,
  LocaleSchema,
  TarotOrientationSchema,
  TarotSlotSchema,
  TarotThemeSchema
} from "@mystcrag/design-contract";
import { z } from "zod";

export const TarotInterpretationSchema = z.strictObject({
  headline: z.string().trim().min(1).max(48),
  summary: z.string().trim().min(1).max(240),
  cardReflections: z
    .array(
      z.strictObject({
        slot: TarotSlotSchema,
        reflection: z.string().trim().min(1).max(160)
      })
    )
    .min(1)
    .max(3),
  designRationale: z.string().trim().min(1).max(240),
  disclaimer: z.string().trim().min(1).max(160)
});

export const TarotCopyInputSchema = z.strictObject({
  cards: z
    .array(
      z.strictObject({
        slot: TarotSlotSchema,
        nameZh: z.string().trim().min(1).max(120),
        nameEn: z.string().trim().min(1).max(120),
        orientation: TarotOrientationSchema,
        keywords: z.array(IdentifierSchema).min(1).max(12)
      })
    )
    .min(1)
    .max(3),
  theme: TarotThemeSchema,
  palette: z.strictObject({
    primary: IdentifierSchema,
    support: IdentifierSchema,
    accent: IdentifierSchema
  }),
  materials: z
    .array(
      z.strictObject({
        displayName: z.string().trim().min(1).max(160),
        crystalName: z.string().trim().min(1).max(160),
        colorTags: z.array(IdentifierSchema).min(1).max(10)
      })
    )
    .min(1)
    .max(12),
  locale: LocaleSchema,
  question: z.string().trim().min(1).max(120).optional()
});

export const TarotCopySourceSchema = z.strictObject({
  mode: z.enum(["PROVIDER", "DETERMINISTIC_FALLBACK"]),
  providerId: IdentifierSchema,
  providerVersion: z.string().trim().min(1).max(80),
  policyVersion: IdentifierSchema
});

export const TarotCopyResultSchema = z.strictObject({
  interpretation: TarotInterpretationSchema,
  source: TarotCopySourceSchema
});

export type TarotInterpretation = z.infer<typeof TarotInterpretationSchema>;
export type TarotCopyInput = z.infer<typeof TarotCopyInputSchema>;
export type TarotCopySource = z.infer<typeof TarotCopySourceSchema>;
export type TarotCopyResult = z.infer<typeof TarotCopyResultSchema>;
