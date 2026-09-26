import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { PublicDesignV1 } from "@mystcrag/design-contract";

import { mockDesignOptions } from "../fixtures/mock-design-options";
import {
  computeModeGhosts,
  createLooseStageController,
  createModeTransitionController,
  mmToRadiusPx,
  type LooseStageRuntime
} from "./loose-bead-controller";
import { FIXED_STEP_MS, HARD_STOP_MS, MAX_PHYSICS_BODIES, deterministicFallbackLayout } from "./loose-bead-physics";
import { calculateSizeAwareRingLayout } from "../components/flat-bracelet-editor";

function designFixture(): PublicDesignV1 {
  return structuredClone(mockDesignOptions[0]!);
}

function createFakeRuntime(startNow = 0, options?: { withRaf?: boolean; reduced?: boolean }) {
  let now = startNow;
  let nextId = 1;
  const callbacks = new Map<number, (time: number) => void>();
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
          callbacks.delete(id);
        }
      : undefined,
    now: () => now,
    matchMedia: (query) => ({
      matches: Boolean(options?.reduced) && query.includes("prefers-reduced-motion"),
      addEventListener() {},
      removeEventListener() {}
    })
  };
  return {
    runtime,
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
  const flightUpdates: Array<Array<{ componentId: string; progress: number; clientX: number; clientY: number; materialKey?: string }>> = [];
  const layoutUpdates: Array<{ particles: number; overflow: number }> = [];
  const controller = createLooseStageController({
    runtime: fake.runtime,
    innerRadiusRatio: 0.37,
    prefersReducedMotion: options?.prefersReducedMotion ?? false,
    onLaunchConsumed: (id) => consumed.push(id),
    onApplyTransforms: () => undefined,
    onLayoutChanged: (snap) => layoutUpdates.push({ particles: snap.particles.length, overflow: snap.overflowComponentIds.length }),
    onFlightUpdate: (flights) => flightUpdates.push(flights.map((f) => ({ ...f })))
  });
  controller.setStageSize(400, 400);
  return { controller, consumed, fake, flightUpdates, layoutUpdates };
}

function stage() {
  return { left: 0, top: 0, width: 400, height: 400 };
}

test("flight handoff keeps overlay through the handoff frame and exposes bead on the next frame", () => {
  const design = designFixture();
  const harness = createHarness();
  const base = design.beads.slice(0, 2);
  const added = { ...design.beads[2]!, componentId: "handoff-bead", positionIndex: 2 };
  harness.controller.sync({ ...design, beads: [...base, added] }, [
    { requestId: "h1", componentId: "handoff-bead", originClientX: 12, originClientY: 12 }
  ], stage());

  // Still flying before duration elapses.
  harness.fake.setTime(FIXED_STEP_MS * 5);
  assert.ok(harness.controller.getFlights().some((f) => f.componentId === "handoff-bead"));

  // Drive until progress would complete.
  let sawHandoffFrameWithBoth = false;
  let sawBeadAfterHandoff = false;
  const start = harness.fake.now();
  for (let index = 1; index <= 30; index += 1) {
    const time = start + index * FIXED_STEP_MS;
    harness.fake.flush(time);
    const flights = harness.controller.getFlights();
    const bead = harness.controller.getSnapshot().particles.some((p) => p.componentId === "handoff-bead");
    if (bead && flights.some((f) => f.componentId === "handoff-bead")) {
      sawHandoffFrameWithBoth = true;
    }
    if (sawHandoffFrameWithBoth && bead && !flights.some((f) => f.componentId === "handoff-bead")) {
      sawBeadAfterHandoff = true;
      break;
    }
  }
  assert.ok(sawHandoffFrameWithBoth, "handoff frame must keep flight overlay while particle exists");
  assert.ok(sawBeadAfterHandoff, "next frame must have bead and clear overlay");
});

