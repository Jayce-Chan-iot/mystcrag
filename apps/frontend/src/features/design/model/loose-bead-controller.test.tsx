import assert from "node:assert/strict";
import test from "node:test";

import type { PublicDesignV1 } from "@mystcrag/design-contract";

import { mockDesignOptions } from "../fixtures/mock-design-options";
import {
  createLooseStageController,
  hitTargetSizePx,
  type LooseStageRuntime
} from "./loose-bead-controller";
import { HARD_STOP_MS, MAX_PHYSICS_BODIES } from "./loose-bead-physics";

function designFixture(): PublicDesignV1 {
  return structuredClone(mockDesignOptions[0]!);
}

type FakeRaf = {
  runtime: LooseStageRuntime;
  flush(time: number): void;
  pendingCount(): number;
  advanceTime(ms: number): void;
};

function createFakeRuntime(startNow = 0): FakeRaf & { setTime(ms: number): void; cancelled: number[] } {
  let now = startNow;
  let nextId = 1;
  const callbacks = new Map<number, (time: number) => void>();
  const cancelled: number[] = [];
  const runtime: LooseStageRuntime = {
    requestAnimationFrame(cb) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      cancelled.push(id);
      callbacks.delete(id);
    },
    now() {
      return now;
    },
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    }
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
    pendingCount() {
      return callbacks.size;
    },
    advanceTime(ms: number) {
      now += ms;
    },
    setTime(ms: number) {
      now = ms;
    }
  };
}

function createController(overrides: Partial<Parameters<typeof createLooseStageController>[0]> = {}) {
  const fake = createFakeRuntime();
  const consumed: string[] = [];
  const transforms: Array<Record<string, { x: number; y: number }>> = [];
  const modeChanges: string[] = [];
  let sizeUpdates = 0;
  const controller = createLooseStageController({
    runtime: fake.runtime,
    innerRadiusRatio: 0.37,
    onLaunchConsumed: (requestId) => {
      consumed.push(requestId);
    },
    onApplyTransforms: (particles) => {
      const map: Record<string, { x: number; y: number }> = {};
      for (const particle of particles) map[particle.componentId] = { x: particle.x, y: particle.y };
      transforms.push(map);
    },
    onLayoutChanged: () => {
      sizeUpdates += 1;
    },
    ...overrides
  });
  return {
    controller,
    consumed,
    fake,
    transforms,
    modeChanges,
    sizeUpdateCount: () => sizeUpdates
  };
}

test("pending launch injects from origin and is not seeded by reconcile first", () => {
  const design = designFixture();
  const base = design.beads.slice(0, 3).map((bead) => ({ ...bead }));
  const added = { ...design.beads[3]!, componentId: "launch-bead", positionIndex: 3 };
  const harness = createController();
  harness.controller.setStageSize(400, 400);
  harness.controller.sync({ ...design, beads: base }, [], { left: 0, top: 0, width: 400, height: 400 });
  assert.equal(harness.controller.getSnapshot().particles.length, 3);

  const origin = { x: 20, y: 40 };
  harness.controller.sync(
    { ...design, beads: [...base, added] },
    [
      {
        requestId: "launch-1",
        componentId: "launch-bead",
        originClientX: origin.x,
        originClientY: origin.y
      }
    ],
    { left: 0, top: 0, width: 400, height: 400 }
  );

  // Outside sources begin a visible pre-entry flight from the measured origin.
  const flight = harness.controller.getFlights().find((item) => item.componentId === "launch-bead");
  assert.ok(flight, "launch flight must start from origin");
  assert.ok(Math.hypot(flight!.clientX - origin.x, flight!.clientY - origin.y) < 2);
  // Not seeded by reconcile as a random tray particle.
  assert.ok(!harness.controller.getSnapshot().particles.some((p) => p.componentId === "launch-bead"));
  assert.deepEqual(harness.consumed, ["launch-1"]);
});

