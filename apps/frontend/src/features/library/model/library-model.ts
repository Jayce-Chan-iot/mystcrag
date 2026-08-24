import type { CatalogAccessoryProduct, CatalogMaterialProduct } from "@mystcrag/design-contract";

export type LibraryProductType = "CRYSTAL" | "NATURAL_STONE" | "ACCESSORY";

export type LibraryStockFilter = "IN_STOCK" | "RESTOCK" | "ALL";

export type LibrarySortKey = "COMPREHENSIVE" | "PRICE_ASC" | "PRICE_DESC" | "NAME";

export type CrystalGroup = {
  crystalId: string;
  nameCn: string;
  nameEn: string;
  mineralName: string;
  variants: CatalogMaterialProduct[];
};

export const COLOR_TAG_LABELS: Record<string, string> = {
  black: "黑色",
  blue: "蓝色",
  brown: "棕色",
  clear: "透明",
  gold: "金色",
  gray: "灰色",
  green: "绿色",
  orange: "橙色",
  pink: "粉色",
  purple: "紫色",
  red: "红色",
  white: "白色",
  wine: "酒红色",
  yellow: "黄色"
};

export const COLOR_SWATCHES: Record<string, string> = {
  clear: "#dfe8e6",
  white: "#f4f1ea",
  pink: "#e5b6c5",
  purple: "#a88fc9",
  blue: "#a7c9de",
  green: "#a5c7aa",
  gray: "#a8a49f",
  brown: "#a1795a",
  black: "#3c3a3e",
  gold: "#d3b16d",
  yellow: "#e2cd82",
  red: "#c46a5c",
  wine: "#8e3a4a",
  orange: "#dca273"
};

export const VISUAL_TAG_LABELS: Record<string, string> = {
  cool: "冷色调",
  deep: "深色系",
  fresh: "清新感",
  iridescent: "彩虹光",
  natural: "天然纹理",
  neutral: "中性色",
  soft: "柔和感",
  translucent: "半通透",
  warm: "暖色调"
};

export const PRODUCT_TYPE_LABELS: Record<LibraryProductType, string> = {
  CRYSTAL: "水晶",
  NATURAL_STONE: "天然石",
  ACCESSORY: "配饰"
};

export function groupMaterialsByCrystal(materials: readonly CatalogMaterialProduct[]): CrystalGroup[] {
  const groups = new Map<string, CrystalGroup>();
  for (const material of materials) {
    const group = groups.get(material.crystalId);
    if (group) group.variants.push(material);
    else groups.set(material.crystalId, {
      crystalId: material.crystalId,
      nameCn: material.crystalNameCn,
      nameEn: material.crystalNameEn,
      mineralName: material.mineralName,
      variants: [material]
    });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    variants: [...group.variants].sort((left, right) => left.diameterMm - right.diameterMm)
  }));
}

export function crystalCategoryOf(group: CrystalGroup): Exclude<LibraryProductType, "ACCESSORY"> {
  return group.mineralName === "Quartz" ? "CRYSTAL" : "NATURAL_STONE";
}

export type LibraryFilter = {
  productType: LibraryProductType;
  crystalId: string;
  diameterMm: number | "ALL";
  colorTag: string;
  visualTag: string;
  stock: LibraryStockFilter;
  query: string;
};

export const DEFAULT_LIBRARY_FILTER: LibraryFilter = {
  productType: "CRYSTAL",
  crystalId: "ALL",
  diameterMm: "ALL",
  colorTag: "ALL",
  visualTag: "ALL",
  stock: "IN_STOCK",
  query: ""
};

function matchesStock(material: CatalogMaterialProduct, stock: LibraryStockFilter): boolean {
  if (stock === "ALL") return true;
  return stock === "IN_STOCK" ? material.availableQuantity > 0 : material.availableQuantity === 0;
}