test("soft overflow is idempotent across repeated sync for 8mm and 10mm bodies", () => {
  const design = designFixture();
  for (const diameterMm of [8, 10]) {
    const harness = createHarness();
    const beads = Array.from({ length: 48 }, (_, index) => ({
      ...design.beads[0]!,
      componentId: `b-${diameterMm}-${index}`,
      diameterMm,
      positionIndex: index
    }));
    const payload = { ...design, beads };
    harness.controller.sync(payload, [], stage());
    const first = harness.controller.getSnapshot();
    const firstVisible = first.particles.map((p) => p.componentId).sort();
    const firstOverflow = [...first.overflowComponentIds].sort();
    assert.ok(firstOverflow.length > 0 || first.particles.length === MAX_PHYSICS_BODIES, `diameter ${diameterMm} should soft-overflow or fill`);

    harness.controller.sync(payload, [], stage());
    const second = harness.controller.getSnapshot();
    assert.deepEqual(second.particles.map((p) => p.componentId).sort(), firstVisible, `visible set must be stable for ${diameterMm}`);
    assert.deepEqual([...second.overflowComponentIds].sort(), firstOverflow, `overflow set must be stable for ${diameterMm}`);
    assert.equal(new Set(second.particles.map((p) => p.componentId)).size, second.particles.length);

    harness.controller.sync(payload, [], stage());
    const third = harness.controller.getSnapshot();
    assert.deepEqual(third.particles.map((p) => p.componentId).sort(), firstVisible);
    assert.deepEqual([...third.overflowComponentIds].sort(), firstOverflow);
  }
});

test("removing an overflow bead clears it from overflow on the next sync", () => {
  const design = designFixture();
  const harness = createHarness();
  const beads = Array.from({ length: 48 }, (_, index) => ({
    ...design.beads[0]!,
    componentId: `x${index}`,
    diameterMm: 10,
    positionIndex: index
  }));
  harness.controller.sync({ ...design, beads }, [], stage());
  const withOverflow = harness.controller.getSnapshot();
  assert.ok(withOverflow.overflowComponentIds.length > 0);
  const dropId = withOverflow.overflowComponentIds[0]!;
  const remaining = beads.filter((bead) => bead.componentId !== dropId);
  harness.controller.sync({ ...design, beads: remaining }, [], stage());
  const after = harness.controller.getSnapshot();
  assert.ok(!after.overflowComponentIds.includes(dropId));
  assert.ok(!after.particles.some((p) => p.componentId === dropId));
});

test("in-tray particles keep moving while another bead is still flying", () => {
  const design = designFixture();
  const harness = createHarness();
  const first = { ...design.beads[0]!, componentId: "mover", diameterMm: 10, positionIndex: 0 };
  const second = { ...design.beads[1]!, componentId: "flyer", diameterMm: 8, positionIndex: 1 };
  // Put the first bead into motion via its own launch, then keep stepping a little.
  harness.controller.sync({ ...design, beads: [first] }, [
    { requestId: "f1", componentId: "mover", originClientX: 8, originClientY: 8 }
  ], stage());
  const start0 = harness.fake.now();
  for (let index = 1; index <= 20; index += 1) {
    harness.fake.flush(start0 + index * FIXED_STEP_MS);
    if (!harness.controller.getFlights().some((f) => f.componentId === "mover")) break;
  }
  const mover0 = harness.controller.getSnapshot().particles.find((p) => p.componentId === "mover");
  assert.ok(mover0, "mover should be in the tray");

  // Second flight starts while the first body is still settling.
  harness.controller.sync({ ...design, beads: [first, second] }, [
    { requestId: "f2", componentId: "flyer", originClientX: 5, originClientY: 200 }
  ], stage());
  assert.ok(harness.controller.getFlights().some((f) => f.componentId === "flyer"));
  const start = harness.fake.now();
  let previous = harness.controller.getSnapshot().particles.find((p) => p.componentId === "mover")!;
  let movedBetweenFrames = false;
  for (let index = 1; index <= 14; index += 1) {
    harness.fake.flush(start + index * FIXED_STEP_MS);
    const stillFlying = harness.controller.getFlights().some((f) => f.componentId === "flyer");
    const mover = harness.controller.getSnapshot().particles.find((p) => p.componentId === "mover")!;
    if (stillFlying && Math.hypot(mover.x - previous.x, mover.y - previous.y) > 1e-4) {
      movedBetweenFrames = true;
      break;
    }
    previous = mover;
    if (!stillFlying) break;
  }
  assert.ok(movedBetweenFrames, "existing particle position must change across RAFs while a flight is active");
});

