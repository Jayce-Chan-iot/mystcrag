import { z } from "zod";

import {
  IdentifierSchema,
  NonEmptyTextSchema,
  PositiveSafeIntegerSchema
} from "./component.schema";
import { CurrencySchema, IsoDateTimeSchema, LocaleSchema } from "./metadata.schema";
import { PublicDesignV1Schema } from "./public-design.schema";

const TarotAssetFileSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[^/\\]+$/, "Expected an asset filename")
  .refine((value) => !value.includes(".."), "Asset filename cannot contain traversal segments");
const TarotColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Expected an RGB hex color");

export const TarotThemeSchema = z.enum([
  "RELATIONSHIPS",
  "CAREER",
  "SELF_GROWTH",
  "NEW_BEGINNINGS",
  "FINANCIAL_PLANNING"
]);
export const TarotSpreadTypeSchema = z.enum(["SINGLE", "PAST_PRESENT_FUTURE"]);
export const TarotSlotSchema = z.enum(["GUIDANCE", "PAST", "PRESENT", "FUTURE"]);
export const TarotOrientationSchema = z.enum(["UPRIGHT", "REVERSED"]);
export const TarotSessionStatusSchema = z.enum([
  "DRAWING",
  "DRAWN",
  "RECOMMENDED",
  "SAVED",
  "ABANDONED"
]);

export const TarotAcceptedSelectionSchema = z.strictObject({
  slot: TarotSlotSchema,
  displayedPosition: z.number().int().min(0).max(77),
  operationId: IdentifierSchema
});

export const TarotRevealedCardSchema = z.strictObject({
  slot: TarotSlotSchema,
  displayedPosition: z.number().int().min(0).max(77),
  cardId: IdentifierSchema,
  number: z.number().int().min(0).max(77),
  nameZh: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  assetFile: TarotAssetFileSchema,
  orientation: TarotOrientationSchema,
  keywords: z.array(IdentifierSchema).min(1).max(12)
});

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

export const TarotColorStorySchema = z.strictObject({
  primaryColor: TarotColorSchema,
  supportColor: TarotColorSchema,
  accentColor: TarotColorSchema,
  rationale: z.string().trim().min(1).max(240)
});

export const TarotMaterialDisplayRecommendationSchema = z.strictObject({
  beadProductId: IdentifierSchema,
  displayName: z.string().trim().min(1).max(160),
  crystalName: z.string().trim().min(1).max(160),
  colorTags: z.array(IdentifierSchema).min(1).max(10),
  reason: z.string().trim().min(1).max(240)
});

export const TarotRankedRecommendationSchema = z.strictObject({
  rank: z.number().int().min(1).max(3),
  design: PublicDesignV1Schema
});

const requiredSlotsFor = (spreadType: z.infer<typeof TarotSpreadTypeSchema>) =>
  spreadType === "SINGLE" ? ["GUIDANCE"] : ["PAST", "PRESENT", "FUTURE"];

const TarotSessionCoreShape = {
  sessionId: IdentifierSchema,
  spreadType: TarotSpreadTypeSchema,
  theme: TarotThemeSchema,
  status: TarotSessionStatusSchema,
  revision: PositiveSafeIntegerSchema,
  slots: z.array(TarotSlotSchema).min(1).max(3),
  acceptedSelections: z.array(TarotAcceptedSelectionSchema).max(3),
  selectedDesignId: IdentifierSchema.optional(),
  parentSessionId: IdentifierSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
} as const;

const TarotSessionCoreSchema = z.strictObject(TarotSessionCoreShape);
type TarotSessionCore = z.infer<typeof TarotSessionCoreSchema>;