test("failed launch consumes the intent and removes the provisional particle", () => {
  const design = designFixture();
  const base = design.beads.slice(0, 3).map((bead) => ({ ...bead }));
  const added = { ...design.beads[3]!, componentId: "rollback-bead", positionIndex: 3 };
  const harness = createController();
  harness.controller.setStageSize(400, 400);
  harness.controller.sync({ ...design, beads: [...base, added] }, [
    { requestId: "launch-rb", componentId: "rollback-bead", originClientX: 10, originClientY: 10 }
  ], { left: 0, top: 0, width: 400, height: 400 });
  assert.ok(
    harness.controller.getSnapshot().particles.some((p) => p.componentId === "rollback-bead") ||
      harness.controller.getFlights().some((f) => f.componentId === "rollback-bead")
  );

  harness.controller.sync({ ...design, beads: base }, [], { left: 0, top: 0, width: 400, height: 400 });
  assert.ok(!harness.controller.getSnapshot().particles.some((p) => p.componentId === "rollback-bead"));
  assert.ok(!harness.controller.getFlights().some((f) => f.componentId === "rollback-bead"));

  // A rollback intent that never had a body still consumes exactly once.
  harness.controller.sync({ ...design, beads: base }, [
    { requestId: "launch-missing", componentId: "never-existed", originClientX: 1, originClientY: 1 }
  ], { left: 0, top: 0, width: 400, height: 400 });
  assert.deepEqual(harness.consumed, ["launch-rb", "launch-missing"]);
});

test("duplicate launch intents for the same request are consumed once", () => {
  const design = designFixture();
  const base = design.beads.slice(0, 2).map((bead) => ({ ...bead }));
  const added = { ...design.beads[2]!, componentId: "dup-bead", positionIndex: 2 };
  const harness = createController();
  harness.controller.setStageSize(400, 400);
  const intent = { requestId: "launch-dup", componentId: "dup-bead", originClientX: 30, originClientY: 30 };
  harness.controller.sync({ ...design, beads: [...base, added] }, [intent], { left: 0, top: 0, width: 400, height: 400 });
  harness.controller.sync({ ...design, beads: [...base, added] }, [intent], { left: 0, top: 0, width: 400, height: 400 });
  assert.deepEqual(harness.consumed, ["launch-dup"]);
});

test("visible particles stay within 48 and hard overflow ids are reported", () => {
  const design = designFixture();
  const beads = Array.from({ length: 49 }, (_, index) => ({
    ...design.beads[0]!,
    componentId: `body-${index}`,
    positionIndex: index
  }));
  const harness = createController();
  harness.controller.setStageSize(400, 400);
  harness.controller.sync({ ...design, beads }, [], { left: 0, top: 0, width: 400, height: 400 });
  const snapshot = harness.controller.getSnapshot();
  assert.ok(snapshot.particles.length <= MAX_PHYSICS_BODIES);
  assert.ok(snapshot.overflowComponentIds.length >= 1);
  assert.ok(snapshot.overflowActive);
  assert.ok(snapshot.overflowComponentIds.includes("body-48") || snapshot.particles.length < 49);
});

test("soft overflow keeps real radius and reports overflow without shrinking", () => {
  const design = designFixture();
  const oversized = {
    ...design.beads[0]!,
    componentId: "giant",
    diameterMm: 140,
    positionIndex: 0
  };
  const harness = createController({ innerRadiusRatio: 0.2 });
  harness.controller.setStageSize(200, 200);
  harness.controller.sync({ ...design, beads: [oversized] }, [], { left: 0, top: 0, width: 200, height: 200 });
  const snapshot = harness.controller.getSnapshot();
  const giant = snapshot.particles.find((p) => p.componentId === "giant");
  if (giant) {
    // If placed, radius must remain the true derived size, never a 42% cap.
    assert.ok(giant.radiusPx > 20, `radius ${giant.radiusPx} looks clamped`);
  } else {
    assert.ok(snapshot.overflowComponentIds.includes("giant"));
  }
  assert.equal(snapshot.overflowActive, true);
});

test("responsive inner radius drives both visual and collision sizes", () => {
  const design = designFixture();
  const harness = createController();
  harness.controller.setStageSize(320, 320);
  harness.controller.sync(design, [], { left: 0, top: 0, width: 320, height: 320 });
  const small = harness.controller.getSnapshot();
  assert.equal(small.stageSizePx, 320);
  assert.ok(Math.abs(small.innerRadiusPx - 320 * 0.37) < 0.01);

  harness.controller.setStageSize(560, 560);
  const large = harness.controller.getSnapshot();
  assert.equal(large.stageSizePx, 560);
  assert.ok(Math.abs(large.innerRadiusPx - 560 * 0.37) < 0.01);
  const smallBead = small.particles[0]!;
  const largeBead = large.particles.find((p) => p.componentId === smallBead.componentId)!;
  assert.ok(largeBead.radiusPx > smallBead.radiusPx);
  const ratio6 = large.particles.find((p) => p.radiusPx === Math.min(...large.particles.map((x) => x.radiusPx)))!;
  const ratio10 = large.particles.find((p) => p.radiusPx === Math.max(...large.particles.map((x) => x.radiusPx)))!;
  assert.ok(ratio10.radiusPx / ratio6.radiusPx > 1.4);
});

