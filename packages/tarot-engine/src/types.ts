import { z } from "zod";

export type TarotSpreadType = "SINGLE" | "PAST_PRESENT_FUTURE";
export type TarotSlot = "GUIDANCE" | "PAST" | "PRESENT" | "FUTURE";
export type TarotOrientation = "UPRIGHT" | "REVERSED";
export type TarotTheme =
  | "RELATIONSHIPS"
  | "CAREER"
  | "SELF_GROWTH"
  | "NEW_BEGINNINGS"
  | "FINANCIAL_PLANNING";

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

export const TarotSpreadTypeSchema = z.enum(["SINGLE", "PAST_PRESENT_FUTURE"]);
export const TarotSlotSchema = z.enum(["GUIDANCE", "PAST", "PRESENT", "FUTURE"]);
export const TarotOrientationSchema = z.enum(["UPRIGHT", "REVERSED"]);
export const TarotThemeSchema = z.enum([
  "RELATIONSHIPS",
  "CAREER",
  "SELF_GROWTH",
  "NEW_BEGINNINGS",
  "FINANCIAL_PLANNING",
]);

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

export const PrivateDrawStateSchema = z.strictObject({
  spreadType: TarotSpreadTypeSchema,
  deckOrder: z.array(z.string().min(1)).length(78),
  orientationOrder: z.array(TarotOrientationSchema).length(78),
  selections: z.array(PrivateDrawSelectionSchema).max(3),
  revision: z.number().int().min(0),
  revealed: z.boolean(),
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
