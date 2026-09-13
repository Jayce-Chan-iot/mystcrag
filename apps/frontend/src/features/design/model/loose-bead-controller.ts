/**
 * Feature-local loose-bead stage coordinator.
 * Owns presentation-only particle state, launch injection order, bounded RAF,
 * wall-clock hard stop and responsive bounds. Never mutates DesignV1.
 */

import type { PublicDesignV1 } from "@mystcrag/design-contract";

import {
  chooseLooseMotionMode,
  consumeFrameDelta,
  shouldForceFallback,
  trackSlowFrame,
  type FrameBudgetTracker,
  type LooseMotionMode
} from "./loose-bead-motion";
import {
  HARD_STOP_MS,
  MAX_PHYSICS_BODIES,
  deterministicFallbackLayout,
  injectLooseParticle,
  seedLooseParticles,
  stepLoosePhysics,
  type LooseBounds,
  type LooseBodyInput,
  type LooseParticle,
  type LoosePhysicsState
} from "./loose-bead-physics";
import { getTrayVisual } from "./visual-assets";

export type BeadLaunchIntent = {
  requestId: string;
  componentId: string;
  originClientX: number;
  originClientY: number;
};

export type StageRect = { left: number; top: number; width: number; height: number };

export type LooseStageRuntime = {
  requestAnimationFrame: (callback: (time: number) => void) => number;
  cancelAnimationFrame: (handle: number) => void;
  now: () => number;
  matchMedia?: (query: string) => {
    matches: boolean;
    addEventListener?: (type: "change", listener: () => void) => void;
    removeEventListener?: (type: "change", listener: () => void) => void;
  };
  documentRef?: { visibilityState: DocumentVisibilityState };
};

export type LooseStageSnapshot = {
  particles: readonly LooseParticle[];
  overflowComponentIds: readonly string[];
  overflowActive: boolean;
  mode: LooseMotionMode;
  stageSizePx: number;
  innerRadiusPx: number;
  settled: boolean;
};

export type LooseStageControllerOptions = {
  runtime: LooseStageRuntime;
  innerRadiusRatio?: number;
  prefersReducedMotion?: boolean;
  onLaunchConsumed: (requestId: string) => void;
  onApplyTransforms: (particles: readonly LooseParticle[]) => void;
  onLayoutChanged?: (snapshot: LooseStageSnapshot) => void;
};

const MIN_HIT_TARGET_PX = 44;
const FALLBACK_STAGE_SIZE = 320;

export function hitTargetSizePx(imageSizePx: number): number {
  return Math.max(MIN_HIT_TARGET_PX, imageSizePx);
}

export function mmToRadiusPx(diameterMm: number, innerRadiusPx: number): number {
  const safeMm = Number.isFinite(diameterMm) && diameterMm > 0 ? diameterMm : 6;
  const scale = innerRadiusPx / 56;
  return Math.max(4, (safeMm / 2) * scale * 1.08);
}

