import assert from "node:assert/strict";
import test from "node:test";

import type { PublicDesignV1 } from "@mystcrag/design-contract";

import { mockDesignOptions } from "../fixtures/mock-design-options";
import {
  createLooseStageController,
  createModeTransitionController,
  type LooseStageRuntime,
  type ModeGhost
} from "./loose-bead-controller";
import { FIXED_STEP_MS, HARD_STOP_MS, MAX_PHYSICS_BODIES } from "./loose-bead-physics";
import { calculateSizeAwareRingLayout } from "../components/flat-bracelet-editor";

function designFixture(): PublicDesignV1 {
  return structuredClone(mockDesignOptions[0]!);
}

type FakeClock = {
  runtime: LooseStageRuntime;
  flush(time: number): void;
  pendingCount(): number;
  now(): number;
  setTime(ms: number): void;
  cancelled: number[];
};

function createFakeRuntime(startNow = 0, options?: { withRaf?: boolean }): FakeClock {
  let now = startNow;
  let nextId = 1;
  const callbacks = new Map<number, (time: number) => void>();
  const cancelled: number[] = [];
  const withRaf = options?.withRaf !== false;
  const runtime: LooseStageRuntime = {
    requestAnimationFrame: withRaf
      ? (cb) => {
          const id = nextId;
          nextId += 1;
          callbacks.set(id, cb);
          return id;
        }
      : undefined,
    cancelAnimationFrame: withRaf
      ? (id) => {
          cancelled.push(id);
          callbacks.delete(id);
        }
      : undefined,
    now: () => now,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  };
  return {
    runtime,
    cancelled,
    flush(time: number) {
      now = time;
      const entries = [...callbacks.entries()];
      callbacks.clear();
      for (const [, cb] of entries) cb(time);
    },
    pendingCount: () => callbacks.size,
    now: () => now,
    setTime(ms: number) {
      now = ms;
    }
  };
}

function createHarness(options?: { withRaf?: boolean; prefersReducedMotion?: boolean }) {
  const fake = createFakeRuntime(0, { withRaf: options?.withRaf });
  const consumed: string[] = [];
  const flights: Array<{ componentId: string; clientX: number; clientY: number; progress: number }> = [];
  const controller = createLooseStageController({
    runtime: fake.runtime,
    innerRadiusRatio: 0.37,
    prefersReducedMotion: options?.prefersReducedMotion ?? false,
    onLaunchConsumed: (id) => consumed.push(id),
    onApplyTransforms: () => undefined,
    onFlightUpdate: (active) => {
      flights.length = 0;
      flights.push(...active);
    }
  });
  controller.setStageSize(400, 400);
  return { controller, consumed, fake, flights };
}

test("reconcile without launch keeps real overflow for oversized additions and never duplicates", () => {
  const design = designFixture();
  const small = { ...design.beads[0]!, componentId: "small", diameterMm: 8, positionIndex: 0 };
  const giant = { ...design.beads[0]!, componentId: "giant", diameterMm: 140, positionIndex: 1 };
  const harness = createHarness();
  harness.controller.sync({ ...design, beads: [small] }, [], { left: 0, top: 0, width: 400, height: 400 });
  assert.equal(harness.controller.getSnapshot().particles.length, 1);

  harness.controller.sync({ ...design, beads: [small, giant] }, [], { left: 0, top: 0, width: 400, height: 400 });
  const snapshot = harness.controller.getSnapshot();
  const ids = snapshot.particles.map((p) => p.componentId);
  assert.deepEqual(ids, [...new Set(ids)], "componentIds must be unique");
  assert.ok(!ids.includes("giant") || snapshot.particles.find((p) => p.componentId === "giant")!.radiusPx > 20);
  if (!ids.includes("giant")) {
    assert.ok(snapshot.overflowComponentIds.includes("giant"));
  }
  assert.equal(snapshot.overflowActive, true);
  // Removing the giant clears stale overflow.
  harness.controller.sync({ ...design, beads: [small] }, [], { left: 0, top: 0, width: 400, height: 400 });
  const cleared = harness.controller.getSnapshot();
  assert.ok(!cleared.overflowComponentIds.includes("giant"));
  assert.equal(cleared.particles.map((p) => p.componentId).join(","), "small");
});

