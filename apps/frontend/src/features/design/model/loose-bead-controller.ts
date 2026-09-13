/**
 * Feature-local loose-bead stage coordinator.
 * Owns presentation-only particle state, launch injection order, bounded RAF,
 * wall-clock hard stop, pre-entry flight and responsive bounds.
 * Never mutates DesignV1.
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
  requestAnimationFrame?: (callback: (time: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
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

export type FlightProgress = {
  requestId: string;
  componentId: string;
  /** Client viewport coordinates for a fixed flight overlay. */
  clientX: number;
  clientY: number;
  progress: number;
  radiusPx: number;
};

export type LooseStageControllerOptions = {
  runtime: LooseStageRuntime;
  innerRadiusRatio?: number;
  prefersReducedMotion?: boolean;
  onLaunchConsumed: (requestId: string) => void;
  onApplyTransforms: (particles: readonly LooseParticle[]) => void;
  onLayoutChanged?: (snapshot: LooseStageSnapshot) => void;
  onFlightUpdate?: (flights: readonly FlightProgress[]) => void;
};

const MIN_HIT_TARGET_PX = 44;
const FALLBACK_STAGE_SIZE = 320;
const FLIGHT_MS = 280;
const FLIGHT_EPSILON = 0.35;

export const MODE_TRANSITION_MS = 300;

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

function hasRafCapability(runtime: LooseStageRuntime): boolean {
  return typeof runtime.requestAnimationFrame === "function" && typeof runtime.cancelAnimationFrame === "function";
}

function trayEntryFor(origin: { x: number; y: number }, bounds: LooseBounds, radiusPx: number) {
  const dx = origin.x - bounds.centerX;
  const dy = origin.y - bounds.centerY;
  const distance = Math.hypot(dx, dy) || 1;
  const nx = dx / distance;
  const ny = dy / distance;
  const entryDistance = Math.max(0, bounds.innerRadiusPx - radiusPx - FLIGHT_EPSILON);
  const entryX = bounds.centerX + nx * entryDistance;
  const entryY = bounds.centerY + ny * entryDistance;
  const handoffSpeed = 0.22;
  return {
    entryX,
    entryY,
    velocityX: (bounds.centerX - entryX) * handoffSpeed,
    velocityY: (bounds.centerY - entryY) * handoffSpeed
  };
}

function reconcileKeepPositions(
  previous: LoosePhysicsState,
  inputs: readonly LooseBodyInput[],
  bounds: LooseBounds
): LoosePhysicsState {
  const existing = new Map(previous.particles.map((particle) => [particle.componentId, particle]));
  const nextInputs = inputs;
  const particles: LooseParticle[] = [];
  const seen = new Set<string>();

  for (const input of nextInputs) {
    if (seen.has(input.componentId)) continue;
    const prior = existing.get(input.componentId);
    if (prior) {
      particles.push({ ...prior, kind: input.kind, radiusPx: input.radiusPx });
      seen.add(input.componentId);
      continue;
    }
    if (particles.length >= MAX_PHYSICS_BODIES || input.radiusPx > bounds.innerRadiusPx) {
      continue;
    }
    const injected = injectLooseParticle(
      {
        elapsedMs: previous.elapsedMs,
        overflowComponentIds: [],
        particles,
        settled: false
      },
      input,
      { x: bounds.centerX, y: bounds.centerY - bounds.innerRadiusPx * 0.85 },
      bounds
    );
    const added = injected.particles.find((particle) => particle.componentId === input.componentId);
    if (added && !seen.has(added.componentId)) {
      particles.push(added);
      seen.add(added.componentId);
    }
  }

  // Stale overflow is recomputed: only inputs that failed to become visible particles.
  const overflowComponentIds = nextInputs
    .filter((input) => !seen.has(input.componentId))
    .map((input) => input.componentId);

  return {
    elapsedMs: previous.elapsedMs,
    overflowComponentIds,
    particles,
    settled: false
  };
}

