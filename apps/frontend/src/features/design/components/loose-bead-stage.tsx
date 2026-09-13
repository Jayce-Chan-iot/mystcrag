"use client";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import Image from "next/image";
import * as React from "react";
import { createPortal } from "react-dom";

import type { DisplayTrayMaterial } from "../model/display-tray";
import {
  collectTransformMap,
  createLooseStageController,
  deriveLooseBodies,
  hitTargetSizePx,
  mmToRadiusPx,
  type BeadLaunchIntent,
  type FlightProgress,
  type LooseStageController,
  type LooseStageSnapshot
} from "../model/loose-bead-controller";
import { observeElementSize } from "../model/loose-bead-motion";
import { deterministicFallbackLayout, type LooseParticle } from "../model/loose-bead-physics";
import { getTrayVisual } from "../model/visual-assets";
import { CrystalBeadImage } from "./crystal-bead-image";
import { DisplayTray } from "./display-tray";

export type { BeadLaunchIntent };

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

function particleTransform(particle: { x: number; y: number }): string {
  return `translate3d(${particle.x}px, ${particle.y}px, 0) translate(-50%, -50%)`;
}

function anchorLabel(index: number): string {
  return `挂饰 ${index + 1}`;
}

function createBrowserRuntime(): Parameters<typeof createLooseStageController>[0]["runtime"] {
  const hasRaf =
    typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";
  return {
    // Omit RAF entirely when unavailable so the controller never trusts a no-op wrapper.
    requestAnimationFrame: hasRaf ? (callback) => requestAnimationFrame(callback) : undefined,
    cancelAnimationFrame: hasRaf ? (handle) => cancelAnimationFrame(handle) : undefined,
    now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    matchMedia: (query) =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(query)
        : { matches: false },
    documentRef: typeof document === "undefined" ? undefined : document
  };
}