test("reduced to physics launch resets simulation budget instead of instant hard-stop", () => {
  const design = designFixture();
  const harness = createHarness({ prefersReducedMotion: true });
  const base = design.beads.slice(0, 2);
  const added = { ...design.beads[2]!, componentId: "cycle", positionIndex: 2 };
  harness.controller.sync({ ...design, beads: [...base] }, [], stage());
  assert.equal(harness.controller.getSnapshot().mode, "REDUCED");

  harness.controller.setPrefersReducedMotion(false);
  harness.controller.sync({ ...design, beads: [...base, added] }, [
    { requestId: "cycle", componentId: "cycle", originClientX: 8, originClientY: 8 }
  ], stage());
  assert.equal(harness.controller.getSnapshot().mode, "PHYSICS");

  const start = harness.fake.now();
  let stayedPhysics = true;
  let moved = false;
  for (let index = 1; index <= 18; index += 1) {
    harness.fake.flush(start + index * FIXED_STEP_MS);
    const snap = harness.controller.getSnapshot();
    if (snap.mode !== "PHYSICS") stayedPhysics = false;
    const cycle = snap.particles.find((p) => p.componentId === "cycle");
    if (cycle && Math.hypot(cycle.velocityX, cycle.velocityY) > 0.001) moved = true;
  }
  assert.ok(stayedPhysics, "must not immediately fall back after budget reset");
  assert.ok(moved || harness.controller.getFlights().length > 0 || harness.controller.getSnapshot().particles.some((p) => p.componentId === "cycle"));
  assert.equal(harness.controller.getSnapshot().mode, "PHYSICS");
});

test("flight progress carries bead visual metadata for the portal overlay", () => {
  const design = designFixture();
  const harness = createHarness();
  const base = design.beads.slice(0, 1);
  const added = { ...design.beads[1]!, componentId: "visual-fly", positionIndex: 1 };
  harness.controller.sync({ ...design, beads: [...base, added] }, [
    { requestId: "vf", componentId: "visual-fly", originClientX: 10, originClientY: 180 }
  ], stage());
  const flight = harness.controller.getFlights().find((f) => f.componentId === "visual-fly");
  assert.ok(flight);
  assert.equal(flight!.materialKey, added.materialKey);
  assert.ok(flight!.kind === "BEAD");
  assert.ok(flight!.radiusPx > 0);
});

test("computeModeGhosts targets equal connected canonical layout percents", () => {
  const design = designFixture();
  const components = design.beads.slice(0, 5).map((bead) => ({ ...bead, kind: "BEAD" as const }));
  const connectedLayouts = calculateSizeAwareRingLayout(components, true);
  const connectedById = new Map(
    connectedLayouts.map((item) => [
      item.component.componentId,
      { x: item.leftPercent, y: item.topPercent, size: item.widthPercent }
    ])
  );
  const fromPositions = new Map(components.map((c) => [c.componentId, { x: 10, y: 80, size: 8 }]));
  const looseById = new Map(components.map((c) => [c.componentId, { x: 50, y: 50, size: 8 }]));
  const ghosts = computeModeGhosts({
    targetConnected: true,
    componentIds: components.map((c) => c.componentId),
    fromPositions,
    connectedById,
    looseById
  });
  for (const ghost of ghosts) {
    const target = connectedById.get(ghost.componentId)!;
    assert.equal(ghost.toX, target.x);
    assert.equal(ghost.toY, target.y);
  }
});

test("mode transition clears exactly at 300ms with injectable timer", async () => {
  const events: Array<{ at: number; ghosts: number }> = [];
  let now = 0;
  const realSetTimeout = globalThis.setTimeout;
  const controller = createModeTransitionController({
    durationMs: 300,
    isReducedMotion: () => false,
    onChange: (snap) => events.push({ at: now, ghosts: snap.ghosts.length })
  });
  controller.setInitial(false);
  now = 1;
  controller.requestTransition(true, () => [
    { componentId: "a", fromX: 0, fromY: 0, toX: 50, toY: 26, sizePercent: 8 }
  ]);
  assert.equal(events.at(-1)!.ghosts, 1);
  await new Promise((resolve) => realSetTimeout(resolve, 290));
  assert.equal(controller.getSnapshot().ghosts.length, 1, "still present before 300ms");
  await new Promise((resolve) => realSetTimeout(resolve, 40));
  assert.equal(controller.getSnapshot().ghosts.length, 0, "cleared at/after 300ms");
  controller.destroy();
});