test("single RAF loop applies transforms without React setters and stops on settle/unmount/hidden", () => {
  const design = designFixture();
  const harness = createController();
  harness.controller.setStageSize(400, 400);
  harness.controller.sync({ ...design, beads: design.beads.slice(0, 4) }, [], { left: 0, top: 0, width: 400, height: 400 });
  // Force motion by injecting
  harness.controller.sync({ ...design, beads: design.beads.slice(0, 4) }, [
    { requestId: "l1", componentId: design.beads[0]!.componentId, originClientX: 10, originClientY: 10 }
  ], { left: 0, top: 0, width: 400, height: 400 });
  // component already exists so inject is skipped; re-seed with velocity via launch of new bead
  const added = { ...design.beads[4]!, componentId: "fly-in", positionIndex: 4 };
  harness.controller.sync({ ...design, beads: [...design.beads.slice(0, 4), added] }, [
    { requestId: "fly", componentId: "fly-in", originClientX: 8, originClientY: 12 }
  ], { left: 0, top: 0, width: 400, height: 400 });
  assert.equal(harness.fake.pendingCount(), 1, "exactly one RAF pending");
  // Complete pre-entry flight, then physics frames write transforms.
  const flightStart = harness.fake.runtime.now();
  for (let index = 1; index <= 24; index += 1) {
    harness.fake.flush(flightStart + index * 16);
    if (harness.controller.getFlights().length === 0) break;
  }
  const transformCallsBefore = harness.transforms.length;
  harness.fake.flush(harness.fake.runtime.now() + 16);
  assert.ok(harness.transforms.length > transformCallsBefore);
  assert.equal(harness.fake.pendingCount(), 1);

  harness.controller.setVisibility(true);
  assert.equal(harness.fake.pendingCount(), 0, "hidden cancels RAF");
  harness.controller.setVisibility(false);
  assert.ok(harness.fake.pendingCount() <= 1);

  harness.controller.destroy();
  assert.equal(harness.fake.pendingCount(), 0);
});

test("wall-clock hard stop triggers at three seconds even with sparse frames", () => {
  const design = designFixture();
  const harness = createController();
  harness.controller.setStageSize(400, 400);
  const beads = Array.from({ length: 8 }, (_, index) => ({
    ...design.beads[0]!,
    componentId: `sparse-${index}`,
    positionIndex: index
  }));
  harness.controller.sync({ ...design, beads }, [], { left: 0, top: 0, width: 400, height: 400 });
  // Nudge into active motion via a launch
  const extra = { ...design.beads[0]!, componentId: "sparse-fly", positionIndex: 8 };
  harness.controller.sync({ ...design, beads: [...beads, extra] }, [
    { requestId: "sparse", componentId: "sparse-fly", originClientX: 5, originClientY: 5 }
  ], { left: 0, top: 0, width: 400, height: 400 });

  const start = harness.fake.runtime.now();
  // One frame after the full wall-clock budget must stop even if few sim steps ran.
  harness.fake.flush(start + HARD_STOP_MS);
  assert.equal(harness.fake.pendingCount(), 0, "loop stopped after wall-clock hard stop");
  assert.equal(harness.controller.getSnapshot().settled, true);
});

test("reduced motion skips the ballistic loop", () => {
  const design = designFixture();
  const fake = createFakeRuntime();
  const consumed: string[] = [];
  let rafAfterStart = 0;
  const controller = createLooseStageController({
    runtime: {
      ...fake.runtime,
      requestAnimationFrame(cb) {
        rafAfterStart += 1;
        return fake.runtime.requestAnimationFrame?.(cb) ?? 0;
      }
    },
    prefersReducedMotion: true,
    innerRadiusRatio: 0.37,
    onLaunchConsumed: (id) => consumed.push(id),
    onApplyTransforms: () => undefined
  });
  controller.setStageSize(400, 400);
  const base = design.beads.slice(0, 2);
  const added = { ...design.beads[2]!, componentId: "reduced-add", positionIndex: 2 };
  controller.sync({ ...design, beads: [...base, added] }, [
    { requestId: "r1", componentId: "reduced-add", originClientX: 12, originClientY: 12 }
  ], { left: 0, top: 0, width: 400, height: 400 });
  assert.equal(controller.getSnapshot().mode, "REDUCED");
  assert.equal(rafAfterStart, 0);
  assert.deepEqual(consumed, ["r1"]);
});

test("hit target helper keeps at least 44px without inflating particle radius", () => {
  assert.equal(hitTargetSizePx(20), 44);
  assert.equal(hitTargetSizePx(48), 48);
  assert.equal(hitTargetSizePx(12), 44);
});
