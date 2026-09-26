import { FIXED_STEP_MS, MAX_PHYSICS_BODIES } from "./loose-bead-physics";

export type MotionCapabilityInput = {
  bodyCount: number;
  prefersReducedMotion: boolean;
  requestAnimationFrameAvailable: boolean;
};

export type LooseMotionMode = "PHYSICS" | "REDUCED" | "FALLBACK";

const MAX_STEPS_PER_FRAME = 4;
const LOW_FPS_FRAME_MS = 33.4;
const LOW_FPS_STREAK = 12;

export function chooseLooseMotionMode(input: MotionCapabilityInput): LooseMotionMode {
  if (input.prefersReducedMotion) return "REDUCED";
  if (input.bodyCount > MAX_PHYSICS_BODIES) return "FALLBACK";
  if (!input.requestAnimationFrameAvailable) return "FALLBACK";
  return "PHYSICS";
}

export function consumeFrameDelta(
  accumulatorMs: number,
  frameDeltaMs: number
): { accumulatorMs: number; steps: number } {
  const safeDelta = Number.isFinite(frameDeltaMs) && frameDeltaMs > 0 ? frameDeltaMs : 0;
  let accumulator = Math.max(0, accumulatorMs) + safeDelta;
  let steps = 0;
  while (accumulator >= FIXED_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    accumulator -= FIXED_STEP_MS;
    steps += 1;
  }
  if (steps >= MAX_STEPS_PER_FRAME) {
    // Discard excess catch-up time so one long frame cannot stall the loop.
    accumulator = accumulator < FIXED_STEP_MS ? accumulator : 0;
  }
  return { accumulatorMs: accumulator, steps };
}

export type FrameBudgetTracker = {
  slowFrames: number;
};

export function trackSlowFrame(
  tracker: FrameBudgetTracker,
  frameDeltaMs: number,
  streak: number = LOW_FPS_STREAK
): FrameBudgetTracker {
  const slowFrames = frameDeltaMs >= LOW_FPS_FRAME_MS ? tracker.slowFrames + 1 : 0;
  return { slowFrames: Math.min(slowFrames, streak + 1) };
}

export function shouldForceFallback(tracker: FrameBudgetTracker, streak: number = LOW_FPS_STREAK): boolean {
  return tracker.slowFrames >= streak;
}

export function observeElementSize(
  element: Element,
  onResize: () => void,
  options?: {
    ResizeObserverCtor?: typeof ResizeObserver;
    windowTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
  }
): () => void {
  const ResizeObserverCtor = options?.ResizeObserverCtor;
  if (typeof ResizeObserverCtor === "function") {
    const observer = new ResizeObserverCtor(() => onResize());
    observer.observe(element);
    return () => observer.disconnect();
  }

  const windowTarget =
    options?.windowTarget ??
    (typeof window === "undefined"
      ? undefined
      : (window as unknown as Pick<Window, "addEventListener" | "removeEventListener">));

  if (!windowTarget) {
    onResize();
    return () => undefined;
  }

  windowTarget.addEventListener("resize", onResize);
  return () => windowTarget.removeEventListener("resize", onResize);
}