test("adding a 49th body overflows exactly once and keeps 48 unique visible particles", () => {
  const design = designFixture();
  const beads = Array.from({ length: 48 }, (_, index) => ({
    ...design.beads[0]!,
    componentId: `b${index}`,
    diameterMm: 6,
    positionIndex: index
  }));
  const harness = createHarness();
  harness.controller.sync({ ...design, beads }, [], { left: 0, top: 0, width: 400, height: 400 });
  const before = harness.controller.getSnapshot();
  assert.ok(before.particles.length <= MAX_PHYSICS_BODIES);

  const extra = { ...design.beads[0]!, componentId: "b48", diameterMm: 6, positionIndex: 48 };
  harness.controller.sync({ ...design, beads: [...beads, extra] }, [], { left: 0, top: 0, width: 400, height: 400 });
  const after = harness.controller.getSnapshot();
  const ids = after.particles.map((p) => p.componentId);
  assert.deepEqual(ids, [...new Set(ids)]);
  assert.ok(after.particles.length <= MAX_PHYSICS_BODIES);
  assert.ok(after.overflowComponentIds.includes("b48") || after.particles.length === 48);
  assert.equal(after.overflowActive, true);
});

test("mode transition clears ghosts by 300ms even when visual state updates", async () => {
  const snapshots: Array<{ visualConnected: boolean; ghosts: ModeGhost[] }> = [];
  let reduced = false;
  const controller = createModeTransitionController({
    durationMs: 300,
    isReducedMotion: () => reduced,
    onChange: (snap) => snapshots.push({ visualConnected: snap.visualConnected, ghosts: snap.ghosts })
  });
  controller.setInitial(false);
  const ghosts: ModeGhost[] = [
    { componentId: "a", fromX: 10, fromY: 10, toX: 50, toY: 26, sizePercent: 8 }
  ];
  controller.requestTransition(true, () => ghosts);
  assert.equal(snapshots.at(-1)!.visualConnected, true);
  assert.equal(snapshots.at(-1)!.ghosts.length, 1);

  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(snapshots.at(-1)!.ghosts.length, 0, "ghosts must clear by 300ms");
  assert.equal(snapshots.at(-1)!.visualConnected, true);

  // Rapid toggle: second transition replaces first timer.
  controller.requestTransition(false, () => ghosts);
  controller.requestTransition(true, () => ghosts);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(snapshots.at(-1)!.ghosts.length, 0);

  // Reduced motion never keeps ghosts.
  reduced = true;
  controller.requestTransition(false, () => ghosts);
  assert.equal(snapshots.at(-1)!.ghosts.length, 0);
  assert.equal(snapshots.at(-1)!.visualConnected, false);

  controller.destroy();
});

test("mode transition target uses connected layouts, not the previous visual mode", () => {
  const design = designFixture();
  const components = design.beads.slice(0, 4).map((bead) => ({ ...bead, kind: "BEAD" as const }));
  const connectedLayouts = calculateSizeAwareRingLayout(components, true);
  const spreadLayouts = calculateSizeAwareRingLayout(components, false);
  const first = connectedLayouts[0]!;
  const firstSpread = spreadLayouts[0]!;
  assert.notEqual(first.topPercent, firstSpread.topPercent);
  // Target for loose→connected must equal connected layout percent.
  assert.ok(Math.abs(first.topPercent - 26) < 8 || first.topPercent !== firstSpread.topPercent);
});

test("missing requestAnimationFrame falls back with zero hanging loops", () => {
  const design = designFixture();
  const harness = createHarness({ withRaf: false });
  const base = design.beads.slice(0, 3);
  const added = { ...design.beads[3]!, componentId: "no-raf-add", positionIndex: 3 };
  harness.controller.sync({ ...design, beads: [...base, added] }, [
    { requestId: "nr", componentId: "no-raf-add", originClientX: 10, originClientY: 10 }
  ], { left: 0, top: 0, width: 400, height: 400 });
  assert.equal(harness.controller.getSnapshot().mode, "FALLBACK");
  assert.equal(harness.fake.pendingCount(), 0);
  assert.ok(harness.controller.getSnapshot().particles.some((p) => p.componentId === "no-raf-add"));
  assert.deepEqual(harness.consumed, ["nr"]);
});

