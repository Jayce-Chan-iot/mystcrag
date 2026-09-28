import {
  IdentifierSchema,
  LocaleSchema,
  OracleCastDtoSchema,
  OracleDesignSignalSchema,
  OracleInterpretationSchema as ContractOracleInterpretationSchema
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
  interpretation: ContractOracleInterpretationSchema,
  source: OracleCopySourceSchema
});

export type OracleCopyInput = z.infer<typeof OracleCopyInputSchema>;
export type OracleCopySource = z.infer<typeof OracleCopySourceSchema>;
export type OracleCopyResult = z.infer<typeof OracleCopyResultSchema>;

export { OracleInterpretationSchema } from "@mystcrag/design-contract";
export type { OracleInterpretation } from "@mystcrag/design-contract";