const validateTarotSessionCore = (session: TarotSessionCore, context: z.RefinementCtx) => {
  const addIssue = (path: PropertyKey[], message: string) => {
    context.addIssue({ code: "custom", path, message });
  };
  const requiredSlots = requiredSlotsFor(session.spreadType);

  if (
    session.slots.length !== requiredSlots.length ||
    session.slots.some((slot, index) => slot !== requiredSlots[index])
  ) {
    addIssue(["slots"], "slots must match the canonical order for spreadType");
  }

  if (session.acceptedSelections.length > requiredSlots.length) {
    addIssue(["acceptedSelections"], "selection count exceeds the spread slots");
  }
  for (const [index, selection] of session.acceptedSelections.entries()) {
    if (selection.slot !== requiredSlots[index]) {
      addIssue(["acceptedSelections", index, "slot"], "selections must follow canonical slot order");
    }
  }
  if (
    new Set(session.acceptedSelections.map((selection) => selection.displayedPosition)).size !==
    session.acceptedSelections.length
  ) {
    addIssue(["acceptedSelections"], "displayed positions must be unique");
  }
  if (
    new Set(session.acceptedSelections.map((selection) => selection.operationId)).size !==
    session.acceptedSelections.length
  ) {
    addIssue(["acceptedSelections"], "operation IDs must be unique");
  }
  if (session.parentSessionId === session.sessionId) {
    addIssue(["parentSessionId"], "a session cannot be its own parent");
  }
  if (Date.parse(session.updatedAt) < Date.parse(session.createdAt)) {
    addIssue(["updatedAt"], "updatedAt cannot be earlier than createdAt");
  }
};

const TarotPublicSessionShape = {
  ...TarotSessionCoreShape,
  revealedCards: z.array(TarotRevealedCardSchema).min(1).max(3).optional(),
  interpretation: TarotInterpretationSchema.optional(),
  colorStory: TarotColorStorySchema.optional(),
  materialRecommendations: z.array(TarotMaterialDisplayRecommendationSchema).min(1).max(12).optional(),
  recommendations: z.array(TarotRankedRecommendationSchema).length(3).optional()
} as const;

const TarotPublicSessionBaseSchema = z.strictObject(TarotPublicSessionShape);
type TarotPublicSessionBase = z.infer<typeof TarotPublicSessionBaseSchema>;

const validateTarotPublicSession = (session: TarotPublicSessionBase, context: z.RefinementCtx) => {
  const addIssue = (path: PropertyKey[], message: string) => {
    context.addIssue({ code: "custom", path, message });
  };
  const requiredSlots = requiredSlotsFor(session.spreadType);

  validateTarotSessionCore(session, context);

  if (session.revealedCards !== undefined) {
    if (session.acceptedSelections.length !== requiredSlots.length) {
      addIssue(["revealedCards"], "revealed cards require every slot to be selected");
    }
    if (session.revealedCards.length !== requiredSlots.length) {
      addIssue(["revealedCards"], "revealed cards must cover every spread slot");
    }
    for (const [index, card] of session.revealedCards.entries()) {
      const selection = session.acceptedSelections[index];
      if (card.slot !== requiredSlots[index]) {
        addIssue(["revealedCards", index, "slot"], "revealed cards must follow canonical slot order");
      }
      if (selection !== undefined && card.displayedPosition !== selection.displayedPosition) {
        addIssue(
          ["revealedCards", index, "displayedPosition"],
          "revealed card position must match its accepted selection"
        );
      }
    }
  }

  const requiresReveal = session.status === "DRAWN" || session.status === "RECOMMENDED" || session.status === "SAVED";
  if (requiresReveal && session.revealedCards === undefined) {
    addIssue(["revealedCards"], "this session status requires revealed cards");
  }
  if (session.status === "DRAWING" && session.revealedCards !== undefined) {
    addIssue(["status"], "DRAWING sessions cannot expose card identities");
  }

  const requiresRecommendations = session.status === "RECOMMENDED" || session.status === "SAVED";
  if (requiresRecommendations && session.recommendations === undefined) {
    addIssue(["recommendations"], "this session status requires three recommendations");
  }
  if (!requiresRecommendations && session.recommendations !== undefined) {
    addIssue(["recommendations"], "recommendations are unavailable before recommendation state");
  }
  if (session.recommendations !== undefined) {
    const ranks = session.recommendations.map((recommendation) => recommendation.rank).sort();
    if (ranks.length !== 3 || ranks[0] !== 1 || ranks[1] !== 2 || ranks[2] !== 3) {
      addIssue(["recommendations"], "recommendation ranks must be exactly 1, 2, and 3");
    }
    if (
      new Set(session.recommendations.map((recommendation) => recommendation.design.designId)).size !==
      session.recommendations.length
    ) {
      addIssue(["recommendations"], "recommendations must contain distinct designs");
    }
  }

  const recommendationDetails = [
    session.interpretation,
    session.colorStory,
    session.materialRecommendations
  ];
  if (requiresRecommendations && recommendationDetails.some((value) => value === undefined)) {
    addIssue(["interpretation"], "recommended sessions require public recommendation details");
  }
  if (!requiresRecommendations && recommendationDetails.some((value) => value !== undefined)) {
    addIssue(["interpretation"], "recommendation details are unavailable before recommendation state");
  }

  if (
    session.selectedDesignId !== undefined &&
    (session.recommendations === undefined ||
      !session.recommendations.some(
        (recommendation) => recommendation.design.designId === session.selectedDesignId
      ))
  ) {
    addIssue(["selectedDesignId"], "selectedDesignId must reference a session recommendation");
  }
};