test("flight visual adapter keeps real radius and bead identity through handoff frames", () => {
  const design = designFixture();
  const harness = createHarness();
  const bead = { ...design.beads[0]!, componentId: "img-bead", positionIndex: 0 };
  harness.controller.sync({ ...design, beads: [bead] }, [
    { requestId: "img", componentId: "img-bead", originClientX: 9, originClientY: 190 }
  ], stage());
  const mid = harness.controller.getFlights().find((f) => f.componentId === "img-bead")!;
  assert.equal(mid.kind, "BEAD");
  assert.equal(mid.materialKey, bead.materialKey);
  const expectedRadius = mmToRadiusPx(bead.diameterMm, harness.controller.getBounds().innerRadiusPx);
  assert.ok(Math.abs(mid.radiusPx - expectedRadius) < 0.5, `flight radius ${mid.radiusPx} vs derived ${expectedRadius}`);
  const start = harness.fake.now();
  for (let index = 1; index <= 24; index += 1) {
    harness.fake.flush(start + index * FIXED_STEP_MS);
    const flight = harness.controller.getFlights().find((f) => f.componentId === "img-bead");
    const particle = harness.controller.getSnapshot().particles.find((p) => p.componentId === "img-bead");
    if (flight && particle) {
      // Handoff frame: same real radius for overlay and particle.
      assert.equal(flight.radiusPx, particle.radiusPx);
      assert.equal(flight.materialKey, bead.materialKey);
    }
  }
  assert.ok(harness.controller.getSnapshot().particles.some((p) => p.componentId === "img-bead"));
});

test("hard-stop fallback merges overflow from full inputs", () => {
  const design = designFixture();
  const harness = createHarness();
  // Stay under the 48-body PHYSICS cap while still producing soft overflow with 10mm beads.
  const beads = Array.from({ length: 40 }, (_, index) => ({
    ...design.beads[0]!,
    componentId: `z${index}`,
    diameterMm: 10,
    positionIndex: index
  }));
  harness.controller.sync({ ...design, beads }, [], stage());
  assert.equal(harness.controller.getSnapshot().mode, "PHYSICS", "must start in PHYSICS before hard stop");
  // Keep the loop alive with an outside launch so wall-clock hard stop can fire.
  const extra = { ...design.beads[0]!, componentId: "late", diameterMm: 10, positionIndex: 40 };
  harness.controller.sync({ ...design, beads: [...beads, extra] }, [
    { requestId: "late", componentId: "late", originClientX: 6, originClientY: 6 }
  ], stage());
  assert.equal(harness.controller.getSnapshot().mode, "PHYSICS");
  const start = harness.fake.now();
  for (let index = 1; index <= 40; index += 1) {
    if (harness.fake.pendingCount() === 0) break;
    harness.fake.flush(start + index * FIXED_STEP_MS);
  }
  if (harness.fake.pendingCount() > 0) {
    harness.fake.flush(start + HARD_STOP_MS);
  }
  const snap = harness.controller.getSnapshot();
  assert.equal(snap.settled, true);
  assert.equal(snap.mode, "FALLBACK");
  assert.ok(snap.overflowComponentIds.length > 0 || snap.particles.length <= MAX_PHYSICS_BODIES);
  assert.equal(new Set(snap.particles.map((p) => p.componentId)).size, snap.particles.length);
});

test("sync after handoff before overlay removal keeps the bead", () => {
  const design = designFixture();
  const harness = createHarness();
  const bead = { ...design.beads[0]!, componentId: "race-bead", positionIndex: 0 };
  const payload = { ...design, beads: [bead] };
  harness.controller.sync(payload, [
    { requestId: "race", componentId: "race-bead", originClientX: 8, originClientY: 8 }
  ], stage());

  // Drive to handoff: particle exists while overlay may still be present.
  const start = harness.fake.now();
  let sawHandoffBoth = false;
  for (let index = 1; index <= 30; index += 1) {
    harness.fake.flush(start + index * FIXED_STEP_MS);
    const beadIn = harness.controller.getSnapshot().particles.some((p) => p.componentId === "race-bead");
    const flying = harness.controller.getFlights().some((f) => f.componentId === "race-bead");
    if (beadIn && flying) {
      sawHandoffBoth = true;
      // Critical race: sync while handedOff overlay is still retained.
      harness.controller.sync(payload, [], stage());
      assert.ok(
        harness.controller.getSnapshot().particles.some((p) => p.componentId === "race-bead"),
        "sync after handoff must keep the in-tray bead"
      );
      break;
    }
  }
  assert.ok(sawHandoffBoth, "expected a handoff frame with both overlay and particle");

  // Next RAF removes overlay; bead must remain.
  harness.fake.flush(harness.fake.now() + FIXED_STEP_MS);
  assert.ok(harness.controller.getSnapshot().particles.some((p) => p.componentId === "race-bead"));
  // Multi-frame stability.
  for (let index = 0; index < 8; index += 1) {
    harness.fake.flush(harness.fake.now() + FIXED_STEP_MS);
    harness.controller.sync(payload, [], stage());
    const ids = harness.controller.getSnapshot().particles.map((p) => p.componentId);
    assert.deepEqual(ids, [...new Set(ids)]);
    assert.ok(ids.includes("race-bead"));
  }
});

