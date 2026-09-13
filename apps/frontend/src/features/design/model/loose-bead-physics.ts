/**
 * Presentation-only loose-bead particle physics.
 * Coordinates never mutate DesignV1, positionIndex, pricing, inventory or revision.
 */

export type LooseBodyInput = {
  componentId: string;
  radiusPx: number;
  kind: "BEAD" | "INLINE_ACCESSORY";
};

export type LooseParticle = LooseBodyInput & {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  sleepingFrames: number;
};

export type LooseBounds = {
  centerX: number;
  centerY: number;
  innerRadiusPx: number;
};

export type LoosePhysicsState = {
  elapsedMs: number;
  overflowComponentIds: readonly string[];
  particles: readonly LooseParticle[];
  settled: boolean;
};

export const MAX_PHYSICS_BODIES = 48;
export const FIXED_STEP_MS = 1000 / 60;
export const HARD_STOP_MS = 3000;

const SLEEP_SPEED_THRESHOLD = 0.02;
const SLEEP_FRAMES = 12;
const SOLVER_ITERATIONS = 4;
const LINEAR_DAMPING = 0.82;
const MAX_DISPLACEMENT_PX = 8;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function cloneState(state: LoosePhysicsState): LoosePhysicsState {
  return {
    elapsedMs: state.elapsedMs,
    overflowComponentIds: [...state.overflowComponentIds],
    particles: state.particles.map((particle) => ({ ...particle })),
    settled: state.settled
  };
}

function clampRadius(radiusPx: number): number {
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) return 1;
  return radiusPx;
}

function maxAvailableRadius(bounds: LooseBounds, radiusPx: number): number {
  const maxRadius = Math.max(1, bounds.innerRadiusPx * 0.42);
  return Math.min(radiusPx, maxRadius);
}

function candidateFor(componentId: string, index: number, count: number, bounds: LooseBounds, radiusPx: number): { x: number; y: number } {
  const usable = Math.max(1, bounds.innerRadiusPx - radiusPx);
  const hash = hashString(componentId);
  const angle = (hash % 360) * (Math.PI / 180) + index * GOLDEN_ANGLE;
  const radial = usable * (0.18 + 0.72 * (((hash >>> 8) % 1000) / 1000));
  const spiral = usable * Math.sqrt((index + 0.5) / Math.max(1, count)) * 0.92;
  const distance = Math.min(usable, (radial + spiral) * 0.5);
  return {
    x: bounds.centerX + Math.cos(angle) * distance,
    y: bounds.centerY + Math.sin(angle) * distance
  };
}

function projectIntoBounds(particle: LooseParticle, bounds: LooseBounds): LooseParticle {
  const radius = clampRadius(particle.radiusPx);
  const maxDistance = Math.max(0, bounds.innerRadiusPx - radius);
  const dx = particle.x - bounds.centerX;
  const dy = particle.y - bounds.centerY;
  const distance = Math.hypot(dx, dy);
  if (distance <= maxDistance) return particle;
  if (distance === 0) {
    return { ...particle, x: bounds.centerX + maxDistance * 0.5, y: bounds.centerY };
  }
  const scale = maxDistance / distance;
  const nx = dx / distance;
  const ny = dy / distance;
  const inward = particle.velocityX * nx + particle.velocityY * ny;
  return {
    ...particle,
    x: bounds.centerX + dx * scale,
    y: bounds.centerY + dy * scale,
    velocityX: particle.velocityX - (inward > 0 ? inward * 1.1 : 0) * nx,
    velocityY: particle.velocityY - (inward > 0 ? inward * 1.1 : 0) * ny
  };
}

function resolvePair(a: LooseParticle, b: LooseParticle): [LooseParticle, LooseParticle] {
  const radiusA = clampRadius(a.radiusPx);
  const radiusB = clampRadius(b.radiusPx);
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let distance = Math.hypot(dx, dy);
  const minDistance = radiusA + radiusB;
  if (distance > minDistance) return [a, b];

  if (distance < 1e-6) {
    const angle = (hashString(a.componentId + b.componentId) % 360) * (Math.PI / 180);
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    distance = 1;
  }

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minDistance - distance;
  const massA = radiusA * radiusA;
  const massB = radiusB * radiusB;
  const totalMass = massA + massB;
  const shareA = massB / totalMass;
  const shareB = massA / totalMass;

  const relativeNormal = (b.velocityX - a.velocityX) * nx + (b.velocityY - a.velocityY) * ny;
  const restitution = 0.28;
  const impulse = relativeNormal < 0 ? -(1 + restitution) * relativeNormal * (massA * massB) / totalMass : 0;

  const nextA: LooseParticle = {
    ...a,
    x: a.x - nx * overlap * shareA,
    y: a.y - ny * overlap * shareA,
    velocityX: a.velocityX - (impulse / massA) * nx,
    velocityY: a.velocityY - (impulse / massA) * ny,
    sleepingFrames: 0
  };
  const nextB: LooseParticle = {
    ...b,
    x: b.x + nx * overlap * shareB,
    y: b.y + ny * overlap * shareB,
    velocityX: b.velocityX + (impulse / massB) * nx,
    velocityY: b.velocityY + (impulse / massB) * ny,
    sleepingFrames: 0
  };
  return [nextA, nextB];
}