function prefersReducedMotionNow(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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
  const controllerRef = React.useRef<LooseStageController | null>(null);
  const onLaunchConsumedRef = React.useRef(onLaunchConsumed);
  React.useEffect(() => {
    onLaunchConsumedRef.current = onLaunchConsumed;
  }, [onLaunchConsumed]);

  const [snapshot, setSnapshot] = React.useState<LooseStageSnapshot>(() => ({
    particles: [],
    overflowComponentIds: [],
    overflowActive: false,
    mode: "PHYSICS",
    stageSizePx: DEFAULT_STAGE_SIZE,
    innerRadiusPx: DEFAULT_STAGE_SIZE * 0.37,
    settled: true
  }));
  const [reducedMotion, setReducedMotion] = React.useState(false);

  const derived = React.useMemo(
    () => deriveLooseBodies(design, snapshot.innerRadiusPx || DEFAULT_STAGE_SIZE * 0.37),
    [design, snapshot.innerRadiusPx]
  );

  const applyTransforms = React.useCallback((particles: readonly LooseParticle[]) => {
    for (const particle of particles) {
      const node = particleNodesRef.current.get(particle.componentId);
      if (node) node.style.transform = particleTransform(particle);
    }
  }, []);

  const flightOverlayRef = React.useRef<HTMLDivElement | null>(null);
  const flightNodesRef = React.useRef(new Map<string, HTMLElement>());
  const flightIdsRef = React.useRef<string[]>([]);
  const latestFlightsRef = React.useRef(new Map<string, FlightProgress>());
  const [flightVisuals, setFlightVisuals] = React.useState<Record<string, FlightProgress>>({});

  const onFlightUpdate = React.useCallback((flights: readonly FlightProgress[]) => {
    const nextIds = flights.map((flight) => flight.componentId).sort();
    const prevIds = flightIdsRef.current;
    const changed =
      nextIds.length !== prevIds.length || nextIds.some((id, index) => id !== prevIds[index]);
    latestFlightsRef.current = new Map(flights.map((flight) => [flight.componentId, flight]));
    if (changed) {
      flightIdsRef.current = nextIds;
      const visuals: Record<string, FlightProgress> = {};
      for (const flight of flights) visuals[flight.componentId] = flight;
      // React state only when the flight membership set changes — never per RAF frame.
      setFlightVisuals(visuals);
    }
    for (const flight of flights) {
      const node = flightNodesRef.current.get(flight.componentId);
      if (!node) continue;
      const size = Math.max(12, flight.radiusPx * 2);
      node.style.width = `${size}px`;
      node.style.height = `${size}px`;
      node.style.transform = `translate3d(${flight.clientX}px, ${flight.clientY}px, 0) translate(-50%, -50%)`;
      node.style.left = "0px";
      node.style.top = "0px";
      node.style.opacity = String(0.55 + 0.45 * Math.min(1, flight.progress + 0.2));
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => {
      const prefers = Boolean(media?.matches);
      setReducedMotion(prefers);
      controllerRef.current?.setPrefersReducedMotion(prefers);
    };
    update();
    media?.addEventListener?.("change", update);
    return () => media?.removeEventListener?.("change", update);
  }, []);

  React.useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof window === "undefined") return;
    if (!controllerRef.current) {
      // Seed reduced-motion at construction so the first mount is already REDUCED.
      const prefers = prefersReducedMotionNow();
      controllerRef.current = createLooseStageController({
        runtime: createBrowserRuntime(),
        innerRadiusRatio: getTrayVisual(trayMaterial).innerRadiusRatio,
        prefersReducedMotion: prefers,
        onLaunchConsumed: (requestId) => onLaunchConsumedRef.current(requestId),
        onApplyTransforms: applyTransforms,
        onLayoutChanged: (next) => setSnapshot(next),
        onFlightUpdate
      });
      queueMicrotask(() => setReducedMotion(prefers));
    }
    const controller = controllerRef.current;
    controller.setPrefersReducedMotion(prefersReducedMotionNow());
    controller.setInnerRadiusRatio(getTrayVisual(trayMaterial).innerRadiusRatio);
    const measure = () => {
      const rect = node.getBoundingClientRect();
      controller.setStageSize(rect.width || DEFAULT_STAGE_SIZE, rect.height || DEFAULT_STAGE_SIZE);
      controller.sync(design, launchQueue, rect);
    };
    measure();
    const ResizeObserverCtor = typeof ResizeObserver === "function" ? ResizeObserver : undefined;
    return observeElementSize(node, measure, {
      ResizeObserverCtor,
      windowTarget: window
    });
  }, [applyTransforms, design, launchQueue, onFlightUpdate, trayMaterial]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      controllerRef.current?.setVisibility(document.visibilityState === "hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, []);

  // SSR / first paint: deterministic fallback only for bodies that fit.
  const ssrParticles = React.useMemo(() => {
    if (snapshot.particles.length > 0) return null;
    return deterministicFallbackLayout(
      deriveLooseBodies(design, DEFAULT_STAGE_SIZE * 0.37).physical,
      {
        centerX: DEFAULT_STAGE_SIZE / 2,
        centerY: DEFAULT_STAGE_SIZE / 2,
        innerRadiusPx: DEFAULT_STAGE_SIZE * 0.37
      }
    );
  }, [design, snapshot.particles.length]);

  const visibleParticles =
    snapshot.particles.length > 0
      ? snapshot.particles
      : (ssrParticles?.particles ?? []).slice(0, 48);
  const overflowActive = snapshot.overflowActive || (ssrParticles?.overflowComponentIds.length ?? 0) > 0;
  const fallbackActive = snapshot.mode !== "PHYSICS";
  const particleClass =
    fallbackActive || reducedMotion
      ? "transition-transform duration-150 motion-reduce:transition-none"
      : "transition-none";

  return (
    <div
      aria-label="散珠托盘"
      className="relative mx-auto aspect-square w-full max-w-[35rem] select-none overflow-hidden"
      data-loose-bead-stage="true"
      data-loose-motion-mode={snapshot.mode}
      data-loose-stage-size={snapshot.stageSizePx}
      ref={stageRef}
      style={
        typeof window !== "undefined"
          ? ({ ["--loose-inner-radius" as string]: `${snapshot.innerRadiusPx}px` } as React.CSSProperties)
          : undefined
      }
    >
      <DisplayTray material={trayMaterial} />

      <div className="absolute inset-0 z-10" data-loose-particle-layer="true">
        {visibleParticles.map((particle, index) => {
          const selected = particle.componentId === selectedComponentId;
          const bead = design.beads.find((item) => item.componentId === particle.componentId);
          const imageSizePx = Math.max(12, particle.radiusPx * 2);
          const hitSizePx = hitTargetSizePx(imageSizePx);
          return (
            <button
              aria-label={
                bead
                  ? `散珠：${bead.materialKey} ${bead.diameterMm}mm`
                  : `直通配饰 ${particle.componentId}`
              }
              aria-pressed={selected}
              className={`absolute left-0 top-0 z-10 grid touch-none place-items-center rounded-full ${particleClass} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                selected ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]" : ""
              }`}
              data-component-id={particle.componentId}
              data-loose-bead={particle.componentId}
              data-loose-image-size={imageSizePx}
              data-loose-hit-size={hitSizePx}
              disabled={busy}
              key={particle.componentId}
              onClick={() => onSelect(particle.componentId)}
              ref={(node) => {
                if (node) {
                  particleNodesRef.current.set(particle.componentId, node);
                  const live =
                    controllerRef.current
                      ?.getSnapshot()
                      .particles.find((item) => item.componentId === particle.componentId) ?? particle;
                  node.style.transform = particleTransform(live);
                } else {
                  particleNodesRef.current.delete(particle.componentId);
                }
              }}
              style={{
                height: `${hitSizePx}px`,
                transform: particleTransform(particle),
                width: `${hitSizePx}px`
              }}
              type="button"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none block"
                style={{ height: `${imageSizePx}px`, width: `${imageSizePx}px` }}
              >
                {bead ? (
                  <CrystalBeadImage
                    alt=""
                    materialKey={bead.materialKey}
                    priority={index < 4}
                    sizes={`${Math.ceil(imageSizePx)}px`}
                    textureAssetKey={bead.textureAssetKey}
                  />
                ) : (
                  <Image
                    alt=""
                    className="h-full w-full object-contain drop-shadow-[0_8px_8px_rgb(57_45_67/0.2)]"
                    height={256}
                    loading="eager"
                    sizes={`${Math.ceil(imageSizePx)}px`}
                    src="/accessories/silver-star-ring-charm.png"
                    width={256}
                  />
                )}
              </span>
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

      {typeof document !== "undefined"
        ? createPortal(
            <div
              aria-hidden="true"
              className="pointer-events-none fixed inset-0 z-[80]"
              data-loose-flight-overlay="true"
              ref={flightOverlayRef}
            >
              {Object.entries(flightVisuals).map(([componentId, flight]) => {
                const size = Math.max(12, flight.radiusPx * 2);
                return (
                  <div
                    className="pointer-events-none absolute left-0 top-0"
                    data-loose-flight={componentId}
                    key={componentId}
                    ref={(node) => {
                      if (node) {
                        flightNodesRef.current.set(componentId, node);
                        const live = latestFlightsRef.current.get(componentId);
                        const size = Math.max(12, (live?.radiusPx ?? flight.radiusPx) * 2);
                        node.style.width = `${size}px`;
                        node.style.height = `${size}px`;
                        if (live) {
                          node.style.transform = `translate3d(${live.clientX}px, ${live.clientY}px, 0) translate(-50%, -50%)`;
                        }
                      } else {
                        flightNodesRef.current.delete(componentId);
                      }
                    }}
                    style={{ height: `${size}px`, width: `${size}px` }}
                  >
                    {flight.kind === "BEAD" ? (
                      <CrystalBeadImage
                        alt=""
                        materialKey={flight.materialKey ?? "clear-quartz-v1"}
                        priority={false}
                        sizes={`${Math.ceil(size)}px`}
                        textureAssetKey={flight.textureAssetKey ?? null}
                      />
                    ) : (
                      <Image
                        alt=""
                        className="h-full w-full object-contain drop-shadow-[0_8px_8px_rgb(57_45_67/0.2)]"
                        height={256}
                        loading="eager"
                        sizes={`${Math.ceil(size)}px`}
                        src="/accessories/silver-star-ring-charm.png"
                        width={256}
                      />
                    )}
                  </div>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export { collectTransformMap, deriveLooseBodies, mmToRadiusPx };
