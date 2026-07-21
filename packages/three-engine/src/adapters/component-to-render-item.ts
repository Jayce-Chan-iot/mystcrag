import type { AccessoryV1, BeadV1 } from "@mystcrag/design-contract";

import type { NumericTransform, RenderItem } from "../runtime/scene-descriptor";

export function isBeadComponent(component: BeadV1 | AccessoryV1): component is BeadV1 {
  return "beadProductId" in component;
}

export function getComponentRadiusMm(component: BeadV1 | AccessoryV1): number {
  if (isBeadComponent(component)) {
    return component.diameterMm / 2;
  }
  const dimensions = Object.values(component.dimensions).filter(
    (dimension): dimension is number => dimension !== undefined
  );
  return Math.max(...dimensions) / 2;
}

export function createCircleTransform(
  component: BeadV1 | AccessoryV1,
  sequenceIndex: number,
  sequenceLength: number,
  braceletRadiusMm: number
): NumericTransform {
  const angle = -Math.PI / 2 + (sequenceIndex / sequenceLength) * Math.PI * 2;
  const radialOffsetMm = getComponentRadiusMm(component);
  const radius = braceletRadiusMm + radialOffsetMm;
  return {
    position: {
      x: Number((Math.cos(angle) * radius).toFixed(6)),
      y: Number((Math.sin(angle) * radius).toFixed(6)),
      z: 0
    },
    rotation: { x: 0, y: 0, z: Number((angle + Math.PI / 2).toFixed(6)) },
    scale: { x: 1, y: 1, z: 1 },
    radialOffsetMm
  };
}

export function componentToRenderItem(
  component: BeadV1 | AccessoryV1,
  sequenceIndex: number,
  transform: NumericTransform,
  anchorComponentId?: string
): RenderItem {
  return {
    componentId: component.componentId,
    componentType: isBeadComponent(component) ? "BEAD" : "ACCESSORY",
    sequenceIndex,
    ...(anchorComponentId ? { anchorComponentId } : {}),
    transform,
    geometryKey: component.modelAssetKey,
    materialKey: isBeadComponent(component) ? component.materialKey : component.material,
    ...(component.textureAssetKey ? { textureAssetKey: component.textureAssetKey } : {}),
    interactionState: { selected: false, hovered: false, draggable: true }
  };
}