function relaxPositions(particles: readonly LooseParticle[], bounds: LooseBounds): LooseParticle[] {
  let working = particles.map((particle) => ({ ...particle }));
  for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration += 1) {
    for (let left = 0; left < working.length; left += 1) {
      for (let right = left + 1; right < working.length; right += 1) {
        const [nextLeft, nextRight] = resolvePair(working[left]!, working[right]!);
        working[left] = nextLeft;
        working[right] = nextRight;
      }
    }
    working = working.map((particle) => projectIntoBounds(particle, bounds));
  }
  return working;
}

function placeWithoutOverlap(inputs: readonly LooseBodyInput[], bounds: LooseBounds, capacity: number) {
  const ordered = [...inputs]
    .map((input, index) => ({ index, input: { ...input, radiusPx: maxAvailableRadius(bounds, clampRadius(input.radiusPx)) } }))
    .sort((left, right) => left.input.componentId.localeCompare(right.input.componentId));

  const placed: LooseParticle[] = [];
  const overflow: string[] = [];

  for (const { input } of ordered) {
    if (placed.length >= capacity) {
      overflow.push(input.componentId);
      continue;
    }
    let candidate = candidateFor(input.componentId, placed.length, Math.max(capacity, ordered.length), bounds, input.radiusPx);
    let accepted = false;
    for (let attempt = 0; attempt < 36; attempt += 1) {
      candidate = candidateFor(input.componentId, placed.length + attempt, Math.max(capacity, ordered.length), bounds, input.radiusPx);
      const distance = Math.hypot(candidate.x - bounds.centerX, candidate.y - bounds.centerY);
      if (distance + input.radiusPx > bounds.innerRadiusPx) continue;
      const blocked = placed.some((particle) => {
        const gap = Math.hypot(particle.x - candidate.x, particle.y - candidate.y);
        return gap < particle.radiusPx + input.radiusPx - 0.35;
      });
      if (!blocked) {
        accepted = true;
        break;
      }
    }
    if (!accepted) {
      // Soft overflow only when real radii cannot fit without dishonest scale.
      overflow.push(input.componentId);
      continue;
    }
    placed.push({
      ...input,
      x: candidate.x,
      y: candidate.y,
      velocityX: 0,
      velocityY: 0,
      sleepingFrames: 0
    });
  }

  // Preserve caller input order for the visible particle list.
  const byId = new Map(placed.map((particle) => [particle.componentId, particle]));
  const visible = inputs
    .filter((input) => byId.has(input.componentId))
    .map((input) => ({ ...byId.get(input.componentId)!, radiusPx: maxAvailableRadius(bounds, clampRadius(input.radiusPx)) }));

  // If ordered-visible count was reduced by soft overflow, keep stable overflow ids sorted by input order.
  const overflowSet = new Set(overflow);
  const overflowComponentIds = inputs.filter((input) => overflowSet.has(input.componentId)).map((input) => input.componentId);

  return { overflowComponentIds, particles: visible };
}

export function seedLooseParticles(inputs: readonly LooseBodyInput[], bounds: LooseBounds): LoosePhysicsState {
  const boundedInputs = inputs.slice(0, Math.max(inputs.length, 0));
  const hardOverflow = boundedInputs.length > MAX_PHYSICS_BODIES
    ? boundedInputs.slice(MAX_PHYSICS_BODIES).map((input) => input.componentId)
    : [];
  const physical = boundedInputs.slice(0, MAX_PHYSICS_BODIES);
  const { overflowComponentIds, particles } = placeWithoutOverlap(physical, bounds, MAX_PHYSICS_BODIES);
  const overflow = [...overflowComponentIds, ...hardOverflow];
  if (overflow.length > 0 || particles.length === 0) {
    return {
      ...deterministicFallbackLayout(boundedInputs, bounds),
      overflowComponentIds: [
        ...new Set([
          ...overflow,
          ...deterministicFallbackLayout(boundedInputs, bounds).overflowComponentIds
        ])
      ]
    };
  }
  return {
    elapsedMs: 0,
    overflowComponentIds: overflow,
    particles,
    settled: false
  };
}

