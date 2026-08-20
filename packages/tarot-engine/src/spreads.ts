import type { TarotSlot, TarotSpreadType } from "./types";

export const requiredSlotsForSpread = (spreadType: TarotSpreadType): readonly TarotSlot[] =>
  spreadType === "SINGLE" ? ["GUIDANCE"] : ["PAST", "PRESENT", "FUTURE"];