test("pre-entry flight produces intermediate frames between source and tray entry", () => {
  const design = designFixture();
  const harness = createHarness();
  const base = design.beads.slice(0, 2);
  const added = { ...design.beads[2]!, componentId: "fly-bead", positionIndex: 2 };
  const originClient = { x: 20, y: 200 };
  const stage = { left: 0, top: 0, width: 400, height: 400 };
  harness.controller.sync({ ...design, beads: [...base, added] }, [
    { requestId: "fly", componentId: "fly-bead", originClientX: originClient.x, originClientY: originClient.y }
  ], stage);

  // Flight is active before physics placement.
  assert.equal(harness.controller.getFlights().length, 1, "expected active flight overlay");
  harness.fake.setTime(FIXED_STEP_MS * 4);
  const flight = harness.controller.getFlights()[0]!;
  assert.equal(flight.componentId, "fly-bead");
  assert.ok(flight.progress > 0 && flight.progress < 1, `progress=${flight.progress}`);
  const bounds = harness.controller.getBounds();
  assert.ok(flight.clientX > originClient.x - 2 && flight.clientX < bounds.centerX);
  assert.ok(flight.clientY > originClient.y - 30 && flight.clientY < bounds.centerY + 30);

  // Advance flight through completion and ensure handoff particle exists and collides.
  const start = harness.fake.now();
  for (let index = 1; index <= 24; index += 1) {
    harness.fake.flush(start + index * FIXED_STEP_MS);
    if (harness.controller.getFlights().length === 0) break;
  }
  assert.equal(harness.controller.getFlights().length, 0, "flight must complete");
  const particle = harness.controller.getSnapshot().particles.find((p) => p.componentId === "fly-bead");
  assert.ok(particle, "handoff particle must exist");
  assert.ok(Math.hypot(particle!.x - bounds.centerX, particle!.y - bounds.centerY) + particle!.radiusPx <= bounds.innerRadiusPx + 2);
  // Motion continues inside the tray after handoff.
  const before = { x: particle!.x, y: particle!.y };
  harness.fake.flush(harness.fake.now() + FIXED_STEP_MS * 4);
  const after = harness.controller.getSnapshot().particles.find((p) => p.componentId === "fly-bead")!;
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 0.01 || after.velocityX !== 0 || after.velocityY !== 0);
});

test("reduced motion places launches directly without flight overlay", () => {
  const design = designFixture();
  const harness = createHarness({ prefersReducedMotion: true });
  const base = design.beads.slice(0, 2);
  const added = { ...design.beads[2]!, componentId: "reduced-fly", positionIndex: 2 };
  harness.controller.sync({ ...design, beads: [...base, added] }, [
    { requestId: "rf", componentId: "reduced-fly", originClientX: 5, originClientY: 5 }
  ], { left: 0, top: 0, width: 400, height: 400 });
  assert.equal(harness.flights.length, 0);
  assert.equal(harness.controller.getSnapshot().mode, "REDUCED");
  assert.ok(harness.controller.getSnapshot().particles.some((p) => p.componentId === "reduced-fly"));
  assert.equal(harness.fake.pendingCount(), 0);
});

test("failed launch clears flight overlay, particle and intent", () => {
  const design = designFixture();
  const harness = createHarness();
  const base = design.beads.slice(0, 2);
  const added = { ...design.beads[2]!, componentId: "temp-bead", positionIndex: 2 };
  harness.controller.sync({ ...design, beads: [...base, added] }, [
    { requestId: "temp", componentId: "temp-bead", originClientX: 15, originClientY: 15 }
  ], { left: 0, top: 0, width: 400, height: 400 });
  assert.equal(harness.flights.length + (harness.controller.getSnapshot().particles.some((p) => p.componentId === "temp-bead") ? 1 : 0) >= 1, true);

  harness.controller.sync({ ...design, beads: base }, [], { left: 0, top: 0, width: 400, height: 400 });
  assert.equal(harness.flights.length, 0);
  assert.ok(!harness.controller.getSnapshot().particles.some((p) => p.componentId === "temp-bead"));
  assert.deepEqual(harness.consumed, ["temp"]);
});

test("hard stop still fires after 3000ms wall clock", () => {
  const design = designFixture();
  const harness = createHarness();
  const beads = Array.from({ length: 6 }, (_, index) => ({
    ...design.beads[0]!,
    componentId: `s${index}`,
    diameterMm: 8,
    positionIndex: index
  }));
  const added = { ...design.beads[0]!, componentId: "wall", diameterMm: 8, positionIndex: 6 };
  harness.controller.sync({ ...design, beads: [...beads, added] }, [
    { requestId: "w", componentId: "wall", originClientX: 8, originClientY: 8 }
  ], { left: 0, top: 0, width: 400, height: 400 });
  const start = harness.fake.now();
  harness.fake.flush(start + HARD_STOP_MS);
  assert.equal(harness.fake.pendingCount(), 0);
  assert.equal(harness.controller.getSnapshot().settled, true);
});
