"use client";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import Image from "next/image";
import * as React from "react";

import type { DisplayTrayMaterial } from "../model/display-tray";
import {
  chooseLooseMotionMode,
  consumeFrameDelta,
  observeElementSize,
  shouldForceFallback,
  trackSlowFrame,
  type FrameBudgetTracker,
  type LooseMotionMode
} from "../model/loose-bead-motion";
import {
  MAX_PHYSICS_BODIES,
  deterministicFallbackLayout,
  injectLooseParticle,
  seedLooseParticles,
  stepLoosePhysics,
  type LooseBounds,
  type LooseBodyInput,
  type LooseParticle,
  type LoosePhysicsState
} from "../model/loose-bead-physics";
import { getTrayVisual } from "../model/visual-assets";
import { CrystalBeadImage } from "./crystal-bead-image";
import { DisplayTray } from "./display-tray";

export type BeadLaunchIntent = {
  requestId: string;
  componentId: string;
  originClientX: number;
  originClientY: number;
};

export type LooseBeadStageProps = {
  busy: boolean;
  design: PublicDesignV1;
  launchQueue: readonly BeadLaunchIntent[];
  onLaunchConsumed: (requestId: string) => void;
  onSelect: (componentId: string) => void;
  selectedComponentId: string;
  trayMaterial: DisplayTrayMaterial;
};

const DEFAULT_STAGE_SIZE = 320;
const DEFAULT_BOUNDS: LooseBounds = {
  centerX: DEFAULT_STAGE_SIZE / 2,
  centerY: DEFAULT_STAGE_SIZE / 2,
  innerRadiusPx: DEFAULT_STAGE_SIZE * 0.37
};
const COLLISION_TOLERANCE_PX = 1.5;
const HARD_STOP_MS = 3000;

export function mmToRadiusPx(diameterMm: number, innerRadiusPx: number): number {
  const safeMm = Number.isFinite(diameterMm) && diameterMm > 0 ? diameterMm : 6;
  const scale = innerRadiusPx / 56;
  return Math.max(4, (safeMm / 2) * scale * 1.08);
}

export type LooseDerivedBodies = {
  anchored: Array<{ componentId: string; label: string }>;
  physical: LooseBodyInput[];
};

export function deriveLooseBodies(design: PublicDesignV1, innerRadiusPx: number): LooseDerivedBodies {
  const physical: LooseBodyInput[] = design.beads.map((bead) => ({
    componentId: bead.componentId,
    kind: "BEAD" as const,
    radiusPx: mmToRadiusPx(bead.diameterMm, innerRadiusPx)
  }));
  for (const accessory of design.accessories) {
    if (accessory.placementMode !== "INLINE") continue;
    const width = accessory.dimensions.widthMm ?? accessory.dimensions.diameterMm ?? 10;
    const height = accessory.dimensions.heightMm ?? accessory.dimensions.diameterMm ?? width;
    const largest = Math.max(width, height);
    physical.push({
      componentId: accessory.componentId,
      kind: "INLINE_ACCESSORY",
      radiusPx: mmToRadiusPx(largest, innerRadiusPx)
    });
  }
  const anchored = design.accessories
    .filter((accessory) => accessory.placementMode === "ANCHORED")
    .map((accessory) => ({
      componentId: accessory.componentId,
      label: accessory.accessoryProductId
    }));
  return { anchored, physical };
}

export function reconcileLooseParticles(
  state: LoosePhysicsState,
  inputs: readonly LooseBodyInput[],
  bounds: LooseBounds
): LoosePhysicsState {
  const nextInputs = inputs.slice(0, MAX_PHYSICS_BODIES);
  const overflow = inputs.slice(MAX_PHYSICS_BODIES).map((input) => input.componentId);
  const existing = new Map(state.particles.map((particle) => [particle.componentId, particle]));
  const kept: LooseParticle[] = [];
  for (const input of nextInputs) {
    const prior = existing.get(input.componentId);
    if (prior) {
      kept.push({ ...prior, kind: input.kind, radiusPx: input.radiusPx });
      continue;
    }
    const seeded = injectLooseParticle(
      { ...state, particles: kept, settled: false },
      input,
      { x: bounds.centerX, y: bounds.centerY - bounds.innerRadiusPx },
      bounds
    );
    const injected = seeded.particles.at(-1);
    if (injected) kept.push(injected);
  }
  if (kept.length === state.particles.length && overflow.length === 0) {
    const same = kept.every((particle, index) => particle.componentId === state.particles[index]?.componentId);
    if (same) {
      return { ...state, particles: kept, settled: false };
    }
  }
  const relaxed = seedLooseParticles(
    kept.map((particle) => ({
      componentId: particle.componentId,
      radiusPx: particle.radiusPx,
      kind: particle.kind
    })),
    bounds
  );
  return {
    elapsedMs: state.elapsedMs,
    overflowComponentIds: [...relaxed.overflowComponentIds, ...overflow],
    particles: relaxed.particles.map((particle) => ({
      ...particle,
      velocityX: 0,
      velocityY: 0,
      sleepingFrames: 0
    })),
    settled: false
  };
}

