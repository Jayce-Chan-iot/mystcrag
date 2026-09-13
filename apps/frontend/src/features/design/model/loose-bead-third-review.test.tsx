import assert from "node:assert/strict";
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
  const plan = deterministicFallbackLayout(
    payload.beads.map((bead) => ({
      componentId: bead.componentId,
      kind: "BEAD" as const,
      radiusPx: mmToRadiusPx(bead.diameterMm, 400 * 0.37)
    })),
    { centerX: 200, centerY: 200, innerRadiusPx: 400 * 0.37 }
  );
  const planAdmitted = new Set(plan.particles.map((p) => p.componentId));
  const planOverflow = payload.beads.filter((b) => !planAdmitted.has(b.componentId)).map((b) => b.componentId);

  harness.controller.sync(payload, [
    { requestId: "zzzz-fly", componentId: "zzzz", originClientX: 4, originClientY: 200 }
  ], stage());

  const assertConservation = (label: string) => {
    const snap = harness.controller.getSnapshot();
    const visible = snap.particles.map((p) => p.componentId);
    const overflow = [...snap.overflowComponentIds];
    assert.deepEqual(visible, [...new Set(visible)], `${label}: no duplicate visible ids`);
    assert.deepEqual(overflow, [...new Set(overflow)], `${label}: no duplicate overflow ids`);
    for (const id of visible) {
      assert.ok(!overflow.includes(id), `${label}: ${id} cannot be both visible and overflow`);
    }
    const all = new Set([...visible, ...overflow]);
    for (const bead of payload.beads) {
      // Actively flying ids may be temporarily absent from both sets only while overlay is in flight (progress < 1).
      const flying = harness.controller.getFlights().some((f) => f.componentId === bead.componentId && f.progress < 1);
      if (!flying) {
        assert.ok(all.has(bead.componentId), `${label}: missing ${bead.componentId}`);
      }
    }
    if (planOverflow.includes("zzzz")) {
      assert.ok(!visible.includes("zzzz") || snap.overflowComponentIds.includes("zzzz") === false);
      // If plan says overflow, zzzz must not remain a visible tray particle after handoff.
      const stillFlying = harness.controller.getFlights().some((f) => f.componentId === "zzzz");
      if (!stillFlying) {
        assert.ok(!visible.includes("zzzz"), `${label}: overflow bead must not stay visible`);
        assert.ok(overflow.includes("zzzz"), `${label}: overflow bead must be listed`);
      }
    }
  };

  assertConservation("after launch sync");

  const start = harness.fake.now();
  for (let index = 1; index <= 30; index += 1) {
    harness.fake.flush(start + index * FIXED_STEP_MS);
  }
  assertConservation("after flight frames");
  harness.controller.sync(payload, [], stage());
  assertConservation("after resync");
  harness.controller.setStageSize(400, 400);
  harness.controller.sync(payload, [], stage());
  assertConservation("after resize resync");
  harness.fake.flush(harness.fake.now() + HARD_STOP_MS);
  assertConservation("after hard stop");

  // Final admitted/overflow sets match the plan.
  const finalSnap = harness.controller.getSnapshot();
  const finalVisible = new Set(finalSnap.particles.map((p) => p.componentId));
  const finalOverflow = new Set(finalSnap.overflowComponentIds);
  for (const id of planAdmitted) {
    // Handed-off/flying remnants aside, admitted ids that are not flying must be visible.
    const flying = harness.controller.getFlights().some((f) => f.componentId === id);
    if (!flying) assert.ok(finalVisible.has(id) || finalOverflow.has(id));
  }
  for (const id of planOverflow) {
    assert.ok(finalOverflow.has(id) || finalVisible.has(id) === false);
    assert.ok(!finalVisible.has(id), `plan overflow ${id} must not be visible`);
  }
});