export function deriveLooseBodies(design: PublicDesignV1, innerRadiusPx: number) {
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

function defaultBounds(innerRadiusPx: number): LooseBounds {
  return {
    centerX: FALLBACK_STAGE_SIZE / 2,
    centerY: FALLBACK_STAGE_SIZE / 2,
    innerRadiusPx
  };
}

function componentExists(design: PublicDesignV1, componentId: string): boolean {
  return (
    design.beads.some((bead) => bead.componentId === componentId) ||
    design.accessories.some((accessory) => accessory.componentId === componentId)
  );
}

function bodyFor(design: PublicDesignV1, componentId: string, innerRadiusPx: number): LooseBodyInput | undefined {
  return deriveLooseBodies(design, innerRadiusPx).physical.find((body) => body.componentId === componentId);
}

function reconcileKeepPositions(
  previous: LoosePhysicsState,
  inputs: readonly LooseBodyInput[],
  bounds: LooseBounds
): LoosePhysicsState {
  const existing = new Map(previous.particles.map((particle) => [particle.componentId, particle]));
  const nextInputs = inputs.slice(0, MAX_PHYSICS_BODIES);
  const hardOverflow = inputs.slice(MAX_PHYSICS_BODIES).map((input) => input.componentId);
  const missing = nextInputs.filter((input) => !existing.has(input.componentId));
  let state: LoosePhysicsState = {
    elapsedMs: previous.elapsedMs,
    overflowComponentIds: [...previous.overflowComponentIds, ...hardOverflow],
    particles: previous.particles.filter((particle) =>
      nextInputs.some((input) => input.componentId === particle.componentId)
    ),
    settled: previous.settled
  };
  // Rescale radii for kept particles without teleporting them.
  state = {
    ...state,
    particles: state.particles.map((particle) => {
      const input = nextInputs.find((candidate) => candidate.componentId === particle.componentId);
      return input ? { ...particle, kind: input.kind, radiusPx: input.radiusPx } : particle;
    })
  };
  if (missing.length === 0) {
    return { ...state, settled: false };
  }
  // Non-launch additions (undo/load) seed deterministically once.
  const seeded = seedLooseParticles(
    state.particles.map((particle) => ({
      componentId: particle.componentId,
      radiusPx: particle.radiusPx,
      kind: particle.kind
    })),
    bounds
  );
  const seededIds = new Set(seeded.particles.map((particle) => particle.componentId));
  const leftovers = missing.filter((input) => !seededIds.has(input.componentId));
  for (const input of leftovers) {
    const injected = injectLooseParticle(
      { ...seeded, particles: seeded.particles.filter((p) => p.componentId !== input.componentId) },
      input,
      { x: bounds.centerX, y: bounds.centerY - bounds.innerRadiusPx },
      bounds
    );
    const added = injected.particles.at(-1);
    if (added && !seeded.particles.some((p) => p.componentId === input.componentId)) {
      seeded.particles = [...seeded.particles, added];
    } else if (!added) {
      seeded.overflowComponentIds = [...seeded.overflowComponentIds, input.componentId];
    }
  }
  return {
    elapsedMs: state.elapsedMs,
    overflowComponentIds: [...new Set([...state.overflowComponentIds, ...seeded.overflowComponentIds])],
    particles: seeded.particles,
    settled: false
  };
}

export type LooseStageController = {
  sync(design: PublicDesignV1, launchQueue: readonly BeadLaunchIntent[], stageRect?: StageRect | null): void;
  setStageSize(widthPx: number, heightPx: number): void;
  setInnerRadiusRatio(ratio: number): void;
  setVisibility(hidden: boolean): void;
  setPrefersReducedMotion(prefers: boolean): void;
  getSnapshot(): LooseStageSnapshot;
  getBounds(): LooseBounds;
  destroy(): void;
  isRunning(): boolean;
};

export function createLooseStageController(options: LooseStageControllerOptions): LooseStageController {
  const runtime = options.runtime;
  const onLaunchConsumed = options.onLaunchConsumed;
  const onApplyTransforms = options.onApplyTransforms;
  const onLayoutChanged = options.onLayoutChanged ?? (() => undefined);

  let innerRadiusRatio = options.innerRadiusRatio ?? getTrayVisual("BONE_CHINA").innerRadiusRatio;
  let stageWidth = FALLBACK_STAGE_SIZE;
  let stageHeight = FALLBACK_STAGE_SIZE;
  let bounds: LooseBounds = defaultBounds(FALLBACK_STAGE_SIZE * innerRadiusRatio);
  let prefersReducedMotion = options.prefersReducedMotion ?? false;
  let mode: LooseMotionMode = chooseLooseMotionMode({
    bodyCount: 0,
    prefersReducedMotion,
    requestAnimationFrameAvailable: typeof runtime.requestAnimationFrame === "function"
  });
  let state: LoosePhysicsState = {
    elapsedMs: 0,
    overflowComponentIds: [],
    particles: [],
    settled: true
  };
  let bodyCount = 0;
  const consumedRequestIds = new Set<string>();
  const pendingLaunches = new Map<string, BeadLaunchIntent>();
  let rafHandle: number | null = null;
  let running = false;
  let accumulatorMs = 0;
  let lastFrameTime = 0;
  let loopStartedAt = 0;
  let budget: FrameBudgetTracker = { slowFrames: 0 };
  let destroyed = false;
  let hidden = false;
  let lastDesign: PublicDesignV1 | null = null;

  function recomputeBounds() {
    const size = Math.max(1, Math.min(stageWidth, stageHeight));
    bounds = {
      centerX: stageWidth / 2,
      centerY: stageHeight / 2,
      innerRadiusPx: size * innerRadiusRatio
    };
  }

  function snapshot(): LooseStageSnapshot {
    return {
      particles: state.particles,
      overflowComponentIds: state.overflowComponentIds,
      overflowActive: state.overflowComponentIds.length > 0 || bodyCount > MAX_PHYSICS_BODIES,
      mode,
      stageSizePx: Math.min(stageWidth, stageHeight),
      innerRadiusPx: bounds.innerRadiusPx,
      settled: state.settled
    };
  }

  function publishLayout() {
    onLayoutChanged(snapshot());
  }

  function stopLoop() {
    running = false;
    if (rafHandle !== null) {
      runtime.cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }

  function placeFallback(inputs: readonly LooseBodyInput[]) {
    state = deterministicFallbackLayout(inputs, bounds);
    onApplyTransforms(state.particles);
    publishLayout();
  }

  function hardStopFallback() {
    const inputs = state.particles.map((particle) => ({
      componentId: particle.componentId,
      radiusPx: particle.radiusPx,
      kind: particle.kind
    }));
    mode = "FALLBACK";
    placeFallback(inputs);
    stopLoop();
  }

  function startLoop() {
    if (destroyed || running || hidden) return;
    if (mode !== "PHYSICS") return;
    if (state.settled) return;
    running = true;
    loopStartedAt = runtime.now();
    lastFrameTime = loopStartedAt;
    budget = { slowFrames: 0 };
    accumulatorMs = 0;

    const frame = (time: number) => {
      if (!running || destroyed) return;
      if (hidden || (runtime.documentRef && runtime.documentRef.visibilityState === "hidden")) {
        stopLoop();
        return;
      }
      const wallElapsed = runtime.now() - loopStartedAt;
      if (wallElapsed >= HARD_STOP_MS) {
        hardStopFallback();
        return;
      }
      const delta = Math.max(0, time - lastFrameTime);
      lastFrameTime = time;
      budget = trackSlowFrame(budget, delta);
      if (shouldForceFallback(budget)) {
        hardStopFallback();
        return;
      }
      const next = consumeFrameDelta(accumulatorMs, delta);
      accumulatorMs = next.accumulatorMs;
      let nextState = state;
      for (let index = 0; index < next.steps; index += 1) {
        nextState = stepLoosePhysics(nextState, bounds);
        state = nextState;
        if (state.settled) break;
      }
      onApplyTransforms(state.particles);
      if (state.settled) {
        stopLoop();
        publishLayout();
        return;
      }
      if (runtime.now() - loopStartedAt >= HARD_STOP_MS) {
        hardStopFallback();
        return;
      }
      rafHandle = runtime.requestAnimationFrame(frame);
    };

    rafHandle = runtime.requestAnimationFrame(frame);
  }

  function originInStage(intent: BeadLaunchIntent, stageRect?: StageRect | null) {
    if (stageRect) {
      return {
        x: intent.originClientX - stageRect.left,
        y: intent.originClientY - stageRect.top
      };
    }
    return { x: intent.originClientX, y: intent.originClientY };
  }

  function removeParticle(componentId: string) {
    state = {
      ...state,
      particles: state.particles.filter((particle) => particle.componentId !== componentId)
    };
  }

  function consume(requestId: string) {
    if (consumedRequestIds.has(requestId)) return;
    consumedRequestIds.add(requestId);
    pendingLaunches.delete(requestId);
    onLaunchConsumed(requestId);
  }

  function sync(design: PublicDesignV1, launchQueue: readonly BeadLaunchIntent[], stageRect?: StageRect | null) {
    if (destroyed) return;
    lastDesign = design;
    bodyCount =
      design.beads.length +
      design.accessories.filter((accessory) => accessory.placementMode === "INLINE").length;
    mode = chooseLooseMotionMode({
      bodyCount,
      prefersReducedMotion,
      requestAnimationFrameAvailable: typeof runtime.requestAnimationFrame === "function"
    });

    for (const intent of launchQueue) {
      if (consumedRequestIds.has(intent.requestId)) continue;
      pendingLaunches.set(intent.requestId, intent);
    }

    const injectedIds = new Set<string>();
    for (const [requestId, intent] of [...pendingLaunches.entries()]) {
      if (!componentExists(design, intent.componentId)) {
        // Failed optimistic add / rollback: drop particle and consume once.
        removeParticle(intent.componentId);
        consume(requestId);
        continue;
      }
      const body = bodyFor(design, intent.componentId, bounds.innerRadiusPx);
      if (!body) {
        consume(requestId);
        continue;
      }
      if (!state.particles.some((particle) => particle.componentId === intent.componentId)) {
        const origin = originInStage(intent, stageRect);
        // Seed without this body, then inject from the measured origin.
        const others = deriveLooseBodies(design, bounds.innerRadiusPx).physical.filter(
          (input) => input.componentId !== intent.componentId
        );
        if (state.particles.length === 0) {
          state = seedLooseParticles(others, bounds);
        }
        state = injectLooseParticle(state, body, origin, bounds);
        injectedIds.add(intent.componentId);
      }
      consume(requestId);
    }

    const inputs = deriveLooseBodies(design, bounds.innerRadiusPx).physical;
    if (mode === "REDUCED" || mode === "FALLBACK") {
      placeFallback(inputs);
      return;
    }

    if (injectedIds.size > 0) {
      // Keep injected coordinates; only reconcile non-injected additions.
      const kept = inputs.filter((input) => !injectedIds.has(input.componentId));
      const rest = reconcileKeepPositions(
        { ...state, particles: state.particles.filter((p) => !injectedIds.has(p.componentId)) },
        kept,
        bounds
      );
      state = {
        ...rest,
        particles: [
          ...rest.particles,
          ...state.particles.filter((p) => injectedIds.has(p.componentId))
        ],
        overflowComponentIds: rest.overflowComponentIds,
        settled: false
      };
      onApplyTransforms(state.particles);
      publishLayout();
      startLoop();
      return;
    }

    if (state.particles.length === 0) {
      state = seedLooseParticles(inputs, bounds);
      onApplyTransforms(state.particles);
      publishLayout();
      startLoop();
      return;
    }

    const beforeIds = state.particles.map((particle) => particle.componentId).join("|");
    state = reconcileKeepPositions(state, inputs, bounds);
    const afterIds = state.particles.map((particle) => particle.componentId).join("|");
    onApplyTransforms(state.particles);
    publishLayout();
    if (beforeIds !== afterIds || !state.settled) startLoop();
  }

  recomputeBounds();

  return {
    sync,
    setStageSize(widthPx, heightPx) {
      stageWidth = Math.max(1, widthPx);
      stageHeight = Math.max(1, heightPx);
      const previousInner = bounds.innerRadiusPx;
      recomputeBounds();
      if (Math.abs(previousInner - bounds.innerRadiusPx) > 0.01 && lastDesign) {
        const radiusById = new Map(
          deriveLooseBodies(lastDesign, bounds.innerRadiusPx).physical.map((body) => [body.componentId, body])
        );
        state = {
          ...state,
          particles: state.particles.map((particle) => {
            const body = radiusById.get(particle.componentId);
            return body ? { ...particle, kind: body.kind, radiusPx: body.radiusPx } : particle;
          }),
          settled: false
        };
      }
      publishLayout();
    },
    setInnerRadiusRatio(ratio) {
      innerRadiusRatio = ratio;
      recomputeBounds();
      publishLayout();
    },
    setVisibility(nextHidden) {
      hidden = nextHidden;
      if (hidden) {
        stopLoop();
        return;
      }
      if (mode === "PHYSICS" && !state.settled && !destroyed) startLoop();
    },
    setPrefersReducedMotion(prefers) {
      prefersReducedMotion = prefers;
      mode = chooseLooseMotionMode({
        bodyCount,
        prefersReducedMotion,
        requestAnimationFrameAvailable: typeof runtime.requestAnimationFrame === "function"
      });
      if (mode !== "PHYSICS") {
        stopLoop();
        placeFallback(
          state.particles.map((particle) => ({
            componentId: particle.componentId,
            radiusPx: particle.radiusPx,
            kind: particle.kind
          }))
        );
      }
      publishLayout();
    },
    getSnapshot: snapshot,
    getBounds() {
      return bounds;
    },
    destroy() {
      destroyed = true;
      stopLoop();
    },
    isRunning() {
      return running;
    }
  };
}

export function collectTransformMap(particles: readonly LooseParticle[]): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  for (const particle of particles) {
    map.set(particle.componentId, { x: particle.x, y: particle.y });
  }
  return map;
}

export function interpolateTransform(
  from: { x: number; y: number },
  to: { x: number; y: number },
  progress: number
): { x: number; y: number } {
  const t = Math.min(1, Math.max(0, progress));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t
  };
}

export const MODE_TRANSITION_MS = 300;
