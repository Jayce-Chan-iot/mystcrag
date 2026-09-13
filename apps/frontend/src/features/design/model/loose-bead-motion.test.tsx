import assert from "node:assert/strict";
import test from "node:test";

import { FIXED_STEP_MS, MAX_PHYSICS_BODIES } from "./loose-bead-physics";
import {
  chooseLooseMotionMode,
  consumeFrameDelta,
  observeElementSize,
  type MotionCapabilityInput
} from "./loose-bead-motion";

function capability(overrides: Partial<MotionCapabilityInput> = {}): MotionCapabilityInput {
  return {
    bodyCount: 12,
    prefersReducedMotion: false,
    requestAnimationFrameAvailable: true,
    ...overrides
  };
}

test("chooseLooseMotionMode prefers reduced motion over physics", () => {
  assert.equal(
    chooseLooseMotionMode(capability({ prefersReducedMotion: true, bodyCount: 48 })),
    "REDUCED"
  );
  assert.equal(
    chooseLooseMotionMode(capability({ prefersReducedMotion: true, bodyCount: 49, requestAnimationFrameAvailable: false })),
    "REDUCED"
  );
});

test("chooseLooseMotionMode falls back for 49 bodies or missing RAF", () => {
  assert.equal(chooseLooseMotionMode(capability({ bodyCount: MAX_PHYSICS_BODIES + 1 })), "FALLBACK");
  assert.equal(chooseLooseMotionMode(capability({ requestAnimationFrameAvailable: false })), "FALLBACK");
  assert.equal(chooseLooseMotionMode(capability({ bodyCount: MAX_PHYSICS_BODIES })), "PHYSICS");
  assert.equal(chooseLooseMotionMode(capability({ bodyCount: 1 })), "PHYSICS");
});

test("consumeFrameDelta caps catch-up work at four fixed steps", () => {
  const first = consumeFrameDelta(0, 1000);
  assert.equal(first.steps, 4);
  assert.equal(first.accumulatorMs, 0);

  const second = consumeFrameDelta(FIXED_STEP_MS * 0.5, FIXED_STEP_MS * 1.25);
  assert.equal(second.steps, 1);
  assert.ok(Math.abs(second.accumulatorMs - FIXED_STEP_MS * 0.75) < 1e-9);

  const third = consumeFrameDelta(0, FIXED_STEP_MS * 2.1);
  assert.equal(third.steps, 2);
  assert.ok(third.accumulatorMs < FIXED_STEP_MS);
});

test("observeElementSize uses ResizeObserver exactly once when available", () => {
  const observed: Element[] = [];
  const disconnected: number[] = [];
  class FakeResizeObserver {
    constructor(private readonly callback: () => void) {}
    observe(element: Element) {
      observed.push(element);
      this.callback();
    }
    disconnect() {
      disconnected.push(1);
    }
  }
  const element = {} as Element;
  let resizeCalls = 0;
  const cleanup = observeElementSize(element, () => {
    resizeCalls += 1;
  }, { ResizeObserverCtor: FakeResizeObserver as unknown as typeof ResizeObserver });
  assert.equal(observed.length, 1);
  assert.equal(resizeCalls, 1);
  cleanup();
  assert.equal(disconnected.length, 1);
});

test("observeElementSize falls back to one window resize listener", () => {
  const listeners = new Map<string, Set<() => void>>();
  const windowTarget = {
    addEventListener(type: string, listener: () => void) {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    }
  };
  const element = {} as Element;
  let resizeCalls = 0;
  const cleanup = observeElementSize(element, () => {
    resizeCalls += 1;
  }, { ResizeObserverCtor: undefined as unknown as typeof ResizeObserver, windowTarget: windowTarget as unknown as Pick<Window, "addEventListener" | "removeEventListener"> });
  const resizeListeners = listeners.get("resize");
  assert.equal(resizeListeners?.size, 1);
  for (const listener of resizeListeners ?? []) listener();
  assert.equal(resizeCalls, 1);
  cleanup();
  assert.equal(listeners.get("resize")?.size ?? 0, 0);
});
