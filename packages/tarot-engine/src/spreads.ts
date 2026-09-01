import type { TarotSlot, TarotSpreadType } from "@mystcrag/design-contract";

export const requiredSlotsForSpread = (spreadType: TarotSpreadType): readonly TarotSlot[] =>
  spreadType === "SINGLE" ? ["GUIDANCE"] : ["PAST", "PRESENT", "FUTURE"];
