import type { PublicDesignV1 } from "@mystcrag/design-contract";

export interface DesignComponentViewModel {
  key: string;
  componentId: string;
  label: string;
  placement: string;
  positionIndex?: number;
  anchorComponentId?: string;
}

export function toDesignComponentViewModels(
  design: PublicDesignV1
): DesignComponentViewModel[] {
  const inline = [
    ...design.beads.map((bead) => ({
      key: bead.componentId,
      componentId: bead.componentId,
      label: `${bead.shape} ${bead.diameterMm}mm`,
      placement: `Position ${bead.positionIndex}`,
      positionIndex: bead.positionIndex
    })),
    ...design.accessories
      .filter((accessory) => accessory.placementMode === "INLINE")
      .map((accessory) => ({
        key: accessory.componentId,
        componentId: accessory.componentId,
        label: accessory.accessoryType,
        placement: `Position ${accessory.positionIndex}`,
        positionIndex: accessory.positionIndex
      }))
  ]
    .sort((left, right) => left.positionIndex - right.positionIndex);

  const anchored = design.accessories
    .filter((accessory) => accessory.placementMode === "ANCHORED")
    .map((accessory) => ({
      key: accessory.componentId,
      componentId: accessory.componentId,
      label: accessory.accessoryType,
      placement: `Anchored to ${accessory.anchorComponentId}`,
      anchorComponentId: accessory.anchorComponentId
    }));

  return [...inline, ...anchored];
}