function anchorLabel(index: number): string {
  return `挂饰 ${index + 1}`;
}

export function LooseBeadStage({
  busy,
  design,
  launchQueue,
  onLaunchConsumed,
  onSelect,
  selectedComponentId,
  trayMaterial
}: LooseBeadStageProps) {
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const particleNodesRef = React.useRef(new Map<string, HTMLElement>());
  const physicsRef = React.useRef<LoosePhysicsState | null>(null);
  const boundsRef = React.useRef<LooseBounds>(DEFAULT_BOUNDS);
  const radiusScaleRef = React.useRef(DEFAULT_BOUNDS.innerRadiusPx);
  const rafRef = React.useRef<number | null>(null);
  const accumulatorRef = React.useRef(0);
  const lastTimeRef = React.useRef(0);
  const budgetRef = React.useRef<FrameBudgetTracker>({ slowFrames: 0 });
  const modeRef = React.useRef<LooseMotionMode>("PHYSICS");
  const consumedLaunchIdsRef = React.useRef(new Set<string>());
  const runningRef = React.useRef(false);
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [motionMode, setMotionMode] = React.useState<LooseMotionMode>("PHYSICS");

  const bodyCount =
    design.beads.length +
    design.accessories.filter((accessory) => accessory.placementMode === "INLINE").length;

  const derived = React.useMemo(
    () => deriveLooseBodies(design, DEFAULT_BOUNDS.innerRadiusPx),
    [design]
  );

  const initialParticles = React.useMemo(
    () => deterministicFallbackLayout(derived.physical, DEFAULT_BOUNDS).particles,
    [derived.physical]
  );

  const applyTransforms = React.useCallback((state: LoosePhysicsState) => {
    for (const particle of state.particles) {
      const node = particleNodesRef.current.get(particle.componentId);
      if (node) node.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0) translate(-50%, -50%)`;
    }
  }, []);

  const stopLoop = React.useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = null;
  }, []);

  const ensurePhysicsState = React.useCallback(
    (inputs: readonly LooseBodyInput[], bounds: LooseBounds): LoosePhysicsState => {
      if (!physicsRef.current) {
        physicsRef.current = seedLooseParticles(inputs, bounds);
        return physicsRef.current;
      }
      physicsRef.current = reconcileLooseParticles(physicsRef.current, inputs, bounds);
      return physicsRef.current;
    },
    []
  );

  const placeDeterministic = React.useCallback(
    (inputs: readonly LooseBodyInput[]) => {
      physicsRef.current = deterministicFallbackLayout(inputs, boundsRef.current);
      applyTransforms(physicsRef.current);
    },
    [applyTransforms]
  );

  const startLoop = React.useCallback(() => {
    if (runningRef.current) return;
    if (modeRef.current !== "PHYSICS") return;
    if (typeof requestAnimationFrame !== "function") return;
    runningRef.current = true;
    lastTimeRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    const frame = (time: number) => {
      if (!runningRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        stopLoop();
        return;
      }
      const delta = Math.max(0, time - lastTimeRef.current);
      lastTimeRef.current = time;
      budgetRef.current = trackSlowFrame(budgetRef.current, delta);
      if (shouldForceFallback(budgetRef.current)) {
        modeRef.current = "FALLBACK";
        setMotionMode("FALLBACK");
        const state = physicsRef.current;
        if (state) {
          placeDeterministic(
            state.particles.map((particle) => ({
              componentId: particle.componentId,
              radiusPx: particle.radiusPx,
              kind: particle.kind
            }))
          );
        }
        stopLoop();
        return;
      }
      const { accumulatorMs, steps } = consumeFrameDelta(accumulatorRef.current, delta);
      accumulatorRef.current = accumulatorMs;
      let state = physicsRef.current;
      if (!state || state.settled) {
        stopLoop();
        return;
      }
      for (let index = 0; index < steps; index += 1) {
        state = stepLoosePhysics(state, boundsRef.current);
        physicsRef.current = state;
        if (state.settled) break;
      }
      applyTransforms(state);
      if (state.settled || state.elapsedMs >= HARD_STOP_MS) {
        stopLoop();
        return;
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
  }, [applyTransforms, placeDeterministic, stopLoop]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => {
      const prefers = Boolean(media?.matches);
      setReducedMotion(prefers);
      const mode = chooseLooseMotionMode({
        bodyCount,
        prefersReducedMotion: prefers,
        requestAnimationFrameAvailable: typeof requestAnimationFrame === "function"
      });
      modeRef.current = mode;
      setMotionMode(mode);
      if (mode !== "PHYSICS") {
        // REDUCED motion and FALLBACK both skip the ballistic solver.
        stopLoop();
        placeDeterministic(deriveLooseBodies(design, boundsRef.current.innerRadiusPx).physical);
      }
    };
    update();
    media?.addEventListener?.("change", update);
    return () => {
      media?.removeEventListener?.("change", update);
      stopLoop();
    };
  }, [bodyCount, design, placeDeterministic, stopLoop]);

  React.useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height) || DEFAULT_STAGE_SIZE;
      const innerRadiusPx = size * getTrayVisual(trayMaterial).innerRadiusRatio;
      boundsRef.current = {
        centerX: rect.width / 2,
        centerY: rect.height / 2,
        innerRadiusPx
      };
      radiusScaleRef.current = innerRadiusPx;
      const inputs = deriveLooseBodies(design, innerRadiusPx).physical;
      if (modeRef.current !== "PHYSICS") {
        placeDeterministic(inputs);
        return;
      }
      const state = ensurePhysicsState(inputs, boundsRef.current);
      applyTransforms(state);
      startLoop();
    };
    measure();
    const ResizeObserverCtor = typeof ResizeObserver === "function" ? ResizeObserver : undefined;
    return observeElementSize(node, measure, {
      ResizeObserverCtor,
      windowTarget: typeof window === "undefined" ? undefined : window
    });
  }, [applyTransforms, design, ensurePhysicsState, placeDeterministic, startLoop, trayMaterial]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopLoop();
        return;
      }
      if (modeRef.current === "PHYSICS" && physicsRef.current && !physicsRef.current.settled) {
        startLoop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopLoop();
    };
  }, [startLoop, stopLoop]);

  React.useEffect(() => {
    stopLoop();
  }, [design.beads.length, stopLoop]);

  React.useEffect(() => {
    if (launchQueue.length === 0) return;
    for (const intent of launchQueue) {
      if (consumedLaunchIdsRef.current.has(intent.requestId)) continue;
      consumedLaunchIdsRef.current.add(intent.requestId);
      const exists =
        design.beads.some((bead) => bead.componentId === intent.componentId) ||
        design.accessories.some((accessory) => accessory.componentId === intent.componentId);
      if (!exists) continue;
      const inputs = deriveLooseBodies(design, boundsRef.current.innerRadiusPx).physical;
      const body = inputs.find((input) => input.componentId === intent.componentId);
      if (!body) continue;
      if (!physicsRef.current) {
        physicsRef.current = seedLooseParticles(
          inputs.filter((input) => input.componentId !== intent.componentId),
          boundsRef.current
        );
      }
      if (!physicsRef.current.particles.some((particle) => particle.componentId === intent.componentId)) {
        const stageRect = stageRef.current?.getBoundingClientRect();
        const origin = stageRect
          ? { x: intent.originClientX - stageRect.left, y: intent.originClientY - stageRect.top }
          : { x: boundsRef.current.centerX, y: boundsRef.current.centerY };
        physicsRef.current = injectLooseParticle(physicsRef.current, body, origin, boundsRef.current);
      }
      if (modeRef.current === "PHYSICS") {
        startLoop();
      } else {
        placeDeterministic(
          physicsRef.current.particles.map((particle) => ({
            componentId: particle.componentId,
            radiusPx: particle.radiusPx,
            kind: particle.kind
          }))
        );
      }
      onLaunchConsumed(intent.requestId);
    }
  }, [design, launchQueue, onLaunchConsumed, placeDeterministic, startLoop]);

  const overflowActive = bodyCount > MAX_PHYSICS_BODIES;
  const fallbackActive = motionMode !== "PHYSICS";
  const particleClass =
    fallbackActive || reducedMotion
      ? "transition-transform duration-150 motion-reduce:transition-none"
      : "transition-none";

  return (
    <div
      aria-label="散珠托盘"
      className="relative mx-auto aspect-square w-full max-w-[35rem] select-none overflow-hidden"
      data-loose-bead-stage="true"
      data-loose-motion-mode={motionMode}
      ref={stageRef}
    >
      <DisplayTray material={trayMaterial} />

      <div className="absolute inset-0 z-10" data-loose-particle-layer="true">
        {derived.physical.map((body) => {
          const seeded = initialParticles.find((particle) => particle.componentId === body.componentId);
          const selected = body.componentId === selectedComponentId;
          const bead = design.beads.find((item) => item.componentId === body.componentId);
          const sizePx = Math.max(12, body.radiusPx * 2 - COLLISION_TOLERANCE_PX * 2);
          return (
            <button
              aria-label={
                bead
                  ? `散珠：${bead.materialKey} ${bead.diameterMm}mm`
                  : `直通配饰 ${body.componentId}`
              }
              aria-pressed={selected}
              className={`absolute left-0 top-0 z-10 touch-none rounded-full ${particleClass} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                selected ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]" : ""
              }`}
              data-component-id={body.componentId}
              data-loose-bead={body.componentId}
              disabled={busy}
              key={body.componentId}
              onClick={() => onSelect(body.componentId)}
              ref={(node) => {
                if (node) {
                  particleNodesRef.current.set(body.componentId, node);
                  const live =
                    physicsRef.current?.particles.find((particle) => particle.componentId === body.componentId) ??
                    seeded;
                  if (live) node.style.transform = `translate3d(${live.x}px, ${live.y}px, 0) translate(-50%, -50%)`;
                } else {
                  particleNodesRef.current.delete(body.componentId);
                }
              }}
              style={{
                height: `${sizePx}px`,
                transform: seeded
                  ? `translate3d(${seeded.x}px, ${seeded.y}px, 0) translate(-50%, -50%)`
                  : undefined,
                width: `${sizePx}px`
              }}
              type="button"
            >
              {bead ? (
                <CrystalBeadImage
                  alt=""
                  materialKey={bead.materialKey}
                  priority
                  sizes="(max-width: 640px) 18vw, 96px"
                  textureAssetKey={bead.textureAssetKey}
                />
              ) : (
                <Image
                  alt=""
                  className="h-full w-full object-contain drop-shadow-[0_8px_8px_rgb(57_45_67/0.2)]"
                  height={256}
                  loading="eager"
                  sizes="64px"
                  src="/accessories/silver-star-ring-charm.png"
                  width={256}
                />
              )}
            </button>
          );
        })}
      </div>

      {derived.anchored.length > 0 ? (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
          data-loose-anchored-layer="true"
        >
          {derived.anchored.map((accessory, index) => (
            <span
              className="block h-16 w-16"
              data-anchored-accessory={accessory.componentId}
              key={accessory.componentId}
            >
              <Image
                alt={anchorLabel(index)}
                className="h-full w-full object-contain drop-shadow-[0_8px_8px_rgb(57_45_67/0.2)]"
                height={256}
                loading="eager"
                sizes="64px"
                src="/accessories/silver-star-ring-charm.png"
                width={256}
              />
            </span>
          ))}
        </div>
      ) : null}

      <div
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-3 z-30 text-center"
        data-loose-live-region="true"
      >
        {overflowActive ? (
          <p
            className="mx-auto w-fit rounded-full border border-amber-300 bg-amber-50/95 px-3 py-1 text-xs text-amber-900"
            data-loose-overflow-notice="true"
          >
            托盘空间已满，其他珠子将在成串预览中显示
          </p>
        ) : null}
      </div>
    </div>
  );
}
