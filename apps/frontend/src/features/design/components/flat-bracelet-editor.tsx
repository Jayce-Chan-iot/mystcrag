"use client";

import { createBraceletLayout, resolveSlotAtAngle, type BraceletLayoutResult } from "@mystcrag/bracelet-engine";
import type { PublicDesignV1 } from "@mystcrag/design-contract";
import Image from "next/image";
import * as React from "react";

import { evaluateBraceletFit, inlineAccessoryLengthMm, type BraceletFit } from "../model/bracelet-fit";
import { CrystalBeadImage } from "./crystal-bead-image";

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
  overDeleteZone: boolean;
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
  return component.kind === "BEAD" ? component.diameterMm : inlineAccessoryLengthMm(component);
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

function targetPositionForAngle(layout: ReturnType<typeof calculateSizeAwareRingLayout>, angle: number, fallback: number) {
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

export function FlatBraceletEditor({
  design,
  selectedComponentId,
  busy,
  connected = false,
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
  const [nativeOverDeleteZone, setNativeOverDeleteZone] = React.useState(false);

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
    setNativeOverDeleteZone(false);
  };

  const updateDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const currentDrag = dragRef.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const ringRadius = rect.width * (ringRadiusPercent / 100);
    const distance = Math.hypot(x - centerX, y - centerY);
    const angle = (Math.atan2(y - centerY, x - centerX) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    const moved = currentDrag.moved || Math.hypot(event.clientX - currentDrag.startX, event.clientY - currentDrag.startY) > 5;
    commitDrag({
      ...currentDrag,
      x: (x / rect.width) * 100,
      y: (y / rect.height) * 100,
      moved,
      nearRing: Math.abs(distance - ringRadius) <= rect.width * 0.16,
      overDeleteZone: distance <= rect.width * 0.16,
      targetPositionIndex: targetPositionForAngle(componentLayouts, angle, currentDrag.targetPositionIndex)
    });
  };

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const currentDrag = dragRef.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    let nearRing = currentDrag.nearRing;
    let overDeleteZone = currentDrag.overDeleteZone;
    let targetPositionIndex = currentDrag.targetPositionIndex;
    if (stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const ringRadius = rect.width * (ringRadiusPercent / 100);
      const distance = Math.hypot(x - centerX, y - centerY);
      const angle = (Math.atan2(y - centerY, x - centerX) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
      nearRing = Math.abs(distance - ringRadius) <= rect.width * 0.16;
      overDeleteZone = distance <= rect.width * 0.16;
      targetPositionIndex = targetPositionForAngle(componentLayouts, angle, targetPositionIndex);
    }
    if (currentDrag.moved) {
      if (overDeleteZone && canRemove(currentDrag.componentId)) onRemove(currentDrag.componentId);
      else if (nearRing) onMove(currentDrag.componentId, targetPositionIndex);
    } else {
      onSelect(currentDrag.componentId);
    }
    clearDrag();
  };

  return (
    <div
      aria-label="2D 手串编辑预览"
      className={`relative mx-auto aspect-square w-full select-none ${fitDesktopViewport ? "max-w-[min(35rem,calc(100dvh-20.5rem))]" : "max-w-[35rem]"}`}
      data-bracelet-layout={connected ? "connected" : "spread"}
      data-flat-bracelet-editor="true"
      onDragOver={(event) => {
        const componentId = nativeDragIdRef.current;
        if (!componentId || !stageRef.current) return;
        event.preventDefault();
        const rect = stageRef.current.getBoundingClientRect();
        const distance = Math.hypot(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
        setNativeOverDeleteZone(distance <= rect.width * 0.16);
      }}
      onDrop={(event) => {
        const componentId = nativeDragIdRef.current;
        if (!componentId || !stageRef.current) return;
        event.preventDefault();
        const rect = stageRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const distance = Math.hypot(x - centerX, y - centerY);
        const ringRadius = rect.width * (ringRadiusPercent / 100);
        const angle = (Math.atan2(y - centerY, x - centerX) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
        if (distance <= rect.width * 0.16 && canRemove(componentId)) onRemove(componentId);
        else if (Math.abs(distance - ringRadius) <= rect.width * 0.16) {
          onMove(componentId, targetPositionForAngle(componentLayouts, angle, 0));
        }
        clearNativeDrag();
      }}
      ref={stageRef}
    >
      {drag?.moved || nativeDraggedComponentId ? (
        <div
          aria-live="polite"
          className={`pointer-events-none absolute left-1/2 top-1/2 z-20 grid h-28 w-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-dashed px-3 text-center text-xs font-medium shadow-[0_12px_35px_rgb(57_45_67/0.12)] transition ${(drag?.overDeleteZone || nativeOverDeleteZone) ? "scale-110 border-[var(--danger)] bg-white/96 text-[var(--danger)]" : "border-[var(--danger)]/55 bg-white/88 text-[var(--danger)]"}`}
          data-remove-drop-zone="true"
          data-remove-drop-zone-active={drag?.overDeleteZone || nativeOverDeleteZone}
        >
          {canRemove(drag?.componentId ?? nativeDraggedComponentId)
            ? (drag?.overDeleteZone || nativeOverDeleteZone) ? "松手删除这颗珠子" : "拖到这里删除"
            : "这颗珠子暂时不能删除"}
        </div>
      ) : null}

      {!drag?.moved && !nativeDraggedComponentId && fit.message ? (
        <div
          aria-live="polite"
          className={`pointer-events-none absolute left-1/2 top-1/2 z-20 w-[min(78%,18rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-white/86 px-5 py-4 text-center shadow-[0_12px_35px_rgb(57_45_67/0.10)] backdrop-blur-sm ${
            fit.status === "TOO_LARGE"
              ? "border-amber-300/80 text-amber-800"
              : "border-[var(--accent)]/25 text-[var(--accent-deep)]"
          }`}
          data-bracelet-fit-status={fit.status}
          role="status"
        >
          <strong className="block text-sm font-semibold">{fit.message}</strong>
          <span className="mt-1 block text-xs opacity-75">可完成手围范围：13.0–20.0cm</span>
        </div>
      ) : null}

      {componentLayouts.map(({ component, heightPercent, leftPercent: defaultX, topPercent: defaultY, widthPercent }, index) => {
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
            className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full transition-[transform,left,top] duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${isBead ? "cursor-grab active:cursor-grabbing" : "cursor-default"} ${selected ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]" : ""} ${dragging ? "z-30 cursor-grabbing transition-none" : "hover:scale-105"}`}
            data-component-id={component.componentId}
            disabled={busy || !isBead}
            draggable={isBead && !busy}
            key={component.componentId}
            onDragEnd={clearNativeDrag}
            onDragStart={(event) => {
              if (!isBead || busy) return;
              clearDrag();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", component.componentId);
              nativeDragIdRef.current = component.componentId;
              setNativeDraggedComponentId(component.componentId);
              onSelect(component.componentId);
            }}
            onKeyDown={(event) => {
              if (!isBead || busy) return;
              if (event.key === "ArrowLeft") onMove(component.componentId, Math.max(0, component.positionIndex - 1));
              if (event.key === "ArrowRight") onMove(component.componentId, Math.min(components.length - 1, component.positionIndex + 1));
              if ((event.key === "Delete" || event.key === "Backspace") && canRemove(component.componentId)) onRemove(component.componentId);
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
                overDeleteZone: false,
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
