import type { NumericTransform, RenderItem } from "../runtime/scene-descriptor";

const round = (value: number) => Number(value.toFixed(6));

export function getRenderItemDiameterMm(item: Pick<RenderItem, "geometry">): number {
  if (item.geometry.kind === "SPHERE" || item.geometry.kind === "CYLINDER") {
    return item.geometry.diameterMm;
  }
  return Math.max(item.geometry.widthMm, item.geometry.heightMm, item.geometry.depthMm);
}

export function createCircleTransforms(
  items: readonly Pick<RenderItem, "geometry">[],
  braceletRadiusMm: number,
  gapMm: number
): NumericTransform[] {
  if (items.length === 0) {
    return [];
  }
  const footprints = items.map((item) => getRenderItemDiameterMm(item) + gapMm);
  const totalFootprint = footprints.reduce((sum, footprint) => sum + footprint, 0);
  let consumed = 0;
  return items.map((item, index) => {
    const footprint = footprints[index] ?? 0;
    const angle = -Math.PI / 2 + ((consumed + footprint / 2) / totalFootprint) * Math.PI * 2;
    consumed += footprint;
    const radialOffsetMm = getRenderItemDiameterMm(item) / 2;
    const radius = braceletRadiusMm + radialOffsetMm;
    return {
      position: {
        x: round(Math.cos(angle) * radius),
        y: round(Math.sin(angle) * radius),
        z: 0
      },
      rotation: { x: Math.PI / 2, y: 0, z: round(angle + Math.PI / 2) },
      scale: { x: 1, y: 1, z: 1 },
      radialOffsetMm
    };
  });
}

export function createAnchoredTransform(
  anchor: RenderItem,
  item: Pick<RenderItem, "geometry" | "anchorSlot">
): NumericTransform {
  const anchorAngle = Math.atan2(anchor.transform.position.y, anchor.transform.position.x);
  const offset =
    anchor.transform.radialOffsetMm +
    getRenderItemDiameterMm(item) / 2 +
    1 +
    (item.anchorSlot ?? 0) * 2;
  return {
    position: {
      x: round(anchor.transform.position.x + Math.cos(anchorAngle) * offset),
      y: round(anchor.transform.position.y + Math.sin(anchorAngle) * offset),
      z: round(-((item.anchorSlot ?? 0) * 0.5))
    },
    rotation: { x: 0, y: 0, z: round(anchorAngle - Math.PI / 2) },
    scale: { x: 1, y: 1, z: 1 },
    radialOffsetMm: getRenderItemDiameterMm(item) / 2
  };
}
