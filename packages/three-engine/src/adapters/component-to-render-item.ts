import type { AccessoryV1, BeadV1 } from "@mystcrag/design-contract";

import type {
  NumericTransform,
  RenderGeometry,
  RenderItem
} from "../runtime/scene-descriptor";

export function isBeadComponent(component: BeadV1 | AccessoryV1): component is BeadV1 {
  return "beadProductId" in component;
}

function accessoryDimension(
  component: AccessoryV1,
  key: keyof AccessoryV1["dimensions"],
  fallback: number
): number {
  return component.dimensions[key] ?? fallback;
}

export function getComponentDiameterMm(component: BeadV1 | AccessoryV1): number {
  if (isBeadComponent(component)) {
    return component.diameterMm;
  }
  return Math.max(
    component.dimensions.diameterMm ?? 0,
    component.dimensions.widthMm ?? 0,
    component.dimensions.heightMm ?? 0,
    component.dimensions.depthMm ?? 0
  );
}

export function componentToGeometry(component: BeadV1 | AccessoryV1): RenderGeometry {
  if (isBeadComponent(component)) {
    return { kind: "SPHERE", diameterMm: component.diameterMm };
  }
  if (component.accessoryType === "SPACER" || component.accessoryType === "CONNECTOR") {
    const diameterMm = accessoryDimension(
      component,
      "diameterMm",
      accessoryDimension(component, "heightMm", 3)
    );
    return {
      kind: "CYLINDER",
      diameterMm,
      depthMm: accessoryDimension(component, "widthMm", 2)
    };
  }
  return {
    kind: "BOX",
    widthMm: accessoryDimension(component, "widthMm", 4),
    heightMm: accessoryDimension(component, "heightMm", 6),
    depthMm: accessoryDimension(component, "depthMm", 2)
  };
}

export function componentToRenderItem(
  component: BeadV1 | AccessoryV1,
  sequenceIndex: number,
  transform: NumericTransform,
  assetStatus: RenderItem["assetStatus"],
  anchorComponentId?: string
): RenderItem {
  const bead = isBeadComponent(component);
  return {
    componentId: component.componentId,
    componentType: bead ? "BEAD" : "ACCESSORY",
    ...(!bead ? { accessoryType: component.accessoryType } : {}),
    placementMode: bead ? "INLINE" : component.placementMode,
    sequenceIndex,
    ...(anchorComponentId ? { anchorComponentId } : {}),
    ...(!bead && component.placementMode === "ANCHORED"
      ? { anchorSlot: component.anchorSlot }
      : {}),
    transform,
    geometryKey: component.modelAssetKey,
    geometry: componentToGeometry(component),
    materialKey: bead ? component.materialKey : component.material,
    ...(component.textureAssetKey ? { textureAssetKey: component.textureAssetKey } : {}),
    assetStatus,
    interactionState: { selectable: true, draggable: false }
  };
}
