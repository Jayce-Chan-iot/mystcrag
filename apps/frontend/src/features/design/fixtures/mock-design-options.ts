import { PublicDesignV1Schema, type PublicDesignV1 } from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

type DesignVariant = {
  designId: string;
  designName: string;
  story: string;
  reason: string;
  palette: string[];
  styleTags: string[];
};

const variants: DesignVariant[] = [
  {
    designId: "rain-after-blue",
    designName: "雨霁青",
    story: "雨停之后，天色尚未完全明亮。清透的蓝、柔白与一点银色，在克制的节奏里留下呼吸。",
    reason: "与你选择的低饱和色彩和清简风格相合，整体轻盈，适合日常叠戴。",
    palette: ["#9fcbd5", "#ece9e1", "#b5a2c2"],
    styleTags: ["清透", "留白", "东方当代"]
  },
  {
    designId: "mountain-violet",
    designName: "暮山紫",
    story: "像暮色落进远山，浅紫与烟灰缓缓交叠，以一颗清亮主珠收住安静而坚定的重心。",
    reason: "保留柔和氛围，同时增加材质深浅对比，适合偏爱含蓄层次的你。",
    palette: ["#aa98b8", "#827a7d", "#e7e3dc"],
    styleTags: ["沉静", "层次", "轻珠宝"]
  },
  {
    designId: "moonlit-white",
    designName: "月照白",
    story: "月白、雾银和少量透明质地组成几乎无色的光谱，让细微折射成为整条手链的表情。",
    reason: "以中性色回应你的审美偏好，搭配自由，并通过尺寸变化保持设计感。",
    palette: ["#eceae3", "#cfd5d2", "#b9afc2"],
    styleTags: ["极简", "中性", "光感"]
  }
];

function createExpandedFixture(): PublicDesignV1 {
  const sourceBeads = standardAiDesignFixture.beads;
  const priceByMaterial: Record<string, number> = {
    "aquamarine-clear-v1": 2400,
    "moonstone-soft-v1": 2000,
    "clear-quartz-v1": 1800
  };
  const beads = Array.from({ length: 14 }, (_, index) => {
    const source = sourceBeads[index % sourceBeads.length]!;
    return {
      ...source,
      componentId: `bead-${String(index + 1).padStart(2, "0")}`,
      positionIndex: index,
      unitPriceMinor: priceByMaterial[source.materialKey] ?? source.unitPriceMinor
    };
  });
  const pendant = {
    ...standardAiDesignFixture.accessories.find((accessory) => accessory.placementMode === "ANCHORED")!,
    componentId: "accessory-pendant-01",
    anchorComponentId: beads[0]!.componentId,
    unitPriceMinor: 3800
  };
  const materialSubtotalMinor = beads.reduce((total, bead) => total + bead.unitPriceMinor, 0);

  return PublicDesignV1Schema.parse({
    ...structuredClone(standardAiDesignFixture),
    bracelet: { ...standardAiDesignFixture.bracelet, totalBeadCount: beads.length },
    beads,
    accessories: [pendant],
    pricing: {
      ...standardAiDesignFixture.pricing,
      materialSubtotalMinor,
      accessorySubtotalMinor: pendant.unitPriceMinor,
      laborFeeMinor: 7000,
      designFeeMinor: 5000,
      packagingFeeMinor: 2500,
      platformFeeEstimateMinor: 1500,
      logisticsFeeEstimateMinor: 6000,
      totalPriceMinor: materialSubtotalMinor + pendant.unitPriceMinor + 22_000
    },
    production: {
      ...standardAiDesignFixture.production,
      componentSequence: beads.map((bead) => bead.componentId),
      anchoredComponents: [{ componentId: pendant.componentId, anchorComponentId: pendant.anchorComponentId, anchorSlot: pendant.anchorSlot }],
      billOfMaterials: [
        ...beads.map((bead) => ({ productId: bead.beadProductId, specification: `${bead.shape} ${bead.diameterMm}mm`, quantity: 1, sourceComponentIds: [bead.componentId] })),
        { productId: pendant.accessoryProductId, specification: `${pendant.material} pendant`, quantity: 1, sourceComponentIds: [pendant.componentId] }
      ]
    }
  });
}

function createVariant(variant: DesignVariant): PublicDesignV1 {
  const expandedFixture = createExpandedFixture();
  return PublicDesignV1Schema.parse({
    ...expandedFixture,
    designId: variant.designId,
    designName: variant.designName,
    story: {
      ...expandedFixture.story,
      styleTags: variant.styleTags,
      colorPalette: variant.palette,
      designStory: variant.story,
      recommendationReasons: [variant.reason]
    }
  });
}

export const mockDesignOptions = variants.map(createVariant);