test("flying bead that capacity planning overflows never becomes an extra tray particle", () => {
  const design = designFixture();
  const harness = createHarness();
  const base = Array.from({ length: 47 }, (_, index) => ({
    ...design.beads[0]!,
    componentId: `base-${index}`,
    diameterMm: 10,
    positionIndex: index
  }));
  const extra = { ...design.beads[0]!, componentId: "zzzz", diameterMm: 10, positionIndex: 47 };
  const payload = { ...design, beads: [...base, extra] };

  const planFor = (size: number) => {
    const inner = size * 0.37;
    return deterministicFallbackLayout(
      payload.beads.map((bead) => ({
        componentId: bead.componentId,
        kind: "BEAD" as const,
        radiusPx: mmToRadiusPx(bead.diameterMm, inner)
      })),
      { centerX: size / 2, centerY: size / 2, innerRadiusPx: inner }
    );
  };

  const assertExact = (label: string, plan: ReturnType<typeof deterministicFallbackLayout>) => {
    const snap = harness.controller.getSnapshot();
    const visible = new Set(snap.particles.map((p) => p.componentId));
    const overflow = new Set(snap.overflowComponentIds);
    const activeFlightIds = new Set(
      harness.controller
        .getFlights()
        .filter((f) => f.progress < 1)
        .map((f) => f.componentId)
    );
    const planVisible = new Set(plan.particles.map((p) => p.componentId));
    const planOverflow = new Set(plan.overflowComponentIds);

    assert.equal(visible.size, snap.particles.length, `${label}: visible ids unique`);
    assert.equal(overflow.size, snap.overflowComponentIds.length, `${label}: overflow ids unique`);
    for (const id of visible) {
      assert.ok(!overflow.has(id), `${label}: ${id} cannot be both visible and overflow`);
    }

    // Exact set equality with the deterministic plan (minus still-flying ids).
    const expectedVisible = new Set([...planVisible].filter((id) => !activeFlightIds.has(id)));
    assert.deepEqual([...visible].sort(), [...expectedVisible].sort(), `${label}: visible must equal planVisible - activeFlights`);
    assert.deepEqual([...overflow].sort(), [...planOverflow].sort(), `${label}: overflow must equal planOverflow exactly`);

    const union = new Set([...visible, ...overflow, ...activeFlightIds]);
    assert.deepEqual([...union].sort(), payload.beads.map((b) => b.componentId).sort(), `${label}: visible+overflow+activeFlights covers all input ids`);
    if (planOverflow.has("zzzz")) {
      assert.ok(overflow.has("zzzz") || activeFlightIds.has("zzzz") === false && !visible.has("zzzz"));
      if (!activeFlightIds.has("zzzz")) {
        assert.ok(overflow.has("zzzz"), `${label}: zzzz must be in overflow when not flying`);
        assert.ok(!visible.has("zzzz"), `${label}: zzzz must not be visible when plan overflows`);
      }
    }
  };

  const plan400 = planFor(400);
  harness.controller.sync(payload, [
    { requestId: "zzzz-fly", componentId: "zzzz", originClientX: 4, originClientY: 200 }
  ], stage());
  assertExact("after launch sync", plan400);

  const start = harness.fake.now();
  for (let index = 1; index <= 30; index += 1) {
    harness.fake.flush(start + index * FIXED_STEP_MS);
  }
  assertExact("after flight frames", plan400);
  harness.controller.sync(payload, [], stage());
  assertExact("after resync", plan400);

  // Real size change: 400 -> 200
  harness.controller.setStageSize(200, 200);
  harness.controller.sync(payload, [], { left: 0, top: 0, width: 200, height: 200 });
  assertExact("after resize to 200", planFor(200));
  harness.controller.setStageSize(400, 400);
  harness.controller.sync(payload, [], stage());
  assertExact("after resize back to 400", plan400);

  harness.fake.flush(harness.fake.now() + HARD_STOP_MS);
  assertExact("after hard stop", planFor(400));
});

