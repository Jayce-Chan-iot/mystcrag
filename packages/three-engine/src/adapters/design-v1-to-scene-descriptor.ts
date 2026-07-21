import { DesignV1Schema, type AccessoryV1, type BeadV1 } from "@mystcrag/design-contract";

import { createAnchoredTransform, createCircleTransforms } from "../layout/circle-layout";
import type { BraceletSceneDescriptor, SceneConversionWarning } from "../runtime/scene-descriptor";
import { componentToRenderItem } from "./component-to-render-item";

export type SceneAdapterOptions = {
  readonly knownAssetKeys?: readonly string[];
};

function assetStatus(
  component: BeadV1 | AccessoryV1,
  knownAssetKeys?: ReadonlySet<string>
): "AVAILABLE" | "FALLBACK" {
  return knownAssetKeys !== undefined && !knownAssetKeys.has(component.modelAssetKey)
    ? "FALLBACK"
    : "AVAILABLE";
}

function collectAssetWarnings(
  components: readonly (BeadV1 | AccessoryV1)[],
  knownAssetKeys?: ReadonlySet<string>
): SceneConversionWarning[] {
  if (knownAssetKeys === undefined) return [];
  return components.flatMap((component) =>
    [component.modelAssetKey, component.textureAssetKey]
      .filter((key): key is string => key !== undefined && !knownAssetKeys.has(key))
      .map((key) => ({
        code: "ASSET_NOT_FOUND" as const,
        componentId: component.componentId,
        assetKey: key,
        message: `Asset key is not available; procedural fallback will be used: ${key}`
      }))
  );
}

export function designV1ToSceneDescriptor(
  input: unknown,
  options: SceneAdapterOptions = {}
): BraceletSceneDescriptor {
  const design = DesignV1Schema.parse(input);
  const knownAssetKeys = options.knownAssetKeys
    ? new Set(options.knownAssetKeys)
    : undefined;
  const braceletRadiusMm = design.bracelet.targetInnerCircumferenceMm / (Math.PI * 2);
  const inlineAccessories = design.accessories.filter(
    (accessory) => accessory.placementMode === "INLINE"
  );
  const mainRing = [...design.beads, ...inlineAccessories].sort(
    (left, right) => left.positionIndex - right.positionIndex
  );
  const preliminaryItems = mainRing.map((component, sequenceIndex) =>
    componentToRenderItem(
      component,
      sequenceIndex,
      {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        radialOffsetMm: 0
      },
      assetStatus(component, knownAssetKeys)
    )
  );
  const transforms = createCircleTransforms(
    preliminaryItems,
    braceletRadiusMm,
    design.bracelet.beadGapMm
  );
  const mainItems = preliminaryItems.map((item, index) => ({
    ...item,
    transform: transforms[index]!
  }));
  const mainItemById = new Map(mainItems.map((item) => [item.componentId, item]));
  const anchoredAccessories = design.accessories
    .filter((accessory) => accessory.placementMode === "ANCHORED")
    .sort((left, right) => left.componentId.localeCompare(right.componentId));
  const anchoredItems = anchoredAccessories.map((accessory, anchoredIndex) => {
    const anchor = mainItemById.get(accessory.anchorComponentId);
    if (anchor === undefined) {
      throw new Error(`Validated design has no render anchor ${accessory.anchorComponentId}`);
    }
    const preliminary = componentToRenderItem(
      accessory,
      mainRing.length + anchoredIndex,
      anchor.transform,
      assetStatus(accessory, knownAssetKeys),
      accessory.anchorComponentId
    );
    return { ...preliminary, transform: createAnchoredTransform(anchor, preliminary) };
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
    warnings: collectAssetWarnings([...design.beads, ...design.accessories], knownAssetKeys)
  };
}
