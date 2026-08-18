import { isAngleInRange, normalizeAngle, positiveAngleDistance, TAU } from "./geometry.js";
import type { BraceletComponentInput, BraceletLayoutOptions, BraceletLayoutResult } from "./types.js";

const EPSILON = 1e-9;

function validateComponents(components: readonly BraceletComponentInput[]) {
  const ids = new Set<string>();
  for (const component of components) {
    if (!component.componentId || ids.has(component.componentId)) throw new Error("INVALID_COMPONENT_ID");
    if (!Number.isFinite(component.widthMm) || component.widthMm <= 0) throw new Error("INVALID_COMPONENT_WIDTH");
    if (component.heightMm !== undefined && (!Number.isFinite(component.heightMm) || component.heightMm <= 0)) throw new Error("INVALID_COMPONENT_HEIGHT");
    ids.add(component.componentId);
  }
}

function pairAngle(leftWidth: number, rightWidth: number, gapMm: number, radius: number): number {
  const chord = (leftWidth + rightWidth) / 2 + gapMm;
  return 2 * Math.asin(Math.min(1, chord / (2 * radius)));
}

function angleSum(widths: readonly number[], gapMm: number, radius: number): number {
  return widths.reduce((sum, width, index) => sum + pairAngle(width, widths[(index + 1) % widths.length] ?? width, gapMm, radius), 0);
}

export function solveRingRadius(widths: readonly number[], gapMm = 0): number {
  if (widths.length === 0) return 0;
  if (widths.length === 1) return Math.max(widths[0] ?? 0, gapMm) / 2;
  if (!Number.isFinite(gapMm) || gapMm < 0 || widths.some((width) => !Number.isFinite(width) || width <= 0)) throw new Error("INVALID_GEOMETRY");
  const largestChord = widths.reduce((largest, width, index) => Math.max(largest, (width + (widths[(index + 1) % widths.length] ?? width)) / 2 + gapMm), 0);
  let low = largestChord / 2 + EPSILON;
  let high = Math.max(low * 2, widths.reduce((sum, width) => sum + width + gapMm, 0) / TAU);
  while (angleSum(widths, gapMm, high) > TAU && high < 1e9) high *= 2;
  if (high >= 1e9) throw new Error("UNSOLVABLE_GEOMETRY");
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    if (angleSum(widths, gapMm, middle) > TAU) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function createBraceletLayout(
  components: readonly BraceletComponentInput[],
  options: BraceletLayoutOptions = {}
): BraceletLayoutResult {
  validateComponents(components);
  const center = options.center ?? { x: 0, y: 0 };
  const gapMm = options.gapMm ?? 0;
  const rotation = options.rotationRad ?? -Math.PI / 2;
  const widths = components.map((component) => component.widthMm);
  const radius = solveRingRadius(widths, gapMm);
  if (components.length === 0) return { center, circumference: 0, gapMm, radius, slots: [] };

  const pairAngles = components.map((component, index) => pairAngle(component.widthMm, components[(index + 1) % components.length]?.widthMm ?? component.widthMm, gapMm, radius));
  const scale = components.length === 1 ? 1 : TAU / pairAngles.reduce((sum, value) => sum + value, 0);
  const angles: number[] = [normalizeAngle(rotation)];
  for (let index = 1; index < components.length; index += 1) {
    angles.push(normalizeAngle((angles[index - 1] ?? rotation) + (pairAngles[index - 1] ?? 0) * scale));
  }
  const slots = components.map((component, index) => {
    const angle = angles[index] ?? normalizeAngle(rotation);
    const previous = angles[(index - 1 + angles.length) % angles.length] ?? angle;
    const next = angles[(index + 1) % angles.length] ?? angle;
    const startAngle = components.length === 1 ? 0 : normalizeAngle(previous + positiveAngleDistance(previous, angle) / 2);
    const endAngle = components.length === 1 ? TAU : normalizeAngle(angle + positiveAngleDistance(angle, next) / 2);
    return {
      angle,
      componentId: component.componentId,
      endAngle,
      height: component.heightMm ?? component.widthMm,
      index,
      rotation: angle + Math.PI / 2,
      startAngle,
      width: component.widthMm,
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    };
  });
  return { center, circumference: widths.reduce((sum, width) => sum + width, 0) + gapMm * components.length, gapMm, radius, slots };
}

export function resolveSlotAtAngle(layout: BraceletLayoutResult, angle: number) {
  const normalized = normalizeAngle(angle);
  return layout.slots.find((slot) => isAngleInRange(normalized, slot.startAngle, slot.endAngle)) ?? null;
}
