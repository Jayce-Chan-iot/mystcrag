import type { CatalogMaterialProduct } from "@mystcrag/design-contract";

/**
 * Deterministic golden catalog for the design-quality evaluation (§17.5).
 * Canonical taxonomy refs only; materials are limited to those without a
 * core-corpus HARD prohibition (pyrite/hematite/calcite/fluorite are
 * excluded so the baseline corpus can stay hard-violation free).
 */
export const GOLDEN_CATALOG_VERSION = "golden-catalog-v1";

const VISUAL_BY_PRODUCT: Record<string, readonly string[]> = {
  "product-amethyst-8": ["transparency:translucent", "luster:bright"],
  "product-amethyst-10": ["transparency:translucent", "luster:bright"],
  "product-aquamarine-8": ["transparency:transparent", "luster:bright"],
  "product-moonstone-6": ["transparency:translucent", "luster:soft", "texture:iridescent-sheen"],
  "product-labradorite-8": ["transparency:opaque", "luster:bright", "texture:iridescent-sheen"],
  "product-citrine-10": ["transparency:transparent", "luster:bright"],
  "product-rose-quartz-8": ["transparency:translucent", "luster:soft"],
  "product-rose-quartz-6": ["transparency:translucent", "luster:soft"],
  "product-obsidian-8": ["transparency:opaque", "luster:bright"],
  "product-obsidian-10": ["transparency:opaque", "luster:bright"],
  "product-garnet-8": ["transparency:translucent", "luster:bright"],
  "product-lapis-8": ["transparency:opaque", "luster:soft", "texture:speckled"],
  "product-tourmaline-pink-8": ["transparency:translucent", "luster:bright"],
  "product-tourmaline-green-8": ["transparency:translucent", "luster:bright"],
  "product-nephrite-10": ["transparency:opaque", "luster:soft", "texture:veined"],
  "product-agate-brown-8": ["transparency:opaque", "luster:soft", "texture:banded"],
  "product-rhodonite-8": ["transparency:opaque", "luster:bright", "texture:veined"],
  "product-smoky-quartz-8": ["transparency:translucent", "luster:bright"],
  "product-rutilated-quartz-10": ["transparency:transparent", "luster:bright", "texture:included"],
  "product-silver-spacer-4": ["transparency:opaque", "luster:bright", "texture:smooth"],
  "product-gold-spacer-4": ["transparency:opaque", "luster:bright", "texture:smooth"]
};

type GoldenProductInput = {
  beadProductId: string;
  sku: string;
  displayName: string;
  crystalId: string;
  crystalNameCn: string;
  crystalNameEn: string;
  colorTags: readonly string[];
  styleTags: readonly string[];
  emotionTags: readonly string[];
  cultureTags?: readonly string[];
  materialKey: string;
  shape: CatalogMaterialProduct["shape"];
  diameterMm: number;
  unitPriceMinor: number;
};

function goldenProduct(input: GoldenProductInput): CatalogMaterialProduct {
  return {
    beadProductId: input.beadProductId,
    sku: input.sku,
    displayName: input.displayName,
    crystalId: input.crystalId,
    crystalNameCn: input.crystalNameCn,
    crystalNameEn: input.crystalNameEn,
    colorTags: [...input.colorTags],
    visualTags: [...(VISUAL_BY_PRODUCT[input.beadProductId] ?? [])],
    styleTags: [...input.styleTags],
    emotionTags: [...input.emotionTags],
    cultureTags: [...(input.cultureTags ?? [])],
    materialKey: input.materialKey,
    shape: input.shape,
    diameterMm: input.diameterMm,
    modelAssetKey: `sphere-${input.shape.toLowerCase()}-${input.diameterMm}mm-v1`,
    textureAssetKey: "texture-v1",
    currency: "CNY",
    unitPriceMinor: input.unitPriceMinor
  };
}

