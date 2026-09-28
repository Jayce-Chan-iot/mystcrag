import { z } from "zod";

import {
  IdentifierSchema,
  PositiveSafeIntegerSchema
} from "./component.schema";
import { CurrencySchema, IsoDateTimeSchema, LocaleSchema } from "./metadata.schema";
import { PublicDesignV1Schema } from "./public-design.schema";
import { OracleCandidateDirectionSchema } from "./provenance.schema";

export const OracleLineValueSchema = z.union([
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9)
]);

export const OracleTrigramSchema = z.enum([
  "HEAVEN",
  "LAKE",
  "FIRE",
  "THUNDER",
  "WIND",
  "WATER",
  "MOUNTAIN",
  "EARTH"
]);

export const OracleHexagramDtoSchema = z.strictObject({
  number: z.number().int().min(1).max(64),
  nameZh: z.string().trim().min(1).max(16),
  lowerTrigram: OracleTrigramSchema,
  upperTrigram: OracleTrigramSchema
});

const OracleLinesSchema = z.tuple([
  OracleLineValueSchema,
  OracleLineValueSchema,
  OracleLineValueSchema,
  OracleLineValueSchema,
  OracleLineValueSchema,
  OracleLineValueSchema
]);

const OracleMovingLineIndicesSchema = z
  .array(z.number().int().min(1).max(6))
  .max(6)
  .superRefine((indices, context) => {
    if (new Set(indices).size !== indices.length) {
      context.addIssue({ code: "custom", message: "moving line indices must be unique" });
    }
    if (indices.some((value, index) => index > 0 && value <= indices[index - 1]!)) {
      context.addIssue({ code: "custom", message: "moving line indices must be bottom-to-top" });
    }
  });

export const OracleCastDtoSchema = z
  .strictObject({
    lines: OracleLinesSchema,
    movingLineIndices: OracleMovingLineIndicesSchema,
    primaryHexagram: OracleHexagramDtoSchema,
    transformedHexagram: OracleHexagramDtoSchema.optional(),
    algorithm: z.strictObject({
      name: z.literal("THREE_COIN"),
      version: IdentifierSchema
    })
  })
  .superRefine((cast, context) => {
    const expectedMovingLineIndices = cast.lines.flatMap((value, index) =>
      value === 6 || value === 9 ? [index + 1] : []
    );
    if (
      expectedMovingLineIndices.length !== cast.movingLineIndices.length ||
      expectedMovingLineIndices.some((position, index) => cast.movingLineIndices[index] !== position)
    ) {
      context.addIssue({
        code: "custom",
        path: ["movingLineIndices"],
        message: "moving line indices must exactly match 6 and 9 line values"
      });
    }
    if (expectedMovingLineIndices.length === 0 && cast.transformedHexagram !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["transformedHexagram"],
        message: "static casts cannot expose a transformed hexagram"
      });
    }
    if (expectedMovingLineIndices.length > 0 && cast.transformedHexagram === undefined) {
      context.addIssue({
        code: "custom",
        path: ["transformedHexagram"],
        message: "moving casts require a transformed hexagram"
      });
    }
  });

const uniqueIdentifierPreferences = (minimum: number) =>
  z.array(IdentifierSchema).min(minimum).max(12).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: "preference identifiers must be unique" });
    }
  });

export const OracleDesignSignalSchema = z.strictObject({
  ruleVersion: IdentifierSchema,
  primaryColorTags: uniqueIdentifierPreferences(1),
  supportColorTags: uniqueIdentifierPreferences(0),
  styleTags: uniqueIdentifierPreferences(1),
  rhythmTags: uniqueIdentifierPreferences(1),
  accentLinePositions: z
    .array(z.number().int().min(1).max(6))
    .max(6)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "accent line positions must be unique" });
      }
    })
});