export function filterCrystalGroups(
  groups: readonly CrystalGroup[],
  filter: LibraryFilter
): CrystalGroup[] {
  const normalizedQuery = filter.query.trim().toLocaleLowerCase("zh-CN");
  const matching = groups.filter((group) => {
    if (filter.productType === "ACCESSORY") return false;
    if (crystalCategoryOf(group) !== filter.productType) return false;
    if (filter.crystalId !== "ALL" && group.crystalId !== filter.crystalId) return false;
    const nameMatches = normalizedQuery.length === 0 || [
      group.nameCn,
      group.nameEn,
      group.mineralName,
      group.crystalId
    ].some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
    if (!nameMatches) return false;
    const variants = group.variants.filter((variant) => {
      if (filter.diameterMm !== "ALL" && variant.diameterMm !== filter.diameterMm) return false;
      if (filter.colorTag !== "ALL" && !variant.colorTags.includes(filter.colorTag)) return false;
      if (filter.visualTag !== "ALL" && !variant.visualTags.includes(filter.visualTag)) return false;
      return matchesStock(variant, filter.stock);
    });
    return variants.length > 0;
  });
  return matching.map((group) => ({
    ...group,
    variants: group.variants.filter((variant) => {
      if (filter.diameterMm !== "ALL" && variant.diameterMm !== filter.diameterMm) return false;
      if (filter.colorTag !== "ALL" && !variant.colorTags.includes(filter.colorTag)) return false;
      if (filter.visualTag !== "ALL" && !variant.visualTags.includes(filter.visualTag)) return false;
      return matchesStock(variant, filter.stock);
    })
  }));
}

export function sortCrystalGroups(groups: readonly CrystalGroup[], sort: LibrarySortKey): CrystalGroup[] {
  const sorted = [...groups];
  if (sort === "PRICE_ASC" || sort === "PRICE_DESC") {
    sorted.sort((left, right) => {
      const leftPrice = Math.min(...left.variants.map((variant) => variant.unitPriceMinor));
      const rightPrice = Math.min(...right.variants.map((variant) => variant.unitPriceMinor));
      return sort === "PRICE_ASC" ? leftPrice - rightPrice : rightPrice - leftPrice;
    });
  } else if (sort === "NAME") {
    sorted.sort((left, right) => left.nameCn.localeCompare(right.nameCn, "zh-CN"));
  }
  return sorted;
}

export function filterAccessories(
  accessories: readonly CatalogAccessoryProduct[],
  filter: LibraryFilter
): CatalogAccessoryProduct[] {
  if (filter.productType !== "ACCESSORY") return [];
  const normalizedQuery = filter.query.trim().toLocaleLowerCase("zh-CN");
  return accessories.filter((accessory) => {
    const nameMatches = normalizedQuery.length === 0 || [
      accessory.displayName,
      accessory.material,
      accessory.finish
    ].some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
    if (!nameMatches) return false;
    if (filter.stock === "IN_STOCK" && accessory.availableQuantity === 0) return false;
    if (filter.stock === "RESTOCK" && accessory.availableQuantity !== 0) return false;
    return true;
  });
}

export function sortAccessories(
  accessories: readonly CatalogAccessoryProduct[],
  sort: LibrarySortKey
): CatalogAccessoryProduct[] {
  const sorted = [...accessories];
  if (sort === "PRICE_ASC") sorted.sort((left, right) => left.unitPriceMinor - right.unitPriceMinor);
  else if (sort === "PRICE_DESC") sorted.sort((left, right) => right.unitPriceMinor - left.unitPriceMinor);
  return sorted;
}

export function accessoryDisplayNames(accessory: CatalogAccessoryProduct): { nameCn: string; nameEn: string } {
  const typeLabels: Record<string, string> = {
    SPACER: "隔珠",
    PENDANT: "吊坠",
    METAL_PART: "金属件",
    CONNECTOR: "连接件"
  };
  const materialLabels: Record<string, string> = { STERLING_SILVER: "925银", GOLD_VERMEIL: "镀金", BRASS: "黄铜" };
  const nameCn = `${materialLabels[accessory.material] ?? accessory.material}${typeLabels[accessory.accessoryType] ?? accessory.accessoryType}`;
  const typeEn: Record<string, string> = { SPACER: "Spacer", PENDANT: "Pendant", METAL_PART: "Metal Part", CONNECTOR: "Connector" };
  return {
    nameCn,
    nameEn: `${accessory.material === "STERLING_SILVER" ? "925 Silver" : accessory.material} ${typeEn[accessory.accessoryType] ?? accessory.accessoryType}`
  };
}