export const GOLDEN_CATALOG: readonly CatalogMaterialProduct[] = [
  goldenProduct({
    beadProductId: "product-amethyst-8",
    sku: "sku-amethyst-8",
    displayName: "紫水晶圆珠 8mm",
    crystalId: "crystal-amethyst",
    crystalNameCn: "紫水晶",
    crystalNameEn: "Amethyst",
    colorTags: ["color:purple"],
    styleTags: ["style:minimal"],
    emotionTags: ["emotion:calm"],
    materialKey: "material:quartz",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 600
  }),
  goldenProduct({
    beadProductId: "product-amethyst-10",
    sku: "sku-amethyst-10",
    displayName: "紫水晶圆珠 10mm",
    crystalId: "crystal-amethyst",
    crystalNameCn: "紫水晶",
    crystalNameEn: "Amethyst",
    colorTags: ["color:purple"],
    styleTags: ["style:modern"],
    emotionTags: ["emotion:confidence"],
    materialKey: "material:quartz",
    shape: "ROUND",
    diameterMm: 10,
    unitPriceMinor: 900
  }),
  goldenProduct({
    beadProductId: "product-aquamarine-8",
    sku: "sku-aquamarine-8",
    displayName: "海蓝宝圆珠 8mm",
    crystalId: "crystal-aquamarine",
    crystalNameCn: "海蓝宝",
    crystalNameEn: "Aquamarine",
    colorTags: ["color:blue"],
    styleTags: ["style:minimal"],
    emotionTags: ["emotion:calm"],
    materialKey: "material:beryl",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 700
  }),
  goldenProduct({
    beadProductId: "product-moonstone-6",
    sku: "sku-moonstone-6",
    displayName: "月光石圆珠 6mm",
    crystalId: "crystal-moonstone",
    crystalNameCn: "月光石",
    crystalNameEn: "Moonstone",
    colorTags: ["color:white"],
    styleTags: ["style:ethereal"],
    emotionTags: ["emotion:hope"],
    materialKey: "material:feldspar",
    shape: "ROUND",
    diameterMm: 6,
    unitPriceMinor: 450
  }),
  goldenProduct({
    beadProductId: "product-labradorite-8",
    sku: "sku-labradorite-8",
    displayName: "拉长石圆珠 8mm",
    crystalId: "crystal-labradorite",
    crystalNameCn: "拉长石",
    crystalNameEn: "Labradorite",
    colorTags: ["color:gray"],
    styleTags: ["style:modern"],
    emotionTags: ["emotion:focus"],
    materialKey: "material:feldspar",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 650
  }),
  goldenProduct({
    beadProductId: "product-citrine-10",
    sku: "sku-citrine-10",
    displayName: "黄水晶圆珠 10mm",
    crystalId: "crystal-citrine",
    crystalNameCn: "黄水晶",
    crystalNameEn: "Citrine",
    colorTags: ["color:yellow"],
    styleTags: ["style:natural"],
    emotionTags: ["emotion:joy"],
    materialKey: "material:quartz",
    shape: "ROUND",
    diameterMm: 10,
    unitPriceMinor: 800
  }),
  goldenProduct({
    beadProductId: "product-rose-quartz-8",
    sku: "sku-rose-quartz-8",
    displayName: "粉晶圆珠 8mm",
    crystalId: "crystal-rose-quartz",
    crystalNameCn: "粉晶",
    crystalNameEn: "Rose quartz",
    colorTags: ["color:pink"],
    styleTags: ["style:romantic"],
    emotionTags: ["emotion:love"],
    materialKey: "material:quartz",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 500
  }),
  goldenProduct({
    beadProductId: "product-rose-quartz-6",
    sku: "sku-rose-quartz-6",
    displayName: "粉晶圆珠 6mm",
    crystalId: "crystal-rose-quartz",
    crystalNameCn: "粉晶",
    crystalNameEn: "Rose quartz",
    colorTags: ["color:pink"],
    styleTags: ["style:delicate"],
    emotionTags: ["emotion:love"],
    materialKey: "material:quartz",
    shape: "ROUND",
    diameterMm: 6,
    unitPriceMinor: 380
  }),
  goldenProduct({
    beadProductId: "product-obsidian-8",
    sku: "sku-obsidian-8",
    displayName: "黑曜石圆珠 8mm",
    crystalId: "crystal-obsidian",
    crystalNameCn: "黑曜石",
    crystalNameEn: "Obsidian",
    colorTags: ["color:black"],
    styleTags: ["style:modern"],
    emotionTags: ["emotion:grounding"],
    materialKey: "material:obsidian",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 300
  }),
  goldenProduct({
    beadProductId: "product-obsidian-10",
    sku: "sku-obsidian-10",
    displayName: "黑曜石圆珠 10mm",
    crystalId: "crystal-obsidian",
    crystalNameCn: "黑曜石",
    crystalNameEn: "Obsidian",
    colorTags: ["color:black"],
    styleTags: ["style:vintage"],
    emotionTags: ["emotion:protection"],
    materialKey: "material:obsidian",
    shape: "ROUND",
    diameterMm: 10,
    unitPriceMinor: 450
  }),
  goldenProduct({
    beadProductId: "product-garnet-8",
    sku: "sku-garnet-8",
    displayName: "石榴石圆珠 8mm",
    crystalId: "crystal-garnet",
    crystalNameCn: "石榴石",
    crystalNameEn: "Garnet",
    colorTags: ["color:red"],
    styleTags: ["style:vintage"],
    emotionTags: ["emotion:vitality"],
    materialKey: "material:garnet",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 550
  }),
  goldenProduct({
    beadProductId: "product-lapis-8",
    sku: "sku-lapis-8",
    displayName: "青金石圆珠 8mm",
    crystalId: "crystal-lapis-lazuli",
    crystalNameCn: "青金石",
    crystalNameEn: "Lapis lazuli",
    colorTags: ["color:blue"],
    styleTags: ["style:eastern-contemporary"],
    emotionTags: ["emotion:confidence"],
    materialKey: "material:lapis-lazuli",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 850
  }),
  goldenProduct({
    beadProductId: "product-tourmaline-pink-8",
    sku: "sku-tourmaline-pink-8",
    displayName: "粉碧玺圆珠 8mm",
    crystalId: "crystal-tourmaline",
    crystalNameCn: "碧玺",
    crystalNameEn: "Tourmaline",
    colorTags: ["color:pink"],
    styleTags: ["style:natural"],
    emotionTags: ["emotion:joy"],
    materialKey: "material:tourmaline",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 750
  }),
  goldenProduct({
    beadProductId: "product-tourmaline-green-8",
    sku: "sku-tourmaline-green-8",
    displayName: "绿碧玺圆珠 8mm",
    crystalId: "crystal-tourmaline",
    crystalNameCn: "碧玺",
    crystalNameEn: "Tourmaline",
    colorTags: ["color:green"],
    styleTags: ["style:natural"],
    emotionTags: ["emotion:vitality"],
    materialKey: "material:tourmaline",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 750
  }),
  goldenProduct({
    beadProductId: "product-nephrite-10",
    sku: "sku-nephrite-10",
    displayName: "和田玉圆珠 10mm",
    crystalId: "crystal-nephrite",
    crystalNameCn: "和田玉",
    crystalNameEn: "Nephrite",
    colorTags: ["color:white"],
    styleTags: ["style:eastern-contemporary"],
    emotionTags: ["emotion:grounding"],
    materialKey: "material:nephrite",
    shape: "ROUND",
    diameterMm: 10,
    unitPriceMinor: 1200
  }),
  goldenProduct({
    beadProductId: "product-agate-brown-8",
    sku: "sku-agate-brown-8",
    displayName: "棕玛瑙圆珠 8mm",
    crystalId: "crystal-agate",
    crystalNameCn: "玛瑙",
    crystalNameEn: "Agate",
    colorTags: ["color:brown"],
    styleTags: ["style:vintage"],
    emotionTags: ["emotion:grounding"],
    materialKey: "material:agate",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 350
  }),
  goldenProduct({
    beadProductId: "product-rhodonite-8",
    sku: "sku-rhodonite-8",
    displayName: "蔷薇辉石圆珠 8mm",
    crystalId: "crystal-rhodonite",
    crystalNameCn: "蔷薇辉石",
    crystalNameEn: "Rhodonite",
    colorTags: ["color:pink"],
    styleTags: ["style:natural"],
    emotionTags: ["emotion:love"],
    materialKey: "material:rhodonite",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 480
  }),
  goldenProduct({
    beadProductId: "product-smoky-quartz-8",
    sku: "sku-smoky-quartz-8",
    displayName: "烟晶圆珠 8mm",
    crystalId: "crystal-smoky-quartz",
    crystalNameCn: "烟晶",
    crystalNameEn: "Smoky quartz",
    colorTags: ["color:gray"],
    styleTags: ["style:modern"],
    emotionTags: ["emotion:grounding"],
    materialKey: "material:quartz",
    shape: "ROUND",
    diameterMm: 8,
    unitPriceMinor: 520
  }),
  goldenProduct({
    beadProductId: "product-rutilated-quartz-10",
    sku: "sku-rutilated-quartz-10",
    displayName: "发晶圆珠 10mm",
    crystalId: "crystal-rutilated-quartz",
    crystalNameCn: "发晶",
    crystalNameEn: "Rutilated quartz",
    colorTags: ["color:yellow"],
    styleTags: ["style:vintage"],
    emotionTags: ["emotion:confidence"],
    materialKey: "material:quartz",
    shape: "ROUND",
    diameterMm: 10,
    unitPriceMinor: 1100
  }),
  goldenProduct({
    beadProductId: "product-silver-spacer-4",
    sku: "sku-silver-spacer-4",
    displayName: "纯银隔珠 4mm",
    crystalId: "crystal-sterling-silver",
    crystalNameCn: "纯银",
    crystalNameEn: "Sterling silver",
    colorTags: ["color:white"],
    styleTags: ["style:minimal"],
    emotionTags: ["emotion:calm"],
    materialKey: "material:sterling-silver",
    shape: "ROUND",
    diameterMm: 4,
    unitPriceMinor: 80
  }),
  goldenProduct({
    beadProductId: "product-gold-spacer-4",
    sku: "sku-gold-spacer-4",
    displayName: "黄金隔珠 4mm",
    crystalId: "crystal-gold",
    crystalNameCn: "黄金",
    crystalNameEn: "Gold",
    colorTags: ["color:yellow"],
    styleTags: ["style:minimal"],
    emotionTags: ["emotion:confidence"],
    materialKey: "material:gold",
    shape: "ROUND",
    diameterMm: 4,
    unitPriceMinor: 260
  })
];
