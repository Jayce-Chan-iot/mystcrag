"use client";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import Image from "next/image";
import * as React from "react";

import { CrystalBeadImage } from "./crystal-bead-image";

export function BraceletPreview({
  design,
  selectedComponentId,
  onSelect,
  interactive = false,
  compact = false
}: {
  design: PublicDesignV1;
  selectedComponentId?: string;
  onSelect?: (componentId: string) => void;
  interactive?: boolean;
  compact?: boolean;
}) {
  const inlineComponents = [
    ...design.beads.map((bead) => ({ ...bead, kind: "bead" as const })),
    ...design.accessories.filter((accessory) => accessory.placementMode === "INLINE").map((accessory) => ({ ...accessory, kind: "accessory" as const }))
  ].sort((left, right) => left.positionIndex - right.positionIndex);

  return (
    <div className={`relative mx-auto aspect-square ${compact ? "w-full max-w-[18rem]" : "w-[min(76vw,30rem)]"}`} aria-label="手串预览" data-preview-mode={interactive ? "interactive" : "display"}>
      <div className="absolute inset-[11%] rounded-full border border-white/90 shadow-[0_16px_38px_rgb(57_45_67/0.08)]" />
      {inlineComponents.map((component, index) => {
        const angle = (index / inlineComponents.length) * Math.PI * 2 - Math.PI / 2;
        const x = Number((50 + Math.cos(angle) * 40).toFixed(4));
        const y = Number((50 + Math.sin(angle) * 40).toFixed(4));
        const isBead = component.kind === "bead";
        const isSelected = component.componentId === selectedComponentId;
        const label = isBead ? `选择第 ${component.positionIndex + 1} 颗珠子` : `${component.accessoryType} 配件`;
        return (
          <button
            aria-label={label}
            aria-pressed={interactive ? isSelected : undefined}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition duration-300 ${isBead ? "h-[19%] w-[19%]" : "h-[13%] w-[13%]"} ${interactive && isBead ? "min-h-11 min-w-11" : ""} ${isSelected ? "ring-2 ring-[var(--accent)] ring-offset-4 ring-offset-transparent scale-110" : ""} ${interactive && isBead ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
            data-component-id={component.componentId}
            disabled={!interactive || !isBead}
            key={component.componentId}
            onClick={() => onSelect?.(component.componentId)}
            style={{ left: `${x}%`, top: `${y}%` }}
            type="button"
          >
            {isBead ? (
              <CrystalBeadImage alt="" materialKey={component.materialKey} priority={index < 6} sizes={compact ? "48px" : "76px"} />
            ) : (
              <Image alt="" className="h-full w-full object-contain drop-shadow-md" height={256} loading="eager" src="/accessories/silver-star-ring-charm.png" width={256} />
            )}
          </button>
        );
      })}
    </div>
  );
}
