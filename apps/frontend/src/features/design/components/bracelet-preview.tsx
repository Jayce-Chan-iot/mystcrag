import type { PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";

const materialColors: Record<string, string> = {
  "aquamarine-clear-v1": "#9fcbd5",
  "moonstone-soft-v1": "#e9e6de",
  "clear-quartz-v1": "#d8e1df",
  "amethyst-mist-v1": "#a995bb",
  "smoky-quartz-v1": "#8c817b"
};

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
      <div className="absolute inset-[15%] rounded-full border border-white/80 bg-[radial-gradient(circle_at_40%_35%,rgba(255,255,255,.96),rgba(239,234,225,.38)_52%,rgba(108,82,128,.12))] shadow-[inset_0_0_50px_rgb(83_65_95/0.1),0_26px_70px_rgb(57_45_67/0.13)]" />
      {inlineComponents.map((component, index) => {
        const angle = (index / inlineComponents.length) * Math.PI * 2 - Math.PI / 2;
        const x = 50 + Math.cos(angle) * 42;
        const y = 50 + Math.sin(angle) * 42;
        const isBead = component.kind === "bead";
        const isSelected = component.componentId === selectedComponentId;
        const color = isBead ? (materialColors[component.materialKey] ?? "#c8c0ca") : "#c9b78f";
        const label = isBead ? `选择第 ${component.positionIndex + 1} 颗珠子` : `${component.accessoryType} 配件`;
        return (
          <button
            aria-label={label}
            aria-pressed={interactive ? isSelected : undefined}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 shadow-[inset_-5px_-7px_12px_rgb(70_48_86/0.18),inset_4px_4px_8px_rgb(255_255_255/0.82),0_5px_14px_rgb(57_45_67/0.18)] transition duration-300 ${isBead ? "h-[15%] w-[15%]" : "h-[9%] w-[9%]"} ${interactive && isBead ? "min-h-11 min-w-11" : ""} ${isSelected ? "ring-2 ring-[var(--accent)] ring-offset-4 ring-offset-transparent scale-110" : ""} ${interactive && isBead ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
            data-component-id={component.componentId}
            disabled={!interactive || !isBead}
            key={component.componentId}
            onClick={() => onSelect?.(component.componentId)}
            style={{ background: color, left: `${x}%`, top: `${y}%` }}
            type="button"
          />
        );
      })}
    </div>
  );
}
