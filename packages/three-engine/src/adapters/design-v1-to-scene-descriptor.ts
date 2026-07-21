import {
  DesignV1Schema,
  type AccessoryV1,
  type BeadV1
} from "@mystcrag/design-contract";

import type {
  BraceletSceneDescriptor,
  NumericTransform,
  SceneConversionWarning
} from "../runtime/scene-descriptor";
import {
  componentToRenderItem,
  createCircleTransform
} from "./component-to-render-item";

export type SceneAdapterOptions = {
  readonly knownAssetKeys?: readonly string[];
};

function collectAssetWarnings(
  components: readonly (BeadV1 | AccessoryV1)[],
  knownAssetKeys?: readonly string[]
): SceneConversionWarning[] {
  if (knownAssetKeys === undefined) {
    return [];
  }
  const known = new Set(knownAssetKeys);
  return components.flatMap((component) =>
    [component.modelAssetKey, component.textureAssetKey]
      .filter((assetKey): assetKey is string => assetKey !== undefined && !known.has(assetKey))
      .map((assetKey) => ({
        code: "ASSET_NOT_FOUND" as const,
        componentId: component.componentId,
        assetKey,
        message: `Asset key is not available: ${assetKey}`
      }))
  );
}

export function designV1ToSceneDescriptor(
  input: unknown,
  options: SceneAdapterOptions = {}
): BraceletSceneDescriptor {
  const design = DesignV1Schema.parse(input);
  const braceletRadiusMm = design.bracelet.targetInnerCircumferenceMm / (Math.PI * 2);
  const inlineAccessories = design.accessories.filter(
    (accessory) => accessory.placementMode === "INLINE"
  );
  const mainRing = [...design.beads, ...inlineAccessories].sort(
    (left, right) => left.positionIndex - right.positionIndex
  );
  const mainItems = mainRing.map((component, sequenceIndex) =>
    componentToRenderItem(
      component,
      sequenceIndex,
      createCircleTransform(component, sequenceIndex, mainRing.length, braceletRadiusMm)
    )
  );
  const mainItemById = new Map(mainItems.map((item) => [item.componentId, item]));
  const anchoredAccessories = design.accessories
    .filter((accessory) => accessory.placementMode === "ANCHORED")
    .sort((left, right) => left.componentId.localeCompare(right.componentId));
  const anchoredItems = anchoredAccessories.map((accessory, anchoredIndex) => {
    const anchor = mainItemById.get(accessory.anchorComponentId);
    if (anchor === undefined) {
      throw new Error(`Validated design has no render anchor ${accessory.anchorComponentId}`);
    }
    const transform: NumericTransform = {
      position: {
        x: anchor.transform.position.x,
        y: anchor.transform.position.y,
        z: -((accessory.anchorSlot + 1) * 2)
      },
      rotation: { ...anchor.transform.rotation },
      scale: { x: 1, y: 1, z: 1 },
      radialOffsetMm: anchor.transform.radialOffsetMm
    };
    return componentToRenderItem(
      accessory,
      mainRing.length + anchoredIndex,
      transform,
      accessory.anchorComponentId
    );
  });

  return {
    designId: design.designId,
    revision: design.revision,
    layout: design.bracelet.braceletLayout,
    geometry: {
      targetInnerCircumferenceMm: design.bracelet.targetInnerCircumferenceMm,
      braceletRadiusMm: Number(braceletRadiusMm.toFixed(6)),
      beadGapMm: design.bracelet.beadGapMm
    },
    renderItems: [...mainItems, ...anchoredItems],
    cameraPreset: "JEWELRY_ORBIT",
    environmentPreset: "SOFT_STUDIO",
    warnings: collectAssetWarnings(
      [...design.beads, ...design.accessories],
      options.knownAssetKeys
    )
  };
}
