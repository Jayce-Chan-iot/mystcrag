import {
  BeadShapeSchema,
  VisualProfileSchema,
  type CatalogMaterialProduct as ContractCatalogMaterialProduct
} from "@mystcrag/design-contract";

/**
 * Structural row shape accepted by the mapper: satisfied by both the
 * database package's CatalogProduct rows and looser service-level catalog
 * types, so every entry point maps the catalog through one implementation.
 */
export type CatalogRowInput = {
  id: string;
  productType: "MATERIAL" | "ACCESSORY";
  sku: string;
  name: string;
  currency: "CNY" | "TWD";
  unitPriceMinor: number;
  active: boolean;
  crystalId?: string | null;
  crystalNameCn?: string | null;
  crystalNameEn?: string | null;
  mineralName?: string | null;
  colorTags?: readonly string[] | null;
  visualTags?: readonly string[] | null;
  styleTags?: readonly string[] | null;
  emotionTags?: readonly string[] | null;
  cultureTags?: readonly string[] | null;
  shape?: string | null;
  diameterMm?: number | null;
  lengthAlongStringMm?: number | null;
  visualProfile?: unknown;
  materialKey?: string | null;
  modelAssetKey: string | null;
  textureAssetKey: string | null;
  availableQuantity?: number;
};

/**
 * Maps catalog rows to the contract's CatalogMaterialProduct (the shape the
 * design engine consumes). Rows that are not active materials or that fail
 * contract validation (shape/visual profile) are skipped rather than mapped
 * partially — one shared implementation for the backend and the MCP server
 * so the two entry points see an identical catalog.
 */
export function toContractCatalogMaterials(
  rows: readonly CatalogRowInput[]
): ContractCatalogMaterialProduct[] {
  const products: ContractCatalogMaterialProduct[] = [];
  for (const row of rows) {
    if (
      row.productType !== "MATERIAL" ||
      !row.active ||
      !row.crystalId ||
      !row.materialKey ||
      !row.shape ||
      row.diameterMm === undefined ||
      row.diameterMm === null ||
      !row.modelAssetKey ||
      !row.textureAssetKey
    ) {
      continue;
    }
    const shape = BeadShapeSchema.safeParse(row.shape);
    if (!shape.success) continue;
    let visualProfile: ReturnType<typeof VisualProfileSchema.safeParse> | undefined;
    if (row.visualProfile !== undefined && row.visualProfile !== null) {
      const parsed = VisualProfileSchema.safeParse(row.visualProfile);
      if (!parsed.success) continue;
      visualProfile = parsed;
    }
    products.push({
      beadProductId: row.id,
      sku: row.sku,
      displayName: row.name,
      crystalId: row.crystalId,
      crystalNameCn: row.crystalNameCn ?? row.name,
      crystalNameEn: row.crystalNameEn ?? row.name,
      mineralName: row.mineralName ?? "Unknown",
      colorTags: [...(row.colorTags ?? [])],
      visualTags: [...(row.visualTags ?? [])],
      styleTags: [...(row.styleTags ?? [])],
      emotionTags: [...(row.emotionTags ?? [])],
      cultureTags: [...(row.cultureTags ?? [])],
      materialKey: row.materialKey,
      shape: shape.data,
      diameterMm: row.diameterMm,
      ...(row.lengthAlongStringMm === null || row.lengthAlongStringMm === undefined
        ? {}
        : { lengthAlongStringMm: row.lengthAlongStringMm }),
      ...(visualProfile === undefined ? {} : { visualProfile: visualProfile.data }),
      modelAssetKey: row.modelAssetKey,
      textureAssetKey: row.textureAssetKey,
      currency: row.currency,
      unitPriceMinor: row.unitPriceMinor,
      availableQuantity: row.availableQuantity ?? 0
    });
  }
  return products;
}