test("active flight reprojects radius entry and continuity on stage resize", () => {
  const design = designFixture();
  const harness = createHarness();
  const bead = { ...design.beads[0]!, componentId: "resize-fly", diameterMm: 10, positionIndex: 0 };
  const payload = { ...design, beads: [bead] };
  harness.controller.setStageSize(400, 400);
  harness.controller.sync(payload, [
    { requestId: "rf", componentId: "resize-fly", originClientX: 10, originClientY: 200 }
  ], stage());

  // Mid-flight
  harness.fake.setTime(FIXED_STEP_MS * 4);
  const before = harness.controller.getFlights().find((f) => f.componentId === "resize-fly")!;
  assert.ok(before.progress > 0 && before.progress < 1);

  // Shrink stage 400 -> 200; change left/top as well. Clock does not advance.
  harness.controller.setStageSize(200, 200);
  harness.controller.sync(payload, [], { left: 40, top: 80, width: 200, height: 200 });
  const after = harness.controller.getFlights().find((f) => f.componentId === "resize-fly")!;
  const newInner = 200 * 0.37;
  const expectedRadius = mmToRadiusPx(10, newInner);
  assert.ok(Math.abs(after.radiusPx - expectedRadius) < 0.01, `radius ${after.radiusPx} vs ${expectedRadius}`);
  // Strict continuity with frozen clock: no double progress application.
  assert.ok(Math.abs(after.clientX - before.clientX) <= 0.001, `clientX jump ${after.clientX - before.clientX}`);
  assert.ok(Math.abs(after.clientY - before.clientY) <= 0.001, `clientY jump ${after.clientY - before.clientY}`);
  const bounds = harness.controller.getBounds();
  assert.ok(Math.abs(bounds.innerRadiusPx - newInner) < 0.01);

  // Idempotent re-sync at same size/rect/clock.
  for (let i = 0; i < 3; i += 1) {
    const prior = harness.controller.getFlights().find((f) => f.componentId === "resize-fly")!;
    harness.controller.sync(payload, [], { left: 40, top: 80, width: 200, height: 200 });
    const next = harness.controller.getFlights().find((f) => f.componentId === "resize-fly")!;
    assert.ok(Math.abs(next.clientX - prior.clientX) <= 0.001, `idempotent clientX drift on sync ${i}`);
    assert.ok(Math.abs(next.clientY - prior.clientY) <= 0.001, `idempotent clientY drift on sync ${i}`);
  }
  assert.equal(harness.consumed.length, 1, "request must be consumed only once");

  // Grow back 200 -> 400 mid-flight
  harness.fake.setTime(harness.fake.now() + FIXED_STEP_MS * 2);
  harness.controller.setStageSize(400, 400);
  harness.controller.sync(payload, [], stage());
  const grown = harness.controller.getFlights().find((f) => f.componentId === "resize-fly");
  const grownInner = 400 * 0.37;
  if (grown) {
    assert.ok(Math.abs(grown.radiusPx - mmToRadiusPx(10, grownInner)) < 0.01);
  }

  // Complete handoff and verify particle uses authoritative radius inside new bounds.
  const start = harness.fake.now();
  for (let index = 1; index <= 30; index += 1) {
    harness.fake.flush(start + index * FIXED_STEP_MS);
    if (!harness.controller.getFlights().some((f) => f.componentId === "resize-fly" && f.progress < 1)) break;
  }
  const particle = harness.controller.getSnapshot().particles.find((p) => p.componentId === "resize-fly");
  assert.ok(particle, "particle must exist after handoff");
  const finalBounds = harness.controller.getBounds();
  assert.ok(Math.abs(particle!.radiusPx - mmToRadiusPx(10, finalBounds.innerRadiusPx)) < 0.01);
  const dist = Math.hypot(particle!.x - finalBounds.centerX, particle!.y - finalBounds.centerY);
  assert.ok(dist + particle!.radiusPx <= finalBounds.innerRadiusPx + 1, `particle must stay inside tray: ${dist}+${particle!.radiusPx} <= ${finalBounds.innerRadiusPx}`);
});

