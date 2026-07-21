import { createAnchoredTransform, createCircleTransforms } from "../layout/circle-layout";
import type { BraceletSceneDescriptor, RenderGeometry, RenderItem } from "../runtime/scene-descriptor";

export type PreviewReplacement = {
  readonly materialKey: string;
  readonly textureAssetKey?: string;
  readonly geometryKey: string;
  readonly geometry: RenderGeometry;
};

export function replacePreviewComponent(
  descriptor: BraceletSceneDescriptor,
  componentId: string,
  replacement: PreviewReplacement
): BraceletSceneDescriptor {
  const target = descriptor.renderItems.find((item) => item.componentId === componentId);
  if (!target) throw new Error(`Cannot replace unknown component: ${componentId}`);
  if (target.componentType !== "BEAD") {
    throw new Error(`Preview replacement only supports beads: ${componentId}`);
  }
  const replaced = descriptor.renderItems.map((item): RenderItem => {
    if (item.componentId !== componentId) return item;
    const { textureAssetKey: _textureAssetKey, ...withoutTexture } = item;
    return {
      ...withoutTexture,
      materialKey: replacement.materialKey,
      geometryKey: replacement.geometryKey,
      geometry: replacement.geometry,
      ...(replacement.textureAssetKey ? { textureAssetKey: replacement.textureAssetKey } : {}),
      assetStatus: "AVAILABLE"
    };
  });
  const mainRing = replaced
    .filter((item) => item.placementMode === "INLINE")
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex);
  const transforms = createCircleTransforms(
    mainRing,
    descriptor.geometry.braceletRadiusMm,
    descriptor.geometry.beadGapMm
  );
  const relaidMain = mainRing.map((item, index) => ({ ...item, transform: transforms[index]! }));
  const mainById = new Map(relaidMain.map((item) => [item.componentId, item]));
  const anchored = replaced
    .filter((item) => item.placementMode === "ANCHORED")
    .map((item) => {
      const anchor = item.anchorComponentId ? mainById.get(item.anchorComponentId) : undefined;
      if (!anchor) throw new Error(`Cannot relayout missing anchor: ${item.anchorComponentId ?? ""}`);
      return { ...item, transform: createAnchoredTransform(anchor, item) };
    });
  const byId = new Map([...relaidMain, ...anchored].map((item) => [item.componentId, item]));
  return {
    ...descriptor,
    renderItems: descriptor.renderItems.map((item) => byId.get(item.componentId)!)
  };
}