export const OracleInterpretationSchema = z.strictObject({
  headline: z.string().trim().min(1).max(48),
  summary: z.string().trim().min(1).max(240),
  keywords: z
    .tuple([
      z.string().trim().min(1).max(24),
      z.string().trim().min(1).max(24),
      z.string().trim().min(1).max(24)
    ])
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "interpretation keywords must be unique" });
      }
    }),
  designRationale: z.string().trim().min(1).max(240),
  disclaimer: z.string().trim().min(1).max(160),
  source: z.strictObject({
    kind: z.literal("MYSTCRAG_ORIGINAL"),
    version: IdentifierSchema
  })
});

export const OracleSessionStatusSchema = z.enum(["CAST", "RECOMMENDED", "SAVED"]);

export const OracleRankedRecommendationSchema = z.strictObject({
  rank: z.number().int().min(1).max(3),
  direction: OracleCandidateDirectionSchema,
  design: PublicDesignV1Schema
});

const OraclePublicSessionShape = {
  sessionId: IdentifierSchema,
  status: OracleSessionStatusSchema,
  revision: PositiveSafeIntegerSchema,
  locale: LocaleSchema,
  currency: CurrencySchema,
  wristCircumferenceMm: z.number().int().min(130).max(200).optional(),
  parentSessionId: IdentifierSchema.optional(),
  cast: OracleCastDtoSchema,
  signal: OracleDesignSignalSchema,
  interpretation: OracleInterpretationSchema,
  recommendations: z.array(OracleRankedRecommendationSchema).length(3).optional(),
  selectedDesignId: IdentifierSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
} as const;

const OraclePublicSessionBaseSchema = z.strictObject(OraclePublicSessionShape);
type OraclePublicSessionBase = z.infer<typeof OraclePublicSessionBaseSchema>;

const validateOraclePublicSession = (session: OraclePublicSessionBase, context: z.RefinementCtx) => {
  const addIssue = (path: PropertyKey[], message: string) => {
    context.addIssue({ code: "custom", path, message });
  };

  if (session.parentSessionId === session.sessionId) {
    addIssue(["parentSessionId"], "a session cannot be its own parent");
  }
  if (Date.parse(session.updatedAt) < Date.parse(session.createdAt)) {
    addIssue(["updatedAt"], "updatedAt cannot be earlier than createdAt");
  }

  if (session.status === "CAST") {
    if (session.recommendations !== undefined) {
      addIssue(["recommendations"], "CAST sessions cannot expose recommendations");
    }
    if (session.selectedDesignId !== undefined) {
      addIssue(["selectedDesignId"], "CAST sessions cannot select a design");
    }
    return;
  }

  if (session.recommendations === undefined) {
    addIssue(["recommendations"], "recommended and saved sessions require three recommendations");
    return;
  }

  const ranks = session.recommendations.map(({ rank }) => rank).sort((left, right) => left - right);
  if (ranks[0] !== 1 || ranks[1] !== 2 || ranks[2] !== 3) {
    addIssue(["recommendations"], "recommendation ranks must be exactly 1, 2, and 3");
  }
  const directions = session.recommendations.map(({ direction }) => direction);
  if (
    new Set(directions).size !== 3 ||
    !(["BALANCED", "CONTRAST", "NEUTRAL_LED"] as const).every((direction) =>
      directions.includes(direction)
    )
  ) {
    addIssue(["recommendations"], "recommendations must cover all three design directions");
  }
  const designIds = session.recommendations.map(({ design }) => design.designId);
  if (new Set(designIds).size !== designIds.length) {
    addIssue(["recommendations"], "recommendations must contain distinct designs");
  }

  for (const [index, recommendation] of session.recommendations.entries()) {
    const candidate = recommendation.design.provenance.oracleCandidate;
    if (recommendation.design.designMode !== "ORACLE_GUIDED") {
      addIssue(["recommendations", index, "design", "designMode"], "Oracle recommendations require ORACLE_GUIDED designs");
    }
    if (
      candidate === undefined ||
      candidate.sessionId !== session.sessionId ||
      candidate.ruleVersion !== session.signal.ruleVersion ||
      candidate.rank !== recommendation.rank ||
      candidate.direction !== recommendation.direction
    ) {
      addIssue(
        ["recommendations", index, "design", "provenance", "oracleCandidate"],
        "Oracle candidate provenance must match its session, signal, rank, and direction"
      );
    }
  }

  if (session.status === "RECOMMENDED" && session.selectedDesignId !== undefined) {
    addIssue(["selectedDesignId"], "RECOMMENDED sessions cannot claim a saved selection");
  }
  if (session.status === "SAVED") {
    if (session.selectedDesignId === undefined) {
      addIssue(["selectedDesignId"], "SAVED sessions require a selected design");
    } else if (!designIds.includes(session.selectedDesignId)) {
      addIssue(["selectedDesignId"], "selectedDesignId must reference a session recommendation");
    }
  }
};