const validateTarotPreRevealSession = (session: TarotSessionCore, context: z.RefinementCtx) => {
  validateTarotSessionCore(session, context);
  if (
    session.status === "DRAWN" &&
    session.acceptedSelections.length !== requiredSlotsFor(session.spreadType).length
  ) {
    context.addIssue({
      code: "custom",
      path: ["acceptedSelections"],
      message: "DRAWN selection responses require every slot to be selected"
    });
  }
};

export const TarotPublicSessionSchema = z
  .strictObject({ ...TarotPublicSessionShape, status: TarotSessionStatusSchema })
  .superRefine(validateTarotPublicSession);
export const TarotDrawingSessionSchema = z
  .strictObject({ ...TarotSessionCoreShape, status: z.literal("DRAWING") })
  .superRefine(validateTarotPreRevealSession);
export const TarotSelectSessionSchema = z
  .strictObject({
    ...TarotPublicSessionShape,
    status: z.enum(["DRAWING", "DRAWN", "RECOMMENDED", "SAVED"])
  })
  .superRefine(validateTarotPublicSession);
export const TarotRevealSessionSchema = z
  .strictObject({ ...TarotPublicSessionShape, status: z.enum(["DRAWN", "RECOMMENDED", "SAVED"]) })
  .superRefine(validateTarotPublicSession);
export const TarotRecommendedSessionSchema = z
  .strictObject({ ...TarotPublicSessionShape, status: z.enum(["RECOMMENDED", "SAVED"]) })
  .superRefine(validateTarotPublicSession);
export const TarotSavedSessionSchema = z
  .strictObject({ ...TarotPublicSessionShape, status: z.literal("SAVED") })
  .superRefine(validateTarotPublicSession);

export const TarotCardBackMetadataSchema = z.strictObject({
  assetFile: TarotAssetFileSchema,
  altText: NonEmptyTextSchema
});

export const CreateTarotSessionRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  spreadType: TarotSpreadTypeSchema,
  theme: TarotThemeSchema,
  parentSessionId: IdentifierSchema.optional()
});

export const SelectTarotCardRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  slot: TarotSlotSchema,
  displayedPosition: z.number().int().min(0).max(77),
  expectedRevision: PositiveSafeIntegerSchema,
  operationId: IdentifierSchema
});

export const RevealTarotSessionRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  expectedRevision: PositiveSafeIntegerSchema
});

export const GenerateTarotRecommendationsRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  expectedRevision: PositiveSafeIntegerSchema,
  question: z.string().trim().min(1).max(120).optional(),
  saveQuestion: z.boolean().default(false),
  locale: LocaleSchema,
  currency: CurrencySchema
});

export const SaveTarotSessionRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  expectedRevision: PositiveSafeIntegerSchema,
  selectedDesignId: IdentifierSchema.optional()
});

const TarotPublicSessionResponseShape = {
  requestId: IdentifierSchema,
  session: TarotPublicSessionSchema
} as const;

export const CreateTarotSessionResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  session: TarotDrawingSessionSchema,
  cardBack: TarotCardBackMetadataSchema
});
export const SelectTarotCardResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  session: TarotSelectSessionSchema
});
export const RevealTarotSessionResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  session: TarotRevealSessionSchema
});
export const GenerateTarotRecommendationsResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  session: TarotRecommendedSessionSchema
});
export const GetTarotSessionResponseSchema = z.strictObject({
  ...TarotPublicSessionResponseShape,
  cardBack: TarotCardBackMetadataSchema
});
export const SaveTarotSessionResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  session: TarotSavedSessionSchema
});

export type TarotTheme = z.infer<typeof TarotThemeSchema>;
export type TarotSpreadType = z.infer<typeof TarotSpreadTypeSchema>;
export type TarotSlot = z.infer<typeof TarotSlotSchema>;
export type TarotOrientation = z.infer<typeof TarotOrientationSchema>;
export type TarotSessionStatus = z.infer<typeof TarotSessionStatusSchema>;
export type TarotAcceptedSelection = z.infer<typeof TarotAcceptedSelectionSchema>;
export type TarotRevealedCard = z.infer<typeof TarotRevealedCardSchema>;
export type TarotInterpretation = z.infer<typeof TarotInterpretationSchema>;
export type TarotColorStory = z.infer<typeof TarotColorStorySchema>;
export type TarotMaterialDisplayRecommendation = z.infer<typeof TarotMaterialDisplayRecommendationSchema>;
export type TarotRankedRecommendation = z.infer<typeof TarotRankedRecommendationSchema>;
export type TarotPublicSession = z.infer<typeof TarotPublicSessionSchema>;
export type TarotDrawingSession = z.infer<typeof TarotDrawingSessionSchema>;
export type TarotSelectSession = z.infer<typeof TarotSelectSessionSchema>;
export type TarotRevealSession = z.infer<typeof TarotRevealSessionSchema>;
export type TarotRecommendedSession = z.infer<typeof TarotRecommendedSessionSchema>;
export type TarotSavedSession = z.infer<typeof TarotSavedSessionSchema>;
export type TarotCardBackMetadata = z.infer<typeof TarotCardBackMetadataSchema>;
export type CreateTarotSessionRequest = z.infer<typeof CreateTarotSessionRequestSchema>;
export type CreateTarotSessionResponse = z.infer<typeof CreateTarotSessionResponseSchema>;
export type SelectTarotCardRequest = z.infer<typeof SelectTarotCardRequestSchema>;
export type SelectTarotCardResponse = z.infer<typeof SelectTarotCardResponseSchema>;
export type RevealTarotSessionRequest = z.infer<typeof RevealTarotSessionRequestSchema>;
export type RevealTarotSessionResponse = z.infer<typeof RevealTarotSessionResponseSchema>;
export type GenerateTarotRecommendationsRequest = z.infer<typeof GenerateTarotRecommendationsRequestSchema>;
export type GenerateTarotRecommendationsResponse = z.infer<typeof GenerateTarotRecommendationsResponseSchema>;
export type GetTarotSessionResponse = z.infer<typeof GetTarotSessionResponseSchema>;
export type SaveTarotSessionRequest = z.infer<typeof SaveTarotSessionRequestSchema>;
export type SaveTarotSessionResponse = z.infer<typeof SaveTarotSessionResponseSchema>;
