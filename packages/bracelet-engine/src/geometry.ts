const TAU = Math.PI * 2;

export function normalizeAngle(angle: number): number {
  const value = angle % TAU;
  return value < 0 ? value + TAU : value;
}

export function positiveAngleDistance(from: number, to: number): number {
  return normalizeAngle(to - from);
}

export function isAngleInRange(angle: number, startAngle: number, endAngle: number): boolean {
  const span = positiveAngleDistance(startAngle, endAngle);
  return positiveAngleDistance(startAngle, angle) <= span + Number.EPSILON * 8;
}

export { TAU };
