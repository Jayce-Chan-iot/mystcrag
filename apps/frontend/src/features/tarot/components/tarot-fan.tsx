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

type TarotFanInput = Readonly<{
  kind: "click" | "keydown" | "pointer";
  key?: string;
  button?: number;
  pointerType?: string;
  detail?: number;
  disabled: boolean;
  pending: boolean;
  choose(): void;
  preventDefault(): void;
}>;

export function activateTarotFanInput(input: TarotFanInput): void {
  if (input.disabled || input.pending) return;
  if (input.kind === "keydown") {
    if (input.key !== "Enter" && input.key !== " ") return;
    input.preventDefault();
    input.choose();
    return;
  }
  if (input.kind === "pointer") {
    if (input.button !== 0) return;
    input.choose();
    return;
  }
  if (input.detail === 0) input.choose();
}

export function TarotFan({
  acceptedPositions,
  cardBackAssetFile,
  disabled,
  pendingPosition,
  onSelect
}: TarotFanProps) {
  const activateFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, position: number) => {
    activateTarotFanInput({
      kind: "keydown", key: event.key, disabled, pending: pendingPosition !== undefined,
      choose: () => onSelect(position), preventDefault: () => event.preventDefault()
    });
  };
  const activateFromPointer = (event: PointerEvent<HTMLButtonElement>, position: number) => {
    activateTarotFanInput({
      kind: "pointer", button: event.button, pointerType: event.pointerType, disabled,
      pending: pendingPosition !== undefined, choose: () => onSelect(position),
      preventDefault: () => event.preventDefault()
    });
  };
  const activateFromClick = (event: MouseEvent<HTMLButtonElement>, position: number) => {
    activateTarotFanInput({
      kind: "click", detail: event.detail, disabled, pending: pendingPosition !== undefined,
      choose: () => onSelect(position), preventDefault: () => event.preventDefault()
    });
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

          if (accepted) {
            return (
              <span
                aria-hidden="true"
                className={styles.fanCard}
                data-selected-footprint="true"
                data-tarot-position={position}
                key={position}
                style={style}
              />
            );
          }

          return (
            <button
              aria-busy={pending || undefined}
              aria-label={`选择第 ${position + 1} 张塔罗牌`}
              className={styles.fanCard}
              data-pending={pending || undefined}
              data-tarot-position={position}
              disabled={disabled}
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