export const OraclePublicSessionSchema = OraclePublicSessionBaseSchema.superRefine(
  validateOraclePublicSession
);
export const OracleCastSessionSchema = z
  .strictObject({ ...OraclePublicSessionShape, status: z.literal("CAST") })
  .superRefine(validateOraclePublicSession);
export const OracleRecommendedSessionSchema = z
  .strictObject({ ...OraclePublicSessionShape, status: z.enum(["RECOMMENDED", "SAVED"]) })
  .superRefine(validateOraclePublicSession);
export const OracleSavedSessionSchema = z
  .strictObject({ ...OraclePublicSessionShape, status: z.literal("SAVED") })
  .superRefine(validateOraclePublicSession);

export const CreateOracleSessionRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  operationId: IdentifierSchema,
  locale: LocaleSchema,
  currency: CurrencySchema,
  wristCircumferenceMm: z.number().int().min(130).max(200).optional(),
  question: z.string().trim().min(1).max(120).optional(),
  parentSessionId: IdentifierSchema.optional()
});

export const GenerateOracleRecommendationsRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  operationId: IdentifierSchema,
  expectedRevision: PositiveSafeIntegerSchema
});

export const SaveOracleSessionRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  operationId: IdentifierSchema,
  expectedRevision: PositiveSafeIntegerSchema,
  selectedDesignId: IdentifierSchema
});

export const CreateOracleSessionResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  session: OracleCastSessionSchema
});
export const GenerateOracleRecommendationsResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  session: OracleRecommendedSessionSchema
});
export const GetOracleSessionResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  session: OraclePublicSessionSchema
});
export const SaveOracleSessionResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  session: OracleSavedSessionSchema
});

export type OracleLineValue = z.infer<typeof OracleLineValueSchema>;
export type OracleTrigram = z.infer<typeof OracleTrigramSchema>;
export type OracleHexagramDto = z.infer<typeof OracleHexagramDtoSchema>;
export type OracleCastDto = z.infer<typeof OracleCastDtoSchema>;
export type OracleDesignSignal = z.infer<typeof OracleDesignSignalSchema>;
export type OracleInterpretation = z.infer<typeof OracleInterpretationSchema>;
export type OracleSessionStatus = z.infer<typeof OracleSessionStatusSchema>;
export type OracleRankedRecommendation = z.infer<typeof OracleRankedRecommendationSchema>;
export type OraclePublicSession = z.infer<typeof OraclePublicSessionSchema>;
export type OracleCastSession = z.infer<typeof OracleCastSessionSchema>;
export type OracleRecommendedSession = z.infer<typeof OracleRecommendedSessionSchema>;
export type OracleSavedSession = z.infer<typeof OracleSavedSessionSchema>;
export type CreateOracleSessionRequest = z.infer<typeof CreateOracleSessionRequestSchema>;
export type CreateOracleSessionResponse = z.infer<typeof CreateOracleSessionResponseSchema>;
export type GenerateOracleRecommendationsRequest = z.infer<typeof GenerateOracleRecommendationsRequestSchema>;
export type GenerateOracleRecommendationsResponse = z.infer<typeof GenerateOracleRecommendationsResponseSchema>;
export type GetOracleSessionResponse = z.infer<typeof GetOracleSessionResponseSchema>;
export type SaveOracleSessionRequest = z.infer<typeof SaveOracleSessionRequestSchema>;
export type SaveOracleSessionResponse = z.infer<typeof SaveOracleSessionResponseSchema>;