test("flight remaining duration completes after original remainder without NaN", () => {
  const design = designFixture();
  const harness = createHarness();
  const bead = { ...design.beads[0]!, componentId: "remain", diameterMm: 8, positionIndex: 0 };
  const payload = { ...design, beads: [bead] };
  harness.controller.setStageSize(400, 400);
  harness.controller.sync(payload, [
    { requestId: "rm", componentId: "remain", originClientX: 8, originClientY: 200 }
  ], stage());

  // 100ms into a 280ms flight.
  harness.fake.setTime(100);
  harness.controller.setStageSize(400, 400);
  harness.controller.sync(payload, [], stage());
  const flight = harness.controller.getFlights().find((f) => f.componentId === "remain")!;
  assert.ok(Number.isFinite(flight.clientX) && Number.isFinite(flight.progress));
  assert.ok(flight.progress >= 0 && flight.progress < 1);

  // Advance original remainder - 1ms: still flying.
  const remaining = 180;
  harness.fake.setTime(100 + remaining - 1);
  harness.controller.getFlights();
  // Force a frame so handoff can evaluate.
  if (harness.fake.pendingCount() > 0) harness.fake.flush(100 + remaining - 1);
  assert.ok(
    harness.controller.getFlights().some((f) => f.componentId === "remain" && f.progress < 1) ||
      !harness.controller.getSnapshot().particles.some((p) => p.componentId === "remain"),
    "must not hand off before remaining time elapses"
  );

  // Advance to full remainder: handoff completes.
  harness.fake.setTime(100 + remaining);
  if (harness.fake.pendingCount() > 0) harness.fake.flush(100 + remaining);
  else {
    // If loop already stopped, sync to settle structure.
    harness.controller.sync(payload, [], stage());
  }
  // Drive a few frames if still flying.
  for (let i = 0; i < 5; i += 1) {
    if (harness.fake.pendingCount() === 0) break;
    harness.fake.flush(harness.fake.now() + FIXED_STEP_MS);
  }
  const particle = harness.controller.getSnapshot().particles.find((p) => p.componentId === "remain");
  assert.ok(particle, "handoff after remaining duration");
  const bounds = harness.controller.getBounds();
  assert.ok(Math.abs(particle!.radiusPx - mmToRadiusPx(8, bounds.innerRadiusPx)) < 0.01);
  assert.ok(Math.hypot(particle!.x - bounds.centerX, particle!.y - bounds.centerY) + particle!.radiusPx <= bounds.innerRadiusPx + 1);
});

test("flight dropped to overflow when capacity no longer admits after shrink", () => {
  const design = designFixture();
  const harness = createHarness();
  const beads = Array.from({ length: 48 }, (_, index) => ({
    ...design.beads[0]!,
    componentId: index === 5 ? "b5" : `b${index}`,
    diameterMm: 8,
    positionIndex: index
  }));
  const payload = { ...design, beads };
  const planFor = (size: number) => {
    const inner = size * 0.37;
    return deterministicFallbackLayout(
      beads.map((b) => ({
        componentId: b.componentId,
        kind: "BEAD" as const,
        radiusPx: mmToRadiusPx(b.diameterMm, inner)
      })),
      { centerX: size / 2, centerY: size / 2, innerRadiusPx: inner }
    );
  };
  const plan400 = planFor(400);
  const plan200 = planFor(200);
  const visible400 = new Set(plan400.particles.map((p) => p.componentId));
  const overflow200 = new Set(plan200.overflowComponentIds);
  // Pick a bead that is admitted at 400 and overflows at 200.
  const targetId =
    [...visible400].find((id) => overflow200.has(id)) ?? (visible400.has("b5") && overflow200.has("b5") ? "b5" : null);
  assert.ok(targetId, `need a bead visible at 400 and overflow at 200; got ${JSON.stringify({
    visible400: [...visible400].slice(0, 5),
    overflow200: [...overflow200].slice(0, 5)
  })}`);
  assert.ok(visible400.has(targetId!));
  assert.ok(overflow200.has(targetId!));

  harness.controller.setStageSize(400, 400);
  harness.controller.sync(payload, [
    { requestId: "df", componentId: targetId!, originClientX: 6, originClientY: 200 }
  ], stage());
  assert.ok(
    harness.controller.getFlights().some((f) => f.componentId === targetId),
    "target must have an active flight at 400"
  );

  harness.fake.setTime(FIXED_STEP_MS * 3);
  harness.controller.setStageSize(200, 200);
  harness.controller.sync(payload, [], { left: 0, top: 0, width: 200, height: 200 });

  const snap = harness.controller.getSnapshot();
  const visible = new Set(snap.particles.map((p) => p.componentId));
  const overflow = new Set(snap.overflowComponentIds);
  const activeFlights = new Set(harness.controller.getFlights().filter((f) => f.progress < 1).map((f) => f.componentId));
  const planVisible = new Set(plan200.particles.map((p) => p.componentId));

  assert.ok(!activeFlights.has(targetId!), "flight must be cleared after capacity loss");
  assert.ok(!visible.has(targetId!), "target must not be visible after capacity loss");
  assert.ok(overflow.has(targetId!), "target must be listed in overflow");
  assert.deepEqual([...overflow].sort(), [...overflow200].sort());
  const expectedVisible = [...planVisible].filter((id) => !activeFlights.has(id));
  assert.deepEqual([...visible].sort(), expectedVisible.sort());
  const union = new Set([...visible, ...overflow, ...activeFlights]);
  assert.deepEqual([...union].sort(), beads.map((b) => b.componentId).sort());
});

