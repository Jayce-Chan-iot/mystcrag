import type { TarotPublicSession, TarotSlot, TarotSpreadType } from "@mystcrag/design-contract";
import Image from "next/image";
import type { CSSProperties } from "react";

import { tarotStyles as styles } from "../tarot-styles";

const SLOT_LABELS: Readonly<Record<TarotSlot, string>> = {
  GUIDANCE: "指引",
  PAST: "过去",
  PRESENT: "现在",
  FUTURE: "未来"
};

export function getRequiredTarotSlots(spreadType: TarotSpreadType): readonly TarotSlot[] {
  return spreadType === "SINGLE" ? ["GUIDANCE"] : ["PAST", "PRESENT", "FUTURE"];
}

export function TarotSlots({
  session,
  cardBackAssetFile,
  pendingPosition
}: Readonly<{
  session: TarotPublicSession;
  cardBackAssetFile: string;
  pendingPosition: number | undefined;
}>) {
  const revealedBySlot = new Map(session.revealedCards?.map((card) => [card.slot, card]));
  const acceptedBySlot = new Map(session.acceptedSelections.map((selection) => [selection.slot, selection]));

  return (
    <div className={styles.slots} data-slot-count={session.slots.length}>
      {session.slots.map((slot, index) => {
        const accepted = acceptedBySlot.get(slot);
        const revealed = revealedBySlot.get(slot);
        const cardStyle = {
          "--reveal-delay": `${index * 180}ms`,
          ...(revealed?.orientation === "REVERSED" ? { transform: "rotate(180deg)" } : {})
        } as CSSProperties;

        return (
          <section className={styles.slotColumn} key={slot}>
            <h2>{SLOT_LABELS[slot]}</h2>
            <div
              aria-label={`${SLOT_LABELS[slot]}牌位${accepted ? "已选择" : "待选择"}`}
              className={styles.slotCard}
              data-filled={accepted !== undefined || undefined}
              data-pending={pendingPosition !== undefined && accepted === undefined || undefined}
            >
              {revealed ? (
                <Image
                  alt={`${revealed.nameZh} · ${revealed.orientation === "REVERSED" ? "逆位" : "正位"}`}
                  className={styles.revealedArtwork}
                  data-orientation={revealed.orientation}
                  draggable={false}
                  height={527}
                  src={`/tarot/cards/${encodeURIComponent(revealed.assetFile)}`}
                  style={cardStyle}
                  unoptimized
                  width={300}
                />
              ) : accepted ? (
                <Image
                  alt="已选择的牌，尚未揭晓"
                  className={styles.cardArtwork}
                  draggable={false}
                  height={1376}
                  src={`/tarot/cards/${encodeURIComponent(cardBackAssetFile)}`}
                  unoptimized
                  width={784}
                />
              ) : (
                <span aria-hidden="true" className={styles.slotMark} />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
