"use client";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";

type RingComponent =
  | (PublicDesignV1["beads"][number] & { kind: "BEAD" })
  | (Extract<PublicDesignV1["accessories"][number], { placementMode: "INLINE" }> & {
      kind: "ACCESSORY";
    });

function ringComponents(design: PublicDesignV1): RingComponent[] {
  return [
    ...design.beads.map((bead) => ({ ...bead, kind: "BEAD" as const })),
    ...design.accessories
      .filter(
        (
          accessory
        ): accessory is Extract<
          PublicDesignV1["accessories"][number],
          { placementMode: "INLINE" }
        > => accessory.placementMode === "INLINE"
      )
      .map((accessory) => ({ ...accessory, kind: "ACCESSORY" as const }))
  ].sort((left, right) => left.positionIndex - right.positionIndex);
}

function beadColor(materialKey: string): string {
  if (materialKey.includes("aquamarine")) return "#9fcbd5";
  if (materialKey.includes("moonstone")) return "#e9e6de";
  if (materialKey.includes("quartz")) return "#d8e1df";
  if (materialKey.includes("amethyst")) return "#aa96bd";
  return "#b8adbe";
}

export function BraceletSequenceEditor({
  design,
  selectedComponentId,
  busy,
  onSelect,
  onMove,
  onRemove
}: {
  design: PublicDesignV1;
  selectedComponentId: string;
  busy: boolean;
  onSelect: (componentId: string) => void;
  onMove: (componentId: string, targetPositionIndex: number) => void;
  onRemove: (componentId: string) => void;
}) {
  const components = ringComponents(design);
  const [draggedComponentId, setDraggedComponentId] = React.useState("");
  const [dropPositionIndex, setDropPositionIndex] = React.useState<number | null>(null);
  const removalComponentId = draggedComponentId || selectedComponentId;
  const selected = components.find(({ componentId }) => componentId === removalComponentId);
  const selectedIsBead = selected?.kind === "BEAD";
  const anchorsAccessory = design.accessories.some(
    (accessory) =>
      accessory.placementMode === "ANCHORED" &&
      accessory.anchorComponentId === removalComponentId
  );
  const canRemove = selectedIsBead && design.beads.length > 1 && !anchorsAccessory;

  const clearDrag = () => {
    setDraggedComponentId("");
    setDropPositionIndex(null);
  };

  return (
    <section
      className="mt-4 w-full rounded-[1.35rem] border border-white/80 bg-white/70 p-4 shadow-[0_12px_35px_rgb(57_45_67/0.08)] backdrop-blur"
      aria-labelledby="bracelet-sequence-title"
      data-sequence-editor="true"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[0.68rem] uppercase tracking-[0.2em] text-[var(--accent)]">Bracelet order</p>
          <h3 className="mt-1 font-serif text-lg" id="bracelet-sequence-title">拖动珠子调整顺序</h3>
        </div>
        <p className="text-xs text-[var(--muted)]">点击选中 · 拖动排序 · 拖到移除区删除</p>
      </div>

      <ol className="mt-4 flex min-h-20 items-center gap-2 overflow-x-auto rounded-2xl bg-[var(--surface-soft)]/70 p-3" aria-label="当前手串顺序">
        {components.map((component) => {
          const isBead = component.kind === "BEAD";
          const selectedNow = component.componentId === selectedComponentId;
          const dropTarget = dropPositionIndex === component.positionIndex;
          return (
            <li
              className={`shrink-0 rounded-2xl transition ${dropTarget ? "bg-[var(--accent-soft)] ring-2 ring-[var(--accent)]/45" : ""}`}
              key={component.componentId}
              onDragOver={(event) => {
                if (!draggedComponentId || busy) return;
                event.preventDefault();
                setDropPositionIndex(component.positionIndex);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedComponentId && draggedComponentId !== component.componentId) {
                  onMove(draggedComponentId, component.positionIndex);
                }
                clearDrag();
              }}
            >
              <button
                aria-label={isBead ? `第 ${component.positionIndex + 1} 颗珠子，拖动可调整位置` : `第 ${component.positionIndex + 1} 个配件`}
                aria-pressed={selectedNow}
                className={`group flex min-h-14 min-w-16 cursor-grab flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-2 active:cursor-grabbing ${selectedNow ? "border-[var(--accent)] bg-white shadow-sm" : "border-transparent hover:border-[var(--border)] hover:bg-white/70"}`}
                data-component-id={component.componentId}
                draggable={isBead && !busy}
                onClick={() => isBead && onSelect(component.componentId)}
                onDragEnd={clearDrag}
                onDragStart={(event) => {
                  if (!isBead || busy) return;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", component.componentId);
                  setDraggedComponentId(component.componentId);
                  onSelect(component.componentId);
                }}
                type="button"
              >
                <span
                  className={`block rounded-full border border-white shadow-[inset_-3px_-4px_7px_rgb(59_44_69/0.16),0_3px_8px_rgb(57_45_67/0.12)] ${isBead ? "h-8 w-8" : "h-5 w-5 bg-[#c9b78f]"}`}
                  style={isBead ? { background: beadColor(component.materialKey) } : undefined}
                />
                <span className="text-[0.65rem] text-[var(--muted)]">{component.positionIndex + 1}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div
        className={`mt-3 grid min-h-14 place-items-center rounded-2xl border border-dashed px-4 text-center text-xs transition ${draggedComponentId && canRemove ? "border-[var(--danger)] bg-[var(--danger)]/8 text-[var(--danger)]" : "border-[var(--border)] text-[var(--muted)]"}`}
        data-remove-drop-zone="true"
        onDragOver={(event) => {
          if (!draggedComponentId || !canRemove || busy) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (draggedComponentId && canRemove) onRemove(draggedComponentId);
          clearDrag();
        }}
      >
        {anchorsAccessory
          ? "这颗珠子连接着挂饰，暂时不能删除"
          : design.beads.length <= 1
            ? "手串至少需要保留一颗珠子"
            : "不想保留？把珠子拖到这里移除"}
      </div>
    </section>
  );
}
