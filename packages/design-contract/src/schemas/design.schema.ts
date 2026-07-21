import { z } from "zod";

import { AccessoryV1Schema } from "./accessory.schema";
import { BeadV1Schema } from "./bead.schema";
import { BraceletV1Schema } from "./bracelet.schema";
import { CommunityV1Schema } from "./community.schema";
import { ComplianceV1Schema } from "./compliance.schema";
import { DesignMetadataSchema } from "./metadata.schema";
import { PricingV1Schema } from "./pricing.schema";
import { ProductionV1Schema } from "./production.schema";
import { ProvenanceV1Schema } from "./provenance.schema";
import { StoryV1Schema } from "./story.schema";

export const DesignV1Schema = z
  .strictObject({
    ...DesignMetadataSchema.shape,
    bracelet: BraceletV1Schema,
    beads: z.array(BeadV1Schema).min(1),
    accessories: z.array(AccessoryV1Schema),
    story: StoryV1Schema,
    pricing: PricingV1Schema,
    production: ProductionV1Schema,
    compliance: ComplianceV1Schema,
    provenance: ProvenanceV1Schema,
    community: CommunityV1Schema
  })
  .superRefine((design, context) => {
    const addIssue = (path: PropertyKey[], message: string) => {
      context.addIssue({ code: "custom", message, path });
    };

    if (Date.parse(design.updatedAt) < Date.parse(design.createdAt)) {
      addIssue(["updatedAt"], "updatedAt cannot be earlier than createdAt");
    }

    if (design.bracelet.totalBeadCount !== design.beads.length) {
      addIssue(
        ["bracelet", "totalBeadCount"],
        "totalBeadCount must equal the number of bead entries"
      );
    }

    const allComponents = [...design.beads, ...design.accessories];
    const componentIds = allComponents.map((component) => component.componentId);
    if (new Set(componentIds).size !== componentIds.length) {
      addIssue(["beads"], "componentId values must be unique across all components");
    }

    const inlineAccessories = design.accessories.filter(
      (accessory) => accessory.placementMode === "INLINE"
    );
    const mainRingComponents = [...design.beads, ...inlineAccessories].sort(
      (left, right) => left.positionIndex - right.positionIndex
    );
    const positions = mainRingComponents.map((component) => component.positionIndex);
    if (new Set(positions).size !== positions.length) {
      addIssue(["accessories"], "Main-ring positionIndex values must be unique");
    }
    positions.forEach((position, index) => {
      if (position !== index) {
        addIssue(
          ["accessories"],
          "Main-ring positionIndex values must start at zero and remain contiguous"
        );
      }
    });

    const inlineIds = new Set(mainRingComponents.map((component) => component.componentId));
    const anchoredAccessories = design.accessories.filter(
      (accessory) => accessory.placementMode === "ANCHORED"
    );
    for (const accessory of anchoredAccessories) {
      if (accessory.anchorComponentId === accessory.componentId) {
        addIssue(["accessories"], "An anchored accessory cannot anchor to itself");
      }
      if (!inlineIds.has(accessory.anchorComponentId)) {
        addIssue(
          ["accessories"],
          "anchorComponentId must reference a bead or INLINE accessory"
        );
      }
    }

    const materialSubtotal = design.beads.reduce(
      (total, bead) => total + bead.unitPriceMinor,
      0
    );
    if (
      !Number.isSafeInteger(materialSubtotal) ||
      design.pricing.materialSubtotalMinor !== materialSubtotal
    ) {
      addIssue(
        ["pricing", "materialSubtotalMinor"],
        "materialSubtotalMinor must equal the sum of bead unit prices"
      );
    }

    const accessorySubtotal = design.accessories.reduce(
      (total, accessory) => total + accessory.unitPriceMinor,
      0
    );
    if (
      !Number.isSafeInteger(accessorySubtotal) ||
      design.pricing.accessorySubtotalMinor !== accessorySubtotal
    ) {
      addIssue(
        ["pricing", "accessorySubtotalMinor"],
        "accessorySubtotalMinor must equal the sum of accessory unit prices"
      );
    }

    if (design.production.wristCircumferenceMm !== design.bracelet.wristCircumferenceMm) {
      addIssue(
        ["production", "wristCircumferenceMm"],
        "Production wrist circumference must match the bracelet"
      );
    }

    const expectedSequence = mainRingComponents.map((component) => component.componentId);
    if (
      expectedSequence.length !== design.production.componentSequence.length ||
      expectedSequence.some(
        (componentId, index) => design.production.componentSequence[index] !== componentId
      )
    ) {
      addIssue(
        ["production", "componentSequence"],
        "Production componentSequence must be derived from the ordered main ring"
      );
    }

    const expectedAnchors = new Map(
      anchoredAccessories.map((accessory) => [
        accessory.componentId,
        `${accessory.anchorComponentId}:${accessory.anchorSlot}`
      ])
    );
    const productionAnchors = new Map(
      design.production.anchoredComponents.map((component) => [
        component.componentId,
        `${component.anchorComponentId}:${component.anchorSlot}`
      ])
    );
    if (
      expectedAnchors.size !== productionAnchors.size ||
      [...expectedAnchors].some(
        ([componentId, anchor]) => productionAnchors.get(componentId) !== anchor
      )
    ) {
      addIssue(
        ["production", "anchoredComponents"],
        "Production anchored components must match the design anchors"
      );
    }

    const knownComponentIds = new Set(componentIds);
    for (const [itemIndex, item] of design.production.billOfMaterials.entries()) {
      for (const [sourceIndex, sourceComponentId] of item.sourceComponentIds.entries()) {
        if (!knownComponentIds.has(sourceComponentId)) {
          addIssue(
            ["production", "billOfMaterials", itemIndex, "sourceComponentIds", sourceIndex],
            "BOM sourceComponentIds must reference design components"
          );
        }
      }
    }

    if (
      design.compliance.complianceStatus === "REJECTED" &&
      design.community.visibility !== "PRIVATE"
    ) {
      addIssue(["community", "visibility"], "REJECTED designs cannot be published");
    }
  });

export type DesignV1 = z.infer<typeof DesignV1Schema>;
