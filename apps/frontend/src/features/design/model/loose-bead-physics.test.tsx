import assert from "node:assert/strict";
import test from "node:test";

import {
  HARD_STOP_MS,
  MAX_PHYSICS_BODIES,
  deterministicFallbackLayout,
  injectLooseParticle,
  seedLooseParticles,
  stepLoosePhysics,
  type LooseBodyInput,
  type LooseBounds,
  type LoosePhysicsState
} from "./loose-bead-physics";

const BOUNDS: LooseBounds = { centerX: 200, centerY: 200, innerRadiusPx: 160 };

function bead(componentId: string, radiusPx: number, kind: LooseBodyInput["kind"] = "BEAD"): LooseBodyInput {
  return { componentId, radiusPx, kind };
}

function assertInsideBounds(state: LoosePhysicsState, bounds: LooseBounds = BOUNDS) {
  for (const particle of state.particles) {
    const distance = Math.hypot(particle.x - bounds.centerX, particle.y - bounds.centerY);
    assert.ok(
      distance + particle.radiusPx <= bounds.innerRadiusPx + 1e-6,
      `${particle.componentId} leaks past boundary: ${distance + particle.radiusPx} > ${bounds.innerRadiusPx}`
    );
    assert.ok(Number.isFinite(particle.x));
    assert.ok(Number.isFinite(particle.y));
    assert.ok(Number.isFinite(particle.velocityX));
    assert.ok(Number.isFinite(particle.velocityY));
  }
}

function assertNoOverlap(state: LoosePhysicsState, tolerance = 0.55) {
  for (let left = 0; left < state.particles.length; left += 1) {
    for (let right = left + 1; right < state.particles.length; right += 1) {
      const a = state.particles[left]!;
      const b = state.particles[right]!;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(
        distance + tolerance >= a.radiusPx + b.radiusPx,
        `${a.componentId} overlaps ${b.componentId}: ${distance} < ${a.radiusPx + b.radiusPx}`
      );
    }
  }
}

test("seedLooseParticles is deterministic for identical ordered inputs", () => {
  const inputs = [bead("a", 10), bead("b", 12), bead("c", 8), bead("d", 14)];
  assert.deepEqual(seedLooseParticles(inputs, BOUNDS), seedLooseParticles(inputs, BOUNDS));
});

test("seeded particles stay inside the tray and keep distinct radii", () => {
  const inputs = [bead("mm6", 12), bead("mm8", 16), bead("mm10", 20)];
  const state = seedLooseParticles(inputs, BOUNDS);
  assert.equal(state.particles.length, 3);
  assertInsideBounds(state);
  assertNoOverlap(state);
  assert.equal(state.particles[0]!.radiusPx, 12);
  assert.equal(state.particles[1]!.radiusPx, 16);
  assert.equal(state.particles[2]!.radiusPx, 20);
  assert.notEqual(state.particles[0]!.radiusPx, state.particles[1]!.radiusPx);
  assert.equal(state.settled, false);
});

test("reversed inputs still map each componentId to a stable seeded region", () => {
  const inputs = [bead("a", 10), bead("b", 12), bead("c", 8)];
  const reversed = [...inputs].reverse();
  const forward = seedLooseParticles(inputs, BOUNDS);
  const backward = seedLooseParticles(reversed, BOUNDS);
  for (const input of inputs) {
    const left = forward.particles.find((particle) => particle.componentId === input.componentId)!;
    const right = backward.particles.find((particle) => particle.componentId === input.componentId)!;
    assert.equal(left.x, right.x);
    assert.equal(left.y, right.y);
  }
});

test("a 49-body input keeps at most 48 physical particles and lists overflow ids", () => {
  const inputs = Array.from({ length: 49 }, (_, index) =>
    bead(`body-${index}`, 8)
  );
  const state = seedLooseParticles(inputs, BOUNDS);
  assert.equal(state.particles.length, MAX_PHYSICS_BODIES);
  assert.equal(state.overflowComponentIds.length, 1);
  assert.equal(state.overflowComponentIds[0], "body-48");
  for (const particle of state.particles) {
    assert.equal(particle.radiusPx, 8);
  }
});

test("injectLooseParticle places one launch particle without mutating prior state", () => {
  const seeded = seedLooseParticles([bead("a", 10), bead("b", 12)], BOUNDS);
  const frozen = structuredClone(seeded);
  const injected = injectLooseParticle(seeded, bead("c", 11), { x: 10, y: 10 }, BOUNDS);
  assert.deepEqual(seeded, frozen);
  assert.equal(injected.particles.length, 3);
  assert.equal(injected.particles.at(-1)!.componentId, "c");
  assert.ok(injected.particles.some((particle) => particle.componentId === "c"));
});