export function injectLooseParticle(
  state: LoosePhysicsState,
  input: LooseBodyInput,
  origin: { x: number; y: number },
  bounds: LooseBounds
): LoosePhysicsState {
  const next = cloneState(state);
  if (next.particles.some((particle) => particle.componentId === input.componentId)) return next;
  if (next.particles.length >= MAX_PHYSICS_BODIES) {
    return {
      ...next,
      overflowComponentIds: [...next.overflowComponentIds, input.componentId]
    };
  }
  const radius = maxAvailableRadius(bounds, clampRadius(input.radiusPx));
  const dx = origin.x - bounds.centerX;
  const dy = origin.y - bounds.centerY;
  const distance = Math.hypot(dx, dy) || 1;
  const edgeScale = Math.max(0, bounds.innerRadiusPx - radius) / distance;
  const startX = distance > bounds.innerRadiusPx - radius
    ? bounds.centerX + dx * edgeScale
    : origin.x;
  const startY = distance > bounds.innerRadiusPx - radius
    ? bounds.centerY + dy * edgeScale
    : origin.y;
  const targetAngle = (hashString(input.componentId) % 360) * (Math.PI / 180);
  const targetDistance = Math.max(0, bounds.innerRadiusPx - radius) * 0.35;
  const targetX = bounds.centerX + Math.cos(targetAngle) * targetDistance;
  const targetY = bounds.centerY + Math.sin(targetAngle) * targetDistance;
  const velocityScale = 0.35;
  next.particles = [
    ...next.particles,
    {
      ...input,
      radiusPx: radius,
      x: startX,
      y: startY,
      velocityX: (targetX - startX) * velocityScale,
      velocityY: (targetY - startY) * velocityScale,
      sleepingFrames: 0
    }
  ];
  next.settled = false;
  next.elapsedMs = Math.min(next.elapsedMs, HARD_STOP_MS - FIXED_STEP_MS);
  return next;
}

export function stepLoosePhysics(
  state: LoosePhysicsState,
  bounds: LooseBounds,
  stepMs: number = FIXED_STEP_MS
): LoosePhysicsState {
  if (state.settled) return cloneState(state);

  const elapsedMs = Math.min(HARD_STOP_MS, state.elapsedMs + stepMs);
  if (elapsedMs >= HARD_STOP_MS) {
    const fallback = deterministicFallbackLayout(
      state.particles.map((particle) => ({
        componentId: particle.componentId,
        radiusPx: particle.radiusPx,
        kind: particle.kind
      })),
      bounds
    );
    return {
      elapsedMs: HARD_STOP_MS,
      overflowComponentIds: state.overflowComponentIds,
      particles: fallback.particles.map((particle) => ({
        ...particle,
        sleepingFrames: SLEEP_FRAMES,
        velocityX: 0,
        velocityY: 0
      })),
      settled: true
    };
  }

  let particles = state.particles.map((particle) => {
    if (particle.sleepingFrames >= SLEEP_FRAMES) return { ...particle };
    let deltaX = particle.velocityX * stepMs;
    let deltaY = particle.velocityY * stepMs;
    const displacement = Math.hypot(deltaX, deltaY);
    if (displacement > MAX_DISPLACEMENT_PX) {
      const scale = MAX_DISPLACEMENT_PX / displacement;
      deltaX *= scale;
      deltaY *= scale;
    }
    return {
      ...particle,
      x: particle.x + deltaX,
      y: particle.y + deltaY,
      velocityX: particle.velocityX * LINEAR_DAMPING,
      velocityY: particle.velocityY * LINEAR_DAMPING
    };
  });

  particles = relaxPositions(particles, bounds);

  let allAsleep = particles.length > 0;
  particles = particles.map((particle) => {
    const speed = Math.hypot(particle.velocityX, particle.velocityY);
    if (speed < SLEEP_SPEED_THRESHOLD) {
      const sleepingFrames = particle.sleepingFrames + 1;
      if (sleepingFrames < SLEEP_FRAMES) allAsleep = false;
      return {
        ...particle,
        velocityX: sleepingFrames >= SLEEP_FRAMES ? 0 : particle.velocityX,
        velocityY: sleepingFrames >= SLEEP_FRAMES ? 0 : particle.velocityY,
        sleepingFrames
      };
    }
    allAsleep = false;
    return { ...particle, sleepingFrames: 0 };
  });

  return {
    elapsedMs,
    overflowComponentIds: state.overflowComponentIds,
    particles,
    settled: allAsleep
  };
}

export function deterministicFallbackLayout(
  inputs: readonly LooseBodyInput[],
  bounds: LooseBounds
): LoosePhysicsState {
  const bounded = inputs.slice(0, MAX_PHYSICS_BODIES);
  const hardOverflow = inputs.slice(MAX_PHYSICS_BODIES).map((input) => input.componentId);
  const { overflowComponentIds, particles } = placeWithoutOverlap(bounded, bounds, MAX_PHYSICS_BODIES);
  return {
    elapsedMs: HARD_STOP_MS,
    overflowComponentIds: [...overflowComponentIds, ...hardOverflow],
    particles: particles.map((particle) => ({
      ...particle,
      velocityX: 0,
      velocityY: 0,
      sleepingFrames: SLEEP_FRAMES
    })),
    settled: true
  };
}
