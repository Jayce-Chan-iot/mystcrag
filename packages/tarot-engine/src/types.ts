import {
  TarotOrientationSchema,
  TarotSlotSchema,
  TarotSpreadTypeSchema,
  type TarotOrientation,
  type TarotSlot,
  type TarotSpreadType
} from "@mystcrag/design-contract";
import { z } from "zod";

import { TAROT_CARD_CATALOG } from "./card-catalog";
import { requiredSlotsForSpread } from "./spreads";

export interface RandomSource {
  nextInt(maxExclusive: number): number;
}

export interface TarotCardDefinition {
  readonly id: string;
  readonly number: number;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly assetFile: string;
  readonly uprightKeywords: readonly string[];
  readonly reversedKeywords: readonly string[];
  readonly designTags: {
    readonly colors: readonly string[];
    readonly visual: readonly string[];
    readonly themes: readonly string[];
  };
}

export interface PrivateDrawSelection {
  readonly slot: TarotSlot;
  readonly displayedPosition: number;
  readonly operationId: string;
}

export interface PrivateDrawState {
  readonly spreadType: TarotSpreadType;
  readonly deckOrder: readonly string[];
  readonly orientationOrder: readonly TarotOrientation[];
  readonly selections: readonly PrivateDrawSelection[];
  readonly revision: number;
  readonly revealed: boolean;
}

export interface RevealedTarotCard extends TarotCardDefinition {
  readonly slot: TarotSlot;
  readonly orientation: TarotOrientation;
  readonly displayedPosition: number;
}

export interface PublicDrawState {
  readonly spreadType: TarotSpreadType;
  readonly selections: readonly PrivateDrawSelection[];
  readonly revision: number;
  readonly revealed: boolean;
  readonly cards?: readonly RevealedTarotCard[];
}

const VersionedTagSchema = z.string().regex(/^[a-z]+-v\d+:[a-z0-9-]+$/);

export const TarotCardDefinitionSchema = z.strictObject({
  id: z.string().min(1),
  number: z.number().int().min(0),
  nameZh: z.string().min(1),
  nameEn: z.string().min(1),
  assetFile: z.string().regex(/^[^/\\]+$/).refine((value) => !value.includes("..")),
  uprightKeywords: z.array(z.string().min(1)).min(1),
  reversedKeywords: z.array(z.string().min(1)).min(1),
  designTags: z.strictObject({
    colors: z.array(VersionedTagSchema).min(1),
    visual: z.array(VersionedTagSchema).min(1),
    themes: z.array(VersionedTagSchema).min(1),
  }),
});

export const PrivateDrawSelectionSchema = z.strictObject({
  slot: TarotSlotSchema,
  displayedPosition: z.number().int().min(0).max(77),
  operationId: z.string().min(1),
});

const CanonicalCardIds = new Set(TAROT_CARD_CATALOG.map((card) => card.id));

export const PrivateDrawStateSchema = z
  .strictObject({
    spreadType: TarotSpreadTypeSchema,
    deckOrder: z.array(z.string().min(1)).length(78),
    orientationOrder: z.array(TarotOrientationSchema).length(78),
    selections: z.array(PrivateDrawSelectionSchema).max(3),
    revision: z.number().int().min(0),
    revealed: z.boolean(),
  })
  .superRefine((value, context) => {
    const deckIds = new Set(value.deckOrder);
    if (deckIds.size !== CanonicalCardIds.size || [...deckIds].some((id) => !CanonicalCardIds.has(id))) {
      context.addIssue({ code: "custom", message: "deckOrder must contain every canonical card exactly once", path: ["deckOrder"] });
    }

    const requiredSlots = requiredSlotsForSpread(value.spreadType);
    if (value.selections.length > requiredSlots.length) {
      context.addIssue({ code: "custom", message: "selection count exceeds spread slots", path: ["selections"] });
    }
    for (const [index, selection] of value.selections.entries()) {
      if (selection.slot !== requiredSlots[index]) {
        context.addIssue({ code: "custom", message: "selections must follow canonical spread slots", path: ["selections", index, "slot"] });
      }
    }

    if (new Set(value.selections.map((selection) => selection.displayedPosition)).size !== value.selections.length) {
      context.addIssue({ code: "custom", message: "displayed positions must be unique", path: ["selections"] });
    }
    if (new Set(value.selections.map((selection) => selection.operationId)).size !== value.selections.length) {
      context.addIssue({ code: "custom", message: "operation IDs must be unique", path: ["selections"] });
    }
    if (value.revealed && value.selections.length !== requiredSlots.length) {
      context.addIssue({ code: "custom", message: "revealed draws must have every required selection", path: ["revealed"] });
    }
  });

export const RevealedTarotCardSchema = TarotCardDefinitionSchema.extend({
  slot: TarotSlotSchema,
  orientation: TarotOrientationSchema,
  displayedPosition: z.number().int().min(0).max(77),
});

export const PublicDrawStateSchema = z
  .strictObject({
    spreadType: TarotSpreadTypeSchema,
    selections: z.array(PrivateDrawSelectionSchema).max(3),
    revision: z.number().int().min(0),
    revealed: z.boolean(),
    cards: z.array(RevealedTarotCardSchema).max(3).optional(),
  })
  .superRefine((value, context) => {
    if (!value.revealed && value.cards !== undefined) {
      context.addIssue({
        code: "custom",
        message: "unrevealed public draw state must not include cards",
        path: ["cards"],
      });
    }
  });
