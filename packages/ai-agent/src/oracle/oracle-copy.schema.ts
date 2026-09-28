import {
  IdentifierSchema,
  LocaleSchema,
  OracleCastDtoSchema,
  OracleDesignSignalSchema
} from "@mystcrag/design-contract";
import { z } from "zod";

export const OracleCopyInputSchema = z
  .strictObject({
    cast: OracleCastDtoSchema,
    signal: OracleDesignSignalSchema,
    locale: LocaleSchema
  })
  .superRefine((value, context) => {
    const moving = value.cast.movingLineIndices;
    const accents = value.signal.accentLinePositions;
    if (
      moving.length !== accents.length ||
      moving.some((position, index) => position !== accents[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["signal", "accentLinePositions"],
        message: "accent line positions must exactly match the cast moving lines"
      });
    }
  });

export const OracleInterpretationSchema = z.strictObject({
  headline: z.string().trim().min(1).max(48),
  summary: z.string().trim().min(1).max(240),
  keywords: z.array(z.string().trim().min(1).max(24)).length(3),
  designRationale: z.string().trim().min(1).max(240),
  disclaimer: z.string().trim().min(1).max(160)
});

export const OracleCopySourceSchema = z.strictObject({
  mode: z.enum(["PROVIDER", "DETERMINISTIC_FALLBACK"]),
  providerId: IdentifierSchema,
  providerVersion: z.string().trim().min(1).max(80),
  policyVersion: IdentifierSchema,
  contentVersion: IdentifierSchema,
  algorithmVersion: IdentifierSchema,
  ruleVersion: IdentifierSchema
});

export const OracleCopyResultSchema = z.strictObject({
  interpretation: OracleInterpretationSchema,
  source: OracleCopySourceSchema
});

export type OracleCopyInput = z.infer<typeof OracleCopyInputSchema>;
export type OracleInterpretation = z.infer<typeof OracleInterpretationSchema>;
export type OracleCopySource = z.infer<typeof OracleCopySourceSchema>;
export type OracleCopyResult = z.infer<typeof OracleCopyResultSchema>;
