import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import Image from "next/image";

import { tarotStyles as styles } from "../tarot-styles";

export const DISPLAYED_TAROT_POSITIONS = Object.freeze(
  Array.from({ length: 78 }, (_, index) => index)
);

export function getFanCardTransform(index: number, count: number) {
  const normalized = count <= 1 ? 0 : (index / (count - 1)) * 2 - 1;
  return {
    xPercent: normalized * 50,
    yPx: normalized * normalized * 82,
    rotateDeg: normalized * 18
  };
}

type TarotFanProps = Readonly<{
  acceptedPositions: ReadonlySet<number>;
  cardBackAssetFile: string;
  disabled: boolean;
  pendingPosition: number | undefined;
  onSelect(displayedPosition: number): void;
}>;

export function TarotFan({
  acceptedPositions,
  cardBackAssetFile,
  disabled,
  pendingPosition,
  onSelect
}: TarotFanProps) {
  const activateFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, position: number) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(position);
  };
  const activateFromPointer = (event: PointerEvent<HTMLButtonElement>, position: number) => {
    if (event.button !== 0) return;
    onSelect(position);
  };
  const activateFromClick = (event: MouseEvent<HTMLButtonElement>, position: number) => {
    if (event.detail === 0) onSelect(position);
  };

  return (
    <div className={styles.fanViewport} aria-label="可选的塔罗牌" role="group">
      <div className={styles.fanRail}>
        {DISPLAYED_TAROT_POSITIONS.map((position) => {
          const transform = getFanCardTransform(position, DISPLAYED_TAROT_POSITIONS.length);
          const accepted = acceptedPositions.has(position);
          const pending = pendingPosition === position;
          const style = {
            "--fan-x": `${transform.xPercent}%`,
            "--fan-y": `${transform.yPx}px`,
            "--fan-rotate": `${transform.rotateDeg}deg`,
            "--fan-order": position
          } as CSSProperties;

          return (
            <button
              aria-busy={pending || undefined}
              aria-label={`选择第 ${position + 1} 张塔罗牌`}
              className={styles.fanCard}
              data-inputs="click pointer-mouse pointer-touch Enter Space"
              data-pending={pending || undefined}
              data-selected={accepted || undefined}
              data-tarot-position={position}
              disabled={disabled || accepted}
              key={position}
              onClick={(event) => activateFromClick(event, position)}
              onKeyDown={(event) => activateFromKeyboard(event, position)}
              onPointerUp={(event) => activateFromPointer(event, position)}
              style={style}
              type="button"
            >
              <Image
                alt=""
                className={styles.cardArtwork}
                draggable={false}
                height={1376}
                src={`/tarot/cards/${encodeURIComponent(cardBackAssetFile)}`}
                unoptimized
                width={784}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