type ActiveFlight = {
  requestId: string;
  componentId: string;
  fromClientX: number;
  fromClientY: number;
  fromStageX: number;
  fromStageY: number;
  entryX: number;
  entryY: number;
  velocityX: number;
  velocityY: number;
  radiusPx: number;
  kind: LooseBodyInput["kind"];
  startedAt: number;
  stageLeft: number;
  stageTop: number;
};

export type LooseStageController = {
  sync(design: PublicDesignV1, launchQueue: readonly BeadLaunchIntent[], stageRect?: StageRect | null): void;
  setStageSize(widthPx: number, heightPx: number): void;
  setInnerRadiusRatio(ratio: number): void;
  setVisibility(hidden: boolean): void;
  setPrefersReducedMotion(prefers: boolean): void;
  getSnapshot(): LooseStageSnapshot;
  getBounds(): LooseBounds;
  getFlights(): readonly FlightProgress[];
  destroy(): void;
  isRunning(): boolean;
};

export function createLooseStageController(options: LooseStageControllerOptions): LooseStageController {
  const runtime = options.runtime;
  const onLaunchConsumed = options.onLaunchConsumed;
  const onApplyTransforms = options.onApplyTransforms;
  const onLayoutChanged = options.onLayoutChanged ?? (() => undefined);
  const onFlightUpdate = options.onFlightUpdate ?? (() => undefined);
  const rafAvailable = hasRafCapability(runtime);

  let innerRadiusRatio = options.innerRadiusRatio ?? getTrayVisual("BONE_CHINA").innerRadiusRatio;
  let stageWidth = FALLBACK_STAGE_SIZE;
  let stageHeight = FALLBACK_STAGE_SIZE;
  let bounds: LooseBounds = defaultBounds(FALLBACK_STAGE_SIZE * innerRadiusRatio);
  let prefersReducedMotion = options.prefersReducedMotion ?? false;
  let mode: LooseMotionMode = chooseLooseMotionMode({
    bodyCount: 0,
    prefersReducedMotion,
    requestAnimationFrameAvailable: rafAvailable
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
  const flights = new Map<string, ActiveFlight>();
  let rafHandle: number | null = null;
  let running = false;
  let accumulatorMs = 0;
  let lastFrameTime = 0;
  let loopStartedAt = 0;
  let budget: FrameBudgetTracker = { slowFrames: 0 };
  let destroyed = false;
  let hidden = false;
  let lastDesign: PublicDesignV1 | null = null;
  let lastStageRect: StageRect | null = null;

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
      settled: state.settled && flights.size === 0
    };
  }

  function publishLayout() {
    onLayoutChanged(snapshot());
  }

  function flightProgressList(): FlightProgress[] {
    const now = runtime.now();
    return [...flights.values()].map((flight) => {
      const progress = Math.min(1, Math.max(0, (now - flight.startedAt) / FLIGHT_MS));
      const x = flight.fromStageX + (flight.entryX - flight.fromStageX) * progress;
      const y = flight.fromStageY + (flight.entryY - flight.fromStageY) * progress;
      return {
        requestId: flight.requestId,
        componentId: flight.componentId,
        clientX: flight.stageLeft + x,
        clientY: flight.stageTop + y,
        progress,
        radiusPx: flight.radiusPx
      };
    });
  }

  function publishFlights() {
    onFlightUpdate(flightProgressList());
  }

  function stopLoop() {
    running = false;
    if (rafHandle !== null && typeof runtime.cancelAnimationFrame === "function") {
      runtime.cancelAnimationFrame(rafHandle);
    }
    rafHandle = null;
  }

  function placeFallback(inputs: readonly LooseBodyInput[]) {
    flights.clear();
    publishFlights();
    state = deterministicFallbackLayout(inputs, bounds);
    onApplyTransforms(state.particles);
    publishLayout();
  }

  function hardStopFallback() {
    const inputs = [
      ...state.particles.map((particle) => ({
        componentId: particle.componentId,
        radiusPx: particle.radiusPx,
        kind: particle.kind
      })),
      ...[...flights.values()].map((flight) => ({
        componentId: flight.componentId,
        radiusPx: flight.radiusPx,
        kind: flight.kind
      }))
    ];
    mode = "FALLBACK";
    placeFallback(inputs);
    stopLoop();
  }

  function handoffFlight(flight: ActiveFlight) {
    flights.delete(flight.requestId);
    const body: LooseBodyInput = {
      componentId: flight.componentId,
      radiusPx: flight.radiusPx,
      kind: flight.kind
    };
    // Place exactly at tray entry with continuous inbound velocity — never project an outside particle.
    state = {
      ...state,
      particles: [
        ...state.particles.filter((particle) => particle.componentId !== flight.componentId),
        {
          ...body,
          x: flight.entryX,
          y: flight.entryY,
          velocityX: flight.velocityX,
          velocityY: flight.velocityY,
          sleepingFrames: 0
        }
      ],
      settled: false
    };
    onApplyTransforms(state.particles);
  }

  function advanceFlights() {
    if (flights.size === 0) return;
    const now = runtime.now();
    for (const flight of [...flights.values()]) {
      const progress = (now - flight.startedAt) / FLIGHT_MS;
      if (progress >= 1) handoffFlight(flight);
    }
    publishFlights();
  }

  function startLoop() {
    if (destroyed || running || hidden) return;
    if (mode !== "PHYSICS") return;
    if (typeof runtime.requestAnimationFrame !== "function") return;
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

      advanceFlights();

      if (flights.size === 0) {
        const next = consumeFrameDelta(accumulatorMs, delta);
        accumulatorMs = next.accumulatorMs;
        let nextState = state;
        for (let index = 0; index < next.steps; index += 1) {
          nextState = stepLoosePhysics(nextState, bounds);
          state = nextState;
          if (state.settled) break;
        }
        onApplyTransforms(state.particles);
        if (state.settled && flights.size === 0) {
          stopLoop();
          publishLayout();
          return;
        }
      }

      if (runtime.now() - loopStartedAt >= HARD_STOP_MS) {
        hardStopFallback();
        return;
      }
      rafHandle = runtime.requestAnimationFrame!(frame);
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
    for (const [requestId, flight] of [...flights.entries()]) {
      if (flight.componentId === componentId) flights.delete(requestId);
    }
    publishFlights();
  }

  function consume(requestId: string) {
    if (consumedRequestIds.has(requestId)) return;
    consumedRequestIds.add(requestId);
    pendingLaunches.delete(requestId);
    onLaunchConsumed(requestId);
  }

  function beginFlightOrInject(body: LooseBodyInput, origin: { x: number; y: number }, requestId: string, stageRect?: StageRect | null) {
    const distanceFromCenter = Math.hypot(origin.x - bounds.centerX, origin.y - bounds.centerY);
    const outside = distanceFromCenter + body.radiusPx > bounds.innerRadiusPx - FLIGHT_EPSILON;
    const useFlight = rafAvailable && !prefersReducedMotion && mode === "PHYSICS" && outside;

    if (!useFlight) {
      // Reduced motion / no RAF / already inside: place at entry without ballistic flight.
      const { entryX, entryY, velocityX, velocityY } = trayEntryFor(origin, bounds, body.radiusPx);
      const startX = outside ? entryX : origin.x;
      const startY = outside ? entryY : origin.y;
      state = injectLooseParticle(
        { ...state, particles: state.particles.filter((p) => p.componentId !== body.componentId) },
        body,
        { x: startX, y: startY },
        bounds
      );
      // Restore intended velocity toward center for continuity.
      state = {
        ...state,
        particles: state.particles.map((particle) =>
          particle.componentId === body.componentId
            ? { ...particle, x: startX, y: startY, velocityX, velocityY, sleepingFrames: 0 }
            : particle
        )
      };
      return;
    }

    const { entryX, entryY, velocityX, velocityY } = trayEntryFor(origin, bounds, body.radiusPx);
    flights.set(requestId, {
      requestId,
      componentId: body.componentId,
      fromClientX: (stageRect?.left ?? 0) + origin.x,
      fromClientY: (stageRect?.top ?? 0) + origin.y,
      fromStageX: origin.x,
      fromStageY: origin.y,
      entryX,
      entryY,
      velocityX,
      velocityY,
      radiusPx: body.radiusPx,
      kind: body.kind,
      startedAt: runtime.now(),
      stageLeft: stageRect?.left ?? 0,
      stageTop: stageRect?.top ?? 0
    });
  }

  function sync(design: PublicDesignV1, launchQueue: readonly BeadLaunchIntent[], stageRect?: StageRect | null) {
    if (destroyed) return;
    lastDesign = design;
    lastStageRect = stageRect ?? lastStageRect;
    bodyCount =
      design.beads.length +
      design.accessories.filter((accessory) => accessory.placementMode === "INLINE").length;
    mode = chooseLooseMotionMode({
      bodyCount,
      prefersReducedMotion,
      requestAnimationFrameAvailable: rafAvailable
    });

    for (const intent of launchQueue) {
      if (consumedRequestIds.has(intent.requestId)) continue;
      pendingLaunches.set(intent.requestId, intent);
    }

    const injectedIds = new Set<string>();
    for (const [requestId, intent] of [...pendingLaunches.entries()]) {
      if (!componentExists(design, intent.componentId)) {
        removeParticle(intent.componentId);
        consume(requestId);
        continue;
      }
      const body = bodyFor(design, intent.componentId, bounds.innerRadiusPx);
      if (!body) {
        consume(requestId);
        continue;
      }
      const alreadyVisible = state.particles.some((particle) => particle.componentId === intent.componentId);
      const alreadyFlying = [...flights.values()].some((flight) => flight.componentId === intent.componentId);
      if (!alreadyVisible && !alreadyFlying) {
        if (state.particles.length === 0) {
          const others = deriveLooseBodies(design, bounds.innerRadiusPx).physical.filter(
            (input) => input.componentId !== intent.componentId
          );
          state = seedLooseParticles(others, bounds);
        }
        const origin = originInStage(intent, stageRect ?? lastStageRect);
        beginFlightOrInject(body, origin, requestId, stageRect ?? lastStageRect);
        injectedIds.add(intent.componentId);
      }
      consume(requestId);
    }

    // Drop flights whose components disappeared (rollback).
    for (const [requestId, flight] of [...flights.entries()]) {
      if (!componentExists(design, flight.componentId)) {
        flights.delete(requestId);
      }
    }
    publishFlights();

    const inputs = deriveLooseBodies(design, bounds.innerRadiusPx).physical;
    if (mode === "REDUCED" || mode === "FALLBACK") {
      placeFallback(inputs);
      return;
    }

    if (injectedIds.size > 0 || flights.size > 0) {
      const flyingIds = new Set([...flights.values()].map((flight) => flight.componentId));
      const kept = inputs.filter((input) => !injectedIds.has(input.componentId) && !flyingIds.has(input.componentId));
      const rest = reconcileKeepPositions(
        { ...state, particles: state.particles.filter((p) => !injectedIds.has(p.componentId) && !flyingIds.has(p.componentId)) },
        kept,
        bounds
      );
      const injectedParticles = state.particles.filter(
        (p) => injectedIds.has(p.componentId) && !flyingIds.has(p.componentId)
      );
      const overflow = [
        ...rest.overflowComponentIds,
        ...inputs
          .filter((input) => flyingIds.has(input.componentId))
          .map((input) => input.componentId)
          .filter(() => false),
        ...inputs
          .filter((input) => !rest.particles.some((p) => p.componentId === input.componentId) && !flyingIds.has(input.componentId) && !injectedParticles.some((p) => p.componentId === input.componentId))
          .map((input) => input.componentId)
      ];
      state = {
        ...rest,
        particles: [...rest.particles, ...injectedParticles],
        overflowComponentIds: [...new Set(overflow)],
        settled: false
      };
      // Unique ids only
      const unique = new Map(state.particles.map((p) => [p.componentId, p]));
      state = { ...state, particles: [...unique.values()] };
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
      if (mode === "PHYSICS" && (!state.settled || flights.size > 0) && !destroyed) startLoop();
    },
    setPrefersReducedMotion(prefers) {
      prefersReducedMotion = prefers;
      mode = chooseLooseMotionMode({
        bodyCount,
        prefersReducedMotion,
        requestAnimationFrameAvailable: rafAvailable
      });
      if (mode !== "PHYSICS") {
        stopLoop();
        // Collapse in-flight launches into deterministic placement.
        const flightBodies = [...flights.values()].map((flight) => ({
          componentId: flight.componentId,
          radiusPx: flight.radiusPx,
          kind: flight.kind
        }));
        flights.clear();
        publishFlights();
        const inputs = lastDesign
          ? deriveLooseBodies(lastDesign, bounds.innerRadiusPx).physical
          : [
              ...state.particles.map((particle) => ({
                componentId: particle.componentId,
                radiusPx: particle.radiusPx,
                kind: particle.kind
              })),
              ...flightBodies
            ];
        placeFallback(inputs);
      }
      publishLayout();
    },
    getSnapshot: snapshot,
    getBounds() {
      return bounds;
    },
    getFlights: flightProgressList,
    destroy() {
      destroyed = true;
      flights.clear();
      publishFlights();
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

export type ModeGhost = {
  componentId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  sizePercent: number;
};

export type ModeTransitionSnapshot = {
  visualConnected: boolean;
  ghosts: ModeGhost[];
};

/**
 * Owns mode-transition ghosts and the clear timer independently of React effect
 * cleanup, so a visualConnected state update cannot cancel the only timeout.
 */
export function createModeTransitionController(options: {
  durationMs?: number;
  isReducedMotion: () => boolean;
  onChange: (snapshot: ModeTransitionSnapshot) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let visualConnected = false;
  let ghosts: ModeGhost[] = [];

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function publish() {
    options.onChange({ visualConnected, ghosts: [...ghosts] });
  }

  return {
    setInitial(connected: boolean) {
      visualConnected = connected;
      ghosts = [];
      publish();
    },
    requestTransition(nextConnected: boolean, computeGhosts: (targetConnected: boolean) => ModeGhost[]) {
      const gen = ++generation;
      clearTimer();
      if (options.isReducedMotion()) {
        visualConnected = nextConnected;
        ghosts = [];
        publish();
        return;
      }
      ghosts = computeGhosts(nextConnected);
      visualConnected = nextConnected;
      publish();
      const duration = options.durationMs ?? MODE_TRANSITION_MS;
      timer = setTimeout(() => {
        if (gen !== generation) return;
        timer = null;
        ghosts = [];
        publish();
      }, duration);
    },
    destroy() {
      generation += 1;
      clearTimer();
      ghosts = [];
    },
    getSnapshot(): ModeTransitionSnapshot {
      return { visualConnected, ghosts: [...ghosts] };
    }
  };
}

export function computeModeGhosts(input: {
  targetConnected: boolean;
  componentIds: readonly string[];
  fromPositions: ReadonlyMap<string, { x: number; y: number; size: number }>;
  connectedById: ReadonlyMap<string, { x: number; y: number; size: number }>;
  looseById: ReadonlyMap<string, { x: number; y: number; size: number }>;
}): ModeGhost[] {
  return input.componentIds.map((componentId) => {
    const from = input.fromPositions.get(componentId) ?? { x: 50, y: 50, size: 8 };
    const to = input.targetConnected
      ? input.connectedById.get(componentId) ?? { x: 50, y: 50, size: 8 }
      : input.looseById.get(componentId) ?? { x: 50, y: 50, size: 8 };
    return {
      componentId,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      sizePercent: from.size || to.size || 8
    };
  });
}
