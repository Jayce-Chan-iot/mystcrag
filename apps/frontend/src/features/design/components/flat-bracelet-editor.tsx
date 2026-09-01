"use client";

import { createBraceletLayout, normalizeAngle, resolveSlotAtAngle, type BraceletLayoutResult } from "@mystcrag/bracelet-engine";
import type { PublicDesignV1 } from "@mystcrag/design-contract";
import Image from "next/image";
import * as React from "react";

import { evaluateBraceletFit, inlineAccessoryLengthMm, type BraceletFit } from "../model/bracelet-fit";
import { isPointOutsideTray, type DisplayTrayMaterial } from "../model/display-tray";
import { CrystalBeadImage } from "./crystal-bead-image";
import { DisplayTray } from "./display-tray";

export type RingComponent =
  | (PublicDesignV1["beads"][number] & { kind: "BEAD" })
  | (Extract<PublicDesignV1["accessories"][number], { placementMode: "INLINE" }> & { kind: "ACCESSORY" });

type DragState = {
  componentId: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  nearRing: boolean;
  outsideTray: boolean;
  targetPositionIndex: number;
};

function ringComponents(design: PublicDesignV1): RingComponent[] {
  return [
    ...design.beads.map((bead) => ({ ...bead, kind: "BEAD" as const })),
    ...design.accessories
      .filter((accessory): accessory is Extract<PublicDesignV1["accessories"][number], { placementMode: "INLINE" }> => accessory.placementMode === "INLINE")
      .map((accessory) => ({ ...accessory, kind: "ACCESSORY" as const }))
  ].sort((left, right) => left.positionIndex - right.positionIndex);
}

function componentLengthMm(component: RingComponent): number {
  return component.kind === "BEAD"
    ? component.lengthAlongStringMm ?? component.diameterMm
    : inlineAccessoryLengthMm(component);
}

export function connectedRingRadiusPercent(circumferenceMm: number) {
  return Math.min(39, Math.max(24, circumferenceMm * 0.22));
}

export function calculateSizeAwareRingLayout(components: RingComponent[], connected: boolean) {
  const lengths = components.map((component) => Math.max(1, componentLengthMm(component)));
  const totalLengthMm = lengths.reduce((total, length) => total + length, 0);
  const radiusPercent = connected ? connectedRingRadiusPercent(totalLengthMm) : 39;
  const availableCircumferencePercent = Math.PI * 2 * radiusPercent * 0.92;
  const percentPerMm = Math.min(1.55, availableCircumferencePercent / Math.max(1, totalLengthMm));
  const engineLayout = createBraceletLayout(
    components.map((component, index) => ({ componentId: component.componentId, widthMm: lengths[index] ?? 1 })),
    { center: { x: 50, y: 50 }, gapMm: connected ? 0 : 0.8, rotationRad: -Math.PI / 2 }
  );

  return components.map((component, index) => {
    const lengthMm = lengths[index] ?? 1;
    const slot = engineLayout.slots[index];
    const angle = slot?.angle ?? -Math.PI / 2;
    return {
      angle,
      component,
      endAngle: slot?.endAngle ?? Math.PI * 2,
      heightPercent: lengthMm * percentPerMm,
      leftPercent: 50 + Math.cos(angle) * radiusPercent,
      radiusPercent,
      startAngle: slot?.startAngle ?? 0,
      topPercent: 50 + Math.sin(angle) * radiusPercent,
      widthPercent: lengthMm * percentPerMm
    };
  });
}

export function targetPositionForAngle(layout: ReturnType<typeof calculateSizeAwareRingLayout>, angle: number, fallback: number) {
  const engineLayout: BraceletLayoutResult = {
    center: { x: 0, y: 0 },
    circumference: 0,
    gapMm: 0,
    radius: 1,
    slots: layout.map((item, index) => ({
      angle: item.angle,
      componentId: item.component.componentId,
      endAngle: item.endAngle,
      height: 1,
      index,
      rotation: 0,
      startAngle: item.startAngle,
      width: 1,
      x: 0,
      y: 0
    }))
  };
  const slot = resolveSlotAtAngle(engineLayout, angle);
  return layout.find((item) => item.component.componentId === slot?.componentId)?.component.positionIndex ?? fallback;
}