test("solver keeps particles inside bounds and transfers impulse on collision", () => {
  const start = seedLooseParticles([bead("a", 18), bead("b", 18)], BOUNDS);
  const overlapped: LoosePhysicsState = {
    ...start,
    particles: [
      { ...start.particles[0]!, x: 190, y: 200, velocityX: 2, velocityY: 0 },
      { ...start.particles[1]!, x: 210, y: 200, velocityX: -2, velocityY: 0 }
    ],
    settled: false
  };
  const frozen = structuredClone(overlapped);
  const next = stepLoosePhysics(overlapped, BOUNDS);
  assert.deepEqual(overlapped, frozen);
  assertInsideBounds(next);
  assert.ok(next.particles[0]!.velocityX < 0 || next.particles[1]!.velocityX > 0);
  assert.ok(Math.abs(next.particles[0]!.velocityX) < 2 || Math.abs(next.particles[1]!.velocityX) < 2);
});

test("unequal radii collide at their actual radii without NaN", () => {
  const start = seedLooseParticles([bead("large", 28), bead("small", 12)], BOUNDS);
  const overlapped: LoosePhysicsState = {
    ...start,
    particles: [
      { ...start.particles[0]!, x: 200, y: 200, velocityX: 0, velocityY: 0 },
      { ...start.particles[1]!, x: 220, y: 200, velocityX: -1, velocityY: 0 }
    ],
    settled: false
  };
  const next = stepLoosePhysics(overlapped, BOUNDS);
  assertInsideBounds(next);
  const distance = Math.hypot(next.particles[0]!.x - next.particles[1]!.x, next.particles[0]!.y - next.particles[1]!.y);
  assert.ok(distance + 0.55 >= 28 + 12);
});

test("coincident centers are separated along a finite normal", () => {
  const start = seedLooseParticles([bead("a", 14), bead("b", 14)], BOUNDS);
  const coincident: LoosePhysicsState = {
    ...start,
    particles: [
      { ...start.particles[0]!, x: 200, y: 200, velocityX: 0, velocityY: 0 },
      { ...start.particles[1]!, x: 200, y: 200, velocityX: 0, velocityY: 0 }
    ],
    settled: false
  };
  const next = stepLoosePhysics(coincident, BOUNDS);
  const a = next.particles[0]!;
  const b = next.particles[1]!;
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 1);
  assertInsideBounds(next);
});

test("damping reduces speed and sleep settles after stable frames", () => {
  const seeded = seedLooseParticles([bead("a", 10)], BOUNDS);
  const moving: LoosePhysicsState = {
    ...seeded,
    particles: [{ ...seeded.particles[0]!, x: 200, y: 200, velocityX: 1.2, velocityY: 0, sleepingFrames: 0 }],
    settled: false
  };
  let state = moving;
  for (let index = 0; index < 40; index += 1) {
    const previousSpeed = Math.hypot(state.particles[0]!.velocityX, state.particles[0]!.velocityY);
    state = stepLoosePhysics(state, BOUNDS);
    const nextSpeed = Math.hypot(state.particles[0]!.velocityX, state.particles[0]!.velocityY);
    if (index < 8) assert.ok(nextSpeed <= previousSpeed + 1e-9);
  }
  assert.equal(state.settled, true);
  assert.ok(Math.hypot(state.particles[0]!.velocityX, state.particles[0]!.velocityY) < 0.02);
});

test("hard stop snaps to a deterministic fallback after 3000 ms", () => {
  const inputs = Array.from({ length: 8 }, (_, index) => bead(`body-${index}`, 10));
  const seeded = seedLooseParticles(inputs, BOUNDS);
  const almostStopped: LoosePhysicsState = {
    ...seeded,
    elapsedMs: HARD_STOP_MS - 1,
    particles: seeded.particles.map((particle) => ({
      ...particle,
      velocityX: 4,
      velocityY: 3,
      sleepingFrames: 0
    })),
    settled: false
  };
  const state = stepLoosePhysics(almostStopped, BOUNDS);
  assert.equal(state.elapsedMs, HARD_STOP_MS);
  assert.equal(state.settled, true);
  const fallback = deterministicFallbackLayout(inputs, BOUNDS);
  assert.deepEqual(
    state.particles.map((particle) => particle.componentId),
    fallback.particles.map((particle) => particle.componentId)
  );
  assertInsideBounds(state);
  assert.ok(state.particles.every((particle) => particle.velocityX === 0 && particle.velocityY === 0));
});

test("deterministic fallback places equal-diameter bodies without overlap", () => {
  const inputs = Array.from({ length: 20 }, (_, index) => bead(`body-${index}`, 11));
  const first = deterministicFallbackLayout(inputs, BOUNDS);
  const second = deterministicFallbackLayout(inputs, BOUNDS);
  assert.deepEqual(first, second);
  assert.equal(first.settled, true);
  assert.equal(first.overflowComponentIds.length, 0);
  assertInsideBounds(first);
  assertNoOverlap(first);
});
