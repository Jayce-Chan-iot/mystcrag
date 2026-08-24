import {
  TarotAcceptedSelectionSchema,
  TarotColorStorySchema,
  TarotInterpretationSchema,
  TarotMaterialDisplayRecommendationSchema,
  TarotFulfillmentAdvisorySchema,
  TarotRevealedCardSchema
} from "@mystcrag/design-contract";
import { PrivateDrawStateSchema, type PrivateDrawState } from "@mystcrag/tarot-engine";
import { z } from "zod";

import { PersistenceError } from "../errors/persistence-errors.js";

export const TarotDrawSnapshotSchema = z
  .strictObject({
    acceptedSelections: z.array(TarotAcceptedSelectionSchema).max(3),
    revealedCards: z.array(TarotRevealedCardSchema).min(1).max(3).optional()
  })
  .superRefine((snapshot, context) => {
    if (
      new Set(snapshot.acceptedSelections.map(({ displayedPosition }) => displayedPosition)).size !==
      snapshot.acceptedSelections.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptedSelections"],
        message: "displayed positions must be unique"
      });
    }
    if (
      new Set(snapshot.acceptedSelections.map(({ operationId }) => operationId)).size !==
      snapshot.acceptedSelections.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptedSelections"],
        message: "operation IDs must be unique"
      });
    }
    if (snapshot.revealedCards !== undefined) {
      if (snapshot.revealedCards.length !== snapshot.acceptedSelections.length) {
        context.addIssue({
          code: "custom",
          path: ["revealedCards"],
          message: "revealed cards must match accepted selections"
        });
      }
      for (const [index, card] of snapshot.revealedCards.entries()) {
        const selection = snapshot.acceptedSelections[index];
        if (
          selection !== undefined &&
          (card.slot !== selection.slot || card.displayedPosition !== selection.displayedPosition)
        ) {
          context.addIssue({
            code: "custom",
            path: ["revealedCards", index],
            message: "revealed card must match its accepted selection"
          });
        }
      }
    }
  });

export const TarotRecommendationSnapshotSchema = z.strictObject({
  interpretation: TarotInterpretationSchema,
  copySource: z
    .strictObject({
      mode: z.enum(["PROVIDER", "DETERMINISTIC_FALLBACK"]),
      providerId: z.string().trim().min(1).max(128),
      providerVersion: z.string().trim().min(1).max(80),
      policyVersion: z.string().trim().min(1).max(80)
    })
    .optional(),
  colorStory: TarotColorStorySchema,
  materialRecommendations: z.array(TarotMaterialDisplayRecommendationSchema).min(1).max(12)
  ,fulfillmentAdvisories: z.array(z.strictObject({
    rank: z.number().int().min(1).max(3),
    ...TarotFulfillmentAdvisorySchema.shape
  })).length(3).optional()
});

export type TarotDrawSnapshot = z.infer<typeof TarotDrawSnapshotSchema>;
export type TarotRecommendationSnapshot = z.infer<typeof TarotRecommendationSnapshotSchema>;

type PersistenceSchema<T> = {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown };
};

function parseForWrite<T>(schema: PersistenceSchema<T>, input: unknown, label: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new PersistenceError("VALIDATION_ERROR", `${label} is invalid`, parsed.error);
  }
  return parsed.data;
}

function parseAfterRead<T>(schema: PersistenceSchema<T>, input: unknown, label: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new PersistenceError(
      "DATA_INTEGRITY_ERROR",
      `${label} failed persisted JSON validation`,
      parsed.error
    );
  }
  return parsed.data;
}

export function validatePrivateDrawStateForWrite(input: unknown): PrivateDrawState {
  return parseForWrite(PrivateDrawStateSchema, input, "Private Tarot draw state");
}

export function parsePrivateDrawState(input: unknown): PrivateDrawState {
  return parseAfterRead(PrivateDrawStateSchema, input, "Private Tarot draw state");
}

export function validateDrawSnapshotForWrite(input: unknown): TarotDrawSnapshot {
  return parseForWrite(TarotDrawSnapshotSchema, input, "Tarot draw snapshot");
}

export function parseDrawSnapshot(input: unknown): TarotDrawSnapshot {
  return parseAfterRead(TarotDrawSnapshotSchema, input, "Tarot draw snapshot");
}

export function validateRecommendationSnapshotForWrite(
  input: unknown
): TarotRecommendationSnapshot {
  return parseForWrite(
    TarotRecommendationSnapshotSchema,
    input,
    "Tarot recommendation snapshot"
  );
}

export function parseRecommendationSnapshot(input: unknown): TarotRecommendationSnapshot {
  return parseAfterRead(
    TarotRecommendationSnapshotSchema,
    input,
    "Tarot recommendation snapshot"
  );
}