// Mirrors the Backend splice-out/splice-in MOVE semantics so the optimistic
// projection and the visual reflow preview never disagree.
export function previewMovedRing(
  components: readonly RingComponent[],
  componentId: string,
  targetPositionIndex: number
): RingComponent[] {
  const index = components.findIndex((component) => component.componentId === componentId);
  if (index < 0 || targetPositionIndex < 0 || targetPositionIndex >= components.length) return [...components];
  const next = [...components];
  const [component] = next.splice(index, 1);
  next.splice(Math.max(0, targetPositionIndex), 0, component!);
  return next;
}

export function dragMetrics(rect: DOMRect, clientX: number, clientY: number, ringRadiusPercent: number) {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const ringRadius = rect.width * (ringRadiusPercent / 100);
  const distance = Math.hypot(x - centerX, y - centerY);
  // Slots are positioned with cos/sin in this same stage frame, so the pointer
  // angle is the plain atan2; any extra rotation offsets every drop target.
  const angle = normalizeAngle(Math.atan2(y - centerY, x - centerX));
  return {
    angle,
    nearRing: Math.abs(distance - ringRadius) <= rect.width * 0.16,
    outsideTray: isPointOutsideTray({ x, y }, rect),
    x,
    y
  };
}

export function FlatBraceletEditor({
  design,
  selectedComponentId,
  busy,
  connected = false,
  trayMaterial = "BONE_CHINA",
  fit: providedFit,
  fitDesktopViewport = false,
  onSelect,
  onMove,
  onRemove
}: {
  design: PublicDesignV1;
  selectedComponentId: string;
  busy: boolean;
  connected?: boolean;
  trayMaterial?: DisplayTrayMaterial;
  fit?: BraceletFit;
  fitDesktopViewport?: boolean;
  onSelect: (componentId: string) => void;
  onMove: (componentId: string, targetPositionIndex: number) => void;
  onRemove: (componentId: string) => void;
}) {
  const fit = providedFit ?? evaluateBraceletFit(design);
  const components = ringComponents(design);
  const componentLayouts = calculateSizeAwareRingLayout(components, connected);
  const ringRadiusPercent = componentLayouts[0]?.radiusPercent ?? 39;
  const stageRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<DragState | null>(null);
  const nativeDragIdRef = React.useRef("");
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [nativeDraggedComponentId, setNativeDraggedComponentId] = React.useState("");
  const [nativeOutsideTray, setNativeOutsideTray] = React.useState(false);
  const [nativeDragTarget, setNativeDragTarget] = React.useState<number | null>(null);

  const canRemove = (componentId: string) => {
    const component = components.find((item) => item.componentId === componentId);
    if (!component || component.kind !== "BEAD" || design.beads.length <= 1) return false;
    return !design.accessories.some((accessory) => accessory.placementMode === "ANCHORED" && accessory.anchorComponentId === componentId);
  };

  const commitDrag = (nextDrag: DragState | null) => {
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  };

  const clearDrag = () => commitDrag(null);
  const clearNativeDrag = () => {
    nativeDragIdRef.current = "";
    setNativeDraggedComponentId("");
    setNativeOutsideTray(false);
    setNativeDragTarget(null);
  };

  const updateDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const currentDrag = dragRef.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const metrics = dragMetrics(rect, event.clientX, event.clientY, ringRadiusPercent);
    const moved = currentDrag.moved || Math.hypot(event.clientX - currentDrag.startX, event.clientY - currentDrag.startY) > 5;
    commitDrag({
      ...currentDrag,
      x: (metrics.x / rect.width) * 100,
      y: (metrics.y / rect.height) * 100,
      moved,
      nearRing: metrics.nearRing,
      outsideTray: metrics.outsideTray,
      targetPositionIndex: targetPositionForAngle(componentLayouts, metrics.angle, currentDrag.targetPositionIndex)
    });
  };

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const currentDrag = dragRef.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    let nearRing = currentDrag.nearRing;
    let outsideTray = currentDrag.outsideTray;
    let targetPositionIndex = currentDrag.targetPositionIndex;
    if (stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      const metrics = dragMetrics(rect, event.clientX, event.clientY, ringRadiusPercent);
      nearRing = metrics.nearRing;
      outsideTray = metrics.outsideTray;
      targetPositionIndex = targetPositionForAngle(componentLayouts, metrics.angle, targetPositionIndex);
    }
    if (currentDrag.moved) {
      if (outsideTray && canRemove(currentDrag.componentId)) onRemove(currentDrag.componentId);
      else if (nearRing) onMove(currentDrag.componentId, targetPositionIndex);
    } else {
      onSelect(currentDrag.componentId);
    }
    clearDrag();
  };

  const pointerReflowActive = Boolean(drag && drag.moved && drag.nearRing && !drag.outsideTray);
  const nativeReflowActive = Boolean(nativeDraggedComponentId && !nativeOutsideTray && nativeDragTarget !== null);
  const reflowComponentId = pointerReflowActive && drag ? drag.componentId : nativeDraggedComponentId;
  const reflowTargetIndex = pointerReflowActive && drag ? drag.targetPositionIndex : nativeDragTarget ?? 0;
  const reflowActive = (pointerReflowActive || nativeReflowActive)
    && components.some((component) => component.componentId === reflowComponentId);
  const previewComponents = reflowActive ? previewMovedRing(components, reflowComponentId, reflowTargetIndex) : components;
  const previewLayouts = previewComponents === components
    ? componentLayouts
    : calculateSizeAwareRingLayout(previewComponents, connected);
  const draggedSlotLayout = reflowActive
    ? previewLayouts.find((item) => item.component.componentId === reflowComponentId)
    : undefined;

  return (
    <div
      aria-label="2D 手串编辑预览"
      className="relative mx-auto aspect-square w-full max-w-[35rem] select-none"
      data-bracelet-layout={connected ? "connected" : "spread"}
      data-drag-reflow-active={reflowActive}
      data-flat-bracelet-editor="true"
      style={fitDesktopViewport ? { maxWidth: "clamp(14rem, calc(100dvh - 20.5rem), 35rem)" } : undefined}
      onDragOver={(event) => {
        const componentId = nativeDragIdRef.current;
        if (!componentId || !stageRef.current) return;
        event.preventDefault();
        const rect = stageRef.current.getBoundingClientRect();
        const metrics = dragMetrics(rect, event.clientX, event.clientY, ringRadiusPercent);
        setNativeOutsideTray(metrics.outsideTray);
        setNativeDragTarget(metrics.nearRing ? targetPositionForAngle(componentLayouts, metrics.angle, 0) : null);
      }}
      onDrop={(event) => {
        const componentId = nativeDragIdRef.current;
        if (!componentId || !stageRef.current) return;
        event.preventDefault();
        const rect = stageRef.current.getBoundingClientRect();
        const metrics = dragMetrics(rect, event.clientX, event.clientY, ringRadiusPercent);
        if (metrics.outsideTray && canRemove(componentId)) onRemove(componentId);
        else if (metrics.nearRing) {
          onMove(componentId, targetPositionForAngle(componentLayouts, metrics.angle, 0));
        }
        clearNativeDrag();
      }}
      ref={stageRef}
    >
      <DisplayTray material={trayMaterial} />

      {reflowActive && draggedSlotLayout ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute z-0 block -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-[var(--accent)] bg-[var(--accent-soft)]/55 transition-[left,top] duration-200 motion-reduce:transition-none"
          data-drag-target-slot="true"
          style={{
            height: `${draggedSlotLayout.heightPercent}%`,
            left: `${draggedSlotLayout.leftPercent}%`,
            top: `${draggedSlotLayout.topPercent}%`,
            width: `${draggedSlotLayout.widthPercent}%`
          }}
        />
      ) : null}

      {drag?.moved || nativeDraggedComponentId ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-20"
          data-tray-removal-active={drag?.outsideTray || nativeOutsideTray}
        >
          <div className={`absolute inset-[3%] rounded-full border-2 border-dashed transition-colors ${(drag?.outsideTray || nativeOutsideTray) ? "border-[var(--danger)]" : "border-[var(--danger)]/55"}`} />
          <div className={`absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-white/95 px-4 py-2 text-xs font-medium shadow-[0_8px_24px_rgb(57_45_67/0.12)] ${(drag?.outsideTray || nativeOutsideTray) ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--border)] text-[var(--ink-soft)]"}`}>
            {canRemove(drag?.componentId ?? nativeDraggedComponentId)
              ? (drag?.outsideTray || nativeOutsideTray) ? "松手移出当前手串" : "拖出托盘即可删除"
              : "这颗珠子暂时不能删除"}
          </div>
        </div>
      ) : null}

      {!drag?.moved && !nativeDraggedComponentId && fit.message ? (
        <div
          aria-live="polite"
          className={`pointer-events-none absolute left-1/2 top-1/2 z-20 w-[min(70%,17rem)] -translate-x-1/2 -translate-y-1/2 px-3 py-2 text-center ${
            fit.status === "TOO_LARGE"
              ? "text-amber-800"
              : "text-[var(--accent-deep)]"
          }`}
          data-bracelet-fit-status={fit.status}
          role="status"
        >
          <strong className="block text-sm font-semibold">{fit.message}</strong>
          <span className="mt-1 block text-xs opacity-75">常见建议范围：13.0–20.0cm，不影响完成设计</span>
        </div>
      ) : null}

      {previewLayouts.map(({ component, heightPercent, leftPercent: defaultX, topPercent: defaultY, widthPercent }, index) => {
        const dragging = drag?.componentId === component.componentId;
        const isBead = component.kind === "BEAD";
        const selected = component.componentId === selectedComponentId;
        const width = `${isBead ? widthPercent : Math.max(9, widthPercent * 1.35)}%`;
        const height = `${isBead ? heightPercent : Math.max(5.5, heightPercent * 0.84)}%`;
        const left = dragging && drag ? `${drag.x}%` : `${defaultX}%`;
        const top = dragging && drag ? `${drag.y}%` : `${defaultY}%`;

        return (
          <button
            aria-label={isBead ? `第 ${component.positionIndex + 1} 颗珠子，拖动可调整位置` : `第 ${component.positionIndex + 1} 个配件`}
            aria-pressed={isBead ? selected : undefined}
            className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full transition-[transform,left,top] duration-300 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${isBead ? "cursor-grab active:cursor-grabbing" : "cursor-default"} ${selected ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]" : ""} ${dragging ? "z-30 scale-110 cursor-grabbing transition-none drop-shadow-[0_16px_20px_rgb(57_45_67/0.32)]" : "hover:scale-105"}`}
            data-component-id={component.componentId}
            data-drag-lifted={dragging || undefined}
            disabled={busy || !isBead}
            draggable={isBead && !busy}
            key={component.componentId}
            onDragEnd={(event) => {
              const componentId = nativeDragIdRef.current;
              if (componentId && stageRef.current) {
                const rect = stageRef.current.getBoundingClientRect();
                const metrics = dragMetrics(rect, event.clientX, event.clientY, ringRadiusPercent);
                if (metrics.outsideTray && canRemove(componentId)) {
                  onRemove(componentId);
                } else if (metrics.nearRing) {
                  onMove(componentId, targetPositionForAngle(componentLayouts, metrics.angle, 0));
                }
              }
              clearNativeDrag();
            }}
            onDragStart={(event) => {
              if (!isBead || busy) return;
              clearDrag();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", component.componentId);
              nativeDragIdRef.current = component.componentId;
              setNativeDraggedComponentId(component.componentId);
              onSelect(component.componentId);
            }}
            onFocus={() => { if (isBead) onSelect(component.componentId); }}
            onKeyDown={(event) => {
              if (!isBead || busy) return;
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                onMove(component.componentId, Math.max(0, component.positionIndex - 1));
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                onMove(component.componentId, Math.min(components.length - 1, component.positionIndex + 1));
              }
              if ((event.key === "Delete" || event.key === "Backspace") && canRemove(component.componentId)) {
                event.preventDefault();
                onRemove(component.componentId);
              }
            }}
            onPointerCancel={clearDrag}
            onPointerDown={(event) => {
              if (!isBead || busy || !stageRef.current) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              const rect = stageRef.current.getBoundingClientRect();
              commitDrag({
                componentId: component.componentId,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                x: ((event.clientX - rect.left) / rect.width) * 100,
                y: ((event.clientY - rect.top) / rect.height) * 100,
                moved: false,
                nearRing: true,
                outsideTray: false,
                targetPositionIndex: component.positionIndex
              });
              onSelect(component.componentId);
            }}
            onPointerMove={updateDrag}
            onPointerUp={finishDrag}
            style={{ height, left, top, width }}
            type="button"
          >
            {isBead ? (
              <CrystalBeadImage alt="" materialKey={component.materialKey} priority={index < 8} sizes="(max-width: 640px) 16vw, 92px" />
            ) : (
              <Image
                alt=""
                className="h-full w-full object-contain drop-shadow-[0_8px_8px_rgb(57_45_67/0.2)]"
                fetchPriority={index < 4 ? "high" : "auto"}
                height={512}
                loading="eager"
                sizes="(max-width: 640px) 24vw, 125px"
                src="/accessories/silver-star-ring-charm.png"
                width={512}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