test("handedOff same-frame resize projects particle and aligns overlay", () => {
  const design = designFixture();
  const harness = createHarness();
  const bead = { ...design.beads[0]!, componentId: "handoff-resize", diameterMm: 10, positionIndex: 0 };
  const payload = { ...design, beads: [bead] };
  harness.controller.setStageSize(400, 400);
  harness.controller.sync(payload, [
    { requestId: "hr", componentId: "handoff-resize", originClientX: 8, originClientY: 200 }
  ], stage());

  // Advance until handoff dual-layer frame: particle exists AND overlay still present.
  const start = harness.fake.now();
  let sawDual = false;
  for (let index = 1; index <= 30; index += 1) {
    harness.fake.flush(start + index * FIXED_STEP_MS);
    const beadIn = harness.controller.getSnapshot().particles.some((p) => p.componentId === "handoff-resize");
    const flying = harness.controller.getFlights().some((f) => f.componentId === "handoff-resize");
    if (beadIn && flying) {
      sawDual = true;
      break;
    }
  }
  assert.ok(sawDual, "must reach handoff dual-layer frame");

  // Same-frame shrink with new rect origin; clock frozen.
  const now = harness.fake.now();
  harness.controller.setStageSize(200, 200);
  harness.controller.sync(payload, [], { left: 40, top: 80, width: 200, height: 200 });
  assert.equal(harness.fake.now(), now);

  const bounds = harness.controller.getBounds();
  const particle = harness.controller.getSnapshot().particles.find((p) => p.componentId === "handoff-resize")!;
  assert.ok(particle, "particle must exist immediately after resize+sync");
  const expectedRadius = mmToRadiusPx(10, bounds.innerRadiusPx);
  assert.ok(Math.abs(particle.radiusPx - expectedRadius) < 0.01);
  const dist = Math.hypot(particle.x - bounds.centerX, particle.y - bounds.centerY);
  assert.ok(dist + particle.radiusPx <= bounds.innerRadiusPx + 1e-6, `out of bounds after resize: ${dist}+${particle.radiusPx} > ${bounds.innerRadiusPx}`);

  const overlay = harness.controller.getFlights().find((f) => f.componentId === "handoff-resize");
  assert.ok(overlay, "handedOff overlay must still exist this frame");
  assert.ok(Math.abs(overlay!.clientX - (40 + particle.x)) <= 0.001, `overlay clientX ${overlay!.clientX} vs ${40 + particle.x}`);
  assert.ok(Math.abs(overlay!.clientY - (80 + particle.y)) <= 0.001, `overlay clientY ${overlay!.clientY} vs ${80 + particle.y}`);
  assert.ok(Math.abs(overlay!.radiusPx - particle.radiusPx) <= 0.001);

  // Next RAF removes overlay; particle stays in bounds.
  harness.fake.flush(harness.fake.now() + FIXED_STEP_MS);
  assert.ok(!harness.controller.getFlights().some((f) => f.componentId === "handoff-resize"));
  const after = harness.controller.getSnapshot().particles.find((p) => p.componentId === "handoff-resize")!;
  assert.ok(after);
  const dist2 = Math.hypot(after.x - bounds.centerX, after.y - bounds.centerY);
  assert.ok(dist2 + after.radiusPx <= bounds.innerRadiusPx + 1e-6);
});

test("flight overlay uses a single centering transform", () => {
  const source = readFileSync(new URL("../components/loose-bead-stage.tsx", import.meta.url), "utf8");
  // One centering in the RAF/ref transform write only.
  const centeringTransforms = source.match(/translate\(-50%,\s*-50%\)/g) ?? [];
  assert.ok(centeringTransforms.length >= 1);
  // Must not combine Tailwind translate utilities with inline -50% centering on the same flight node.
  assert.doesNotMatch(source, /data-loose-flight=\{componentId\}[\s\S]{0,400}-translate-x-1\/2/);
  assert.doesNotMatch(source, /-translate-x-1\/2 -translate-y-1\/2"\s*\n\s*data-loose-flight/);
  // Particle transform helper also centers once.
  assert.equal((source.match(/translate\(-50%,\s*-50%\)/g) ?? []).length >= 2, true);
});
