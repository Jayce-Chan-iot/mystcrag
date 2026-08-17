import type { PrismaClient } from "../../generated/client/client.js";
import { bigintToMinor } from "../mappers/money.mapper.js";

export type SellableProduct = {
  id: string;
  productType: "MATERIAL" | "ACCESSORY";
  sku: string;
  name: string;
  currency: "CNY" | "TWD";
  unitPriceMinor: number;
  active: boolean;
};

export type InternalProductPricing = SellableProduct & { unitCostMinor: number };

export type CatalogMaterialProduct = SellableProduct & {
  productType: "MATERIAL";
  crystalId: string;
  crystalNameCn: string;
  crystalNameEn: string;
  colorTags: string[];
  shape: string;
  diameterMm: number;
  materialKey: string;
  modelAssetKey: string | null;
  textureAssetKey: string | null;
};

export type CatalogAccessoryProduct = SellableProduct & {
  productType: "ACCESSORY";
  accessoryType: string;
  material: string;
  finish: string;
  dimensions: unknown;
  modelAssetKey: string | null;
  textureAssetKey: string | null;
};

export type CatalogProduct = CatalogMaterialProduct | CatalogAccessoryProduct;

export class ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getProducts(productIds: readonly string[]): Promise<SellableProduct[]> {
    const [materials, accessories] = await Promise.all([
      this.prisma.materialProduct.findMany({ where: { id: { in: [...productIds] } } }),
      this.prisma.accessoryProduct.findMany({ where: { id: { in: [...productIds] } } })
    ]);
    return [
      ...materials.map((row) => ({
        id: row.id,
        productType: "MATERIAL" as const,
        sku: row.sku,
        name: row.name,
        currency: row.currency,
        unitPriceMinor: bigintToMinor(row.unitPriceMinor, "unitPriceMinor"),
        active: row.active
      })),
      ...accessories.map((row) => ({
        id: row.id,
        productType: "ACCESSORY" as const,
        sku: row.sku,
        name: `${row.material} ${row.accessoryType}`,
        currency: row.currency,
        unitPriceMinor: bigintToMinor(row.unitPriceMinor, "unitPriceMinor"),
        active: row.active
      }))
    ];
  }

  async getProductsForPricing(productIds: readonly string[]): Promise<InternalProductPricing[]> {
    const [materials, accessories] = await Promise.all([
      this.prisma.materialProduct.findMany({ where: { id: { in: [...productIds] } } }),
      this.prisma.accessoryProduct.findMany({ where: { id: { in: [...productIds] } } })
    ]);
    return [
      ...materials.map((row) => ({
        id: row.id,
        productType: "MATERIAL" as const,
        sku: row.sku,
        name: row.name,
        currency: row.currency,
        unitPriceMinor: bigintToMinor(row.unitPriceMinor, "unitPriceMinor"),
        unitCostMinor: bigintToMinor(row.unitCostMinor, "unitCostMinor"),
        active: row.active
      })),
      ...accessories.map((row) => ({
        id: row.id,
        productType: "ACCESSORY" as const,
        sku: row.sku,
        name: `${row.material} ${row.accessoryType}`,
        currency: row.currency,
        unitPriceMinor: bigintToMinor(row.unitPriceMinor, "unitPriceMinor"),
        unitCostMinor: bigintToMinor(row.unitCostMinor, "unitCostMinor"),
        active: row.active
      }))
    ];
  }

  async getCatalogProducts(productIds: readonly string[]): Promise<CatalogProduct[]> {
    const [materials, accessories] = await Promise.all([
      this.prisma.materialProduct.findMany({
        where: { id: { in: [...productIds] } },
        include: { crystal: true }
      }),
      this.prisma.accessoryProduct.findMany({ where: { id: { in: [...productIds] } } })
    ]);
    return [
      ...materials.map((row) => ({
        id: row.id,
        productType: "MATERIAL" as const,
        sku: row.sku,
        name: row.name,
        crystalId: row.crystalId,
        crystalNameCn: row.crystal.nameCn,
        crystalNameEn: row.crystal.nameEn,
        colorTags: [...row.crystal.colorTags],
        shape: row.shape,
        diameterMm: row.diameterMm,
        materialKey: row.materialKey,
        modelAssetKey: row.modelAssetKey,
        textureAssetKey: row.textureAssetKey,
        currency: row.currency,
        unitPriceMinor: bigintToMinor(row.unitPriceMinor, "unitPriceMinor"),
        active: row.active
      })),
      ...accessories.map((row) => ({
        id: row.id,
        productType: "ACCESSORY" as const,
        sku: row.sku,
        name: `${row.material} ${row.accessoryType}`,
        accessoryType: row.accessoryType,
        material: row.material,
        finish: row.finish,
        dimensions: structuredClone(row.dimensions),
        modelAssetKey: row.modelAssetKey,
        textureAssetKey: row.textureAssetKey,
        currency: row.currency,
        unitPriceMinor: bigintToMinor(row.unitPriceMinor, "unitPriceMinor"),
        active: row.active
      }))
    ];
  }

  async listActiveCatalogProducts(
    currency: "CNY" | "TWD",
    excludedProductIds: readonly string[] = []
  ): Promise<CatalogProduct[]> {
    const [materials, accessories] = await Promise.all([
      this.prisma.materialProduct.findMany({
        where: { currency, active: true, id: { notIn: [...excludedProductIds] } },
        orderBy: { id: "asc" }
      }),
      this.prisma.accessoryProduct.findMany({
        where: { currency, active: true, id: { notIn: [...excludedProductIds] } },
        orderBy: { id: "asc" }
      })
    ]);
    return this.getCatalogProducts([
      ...materials.map(({ id }) => id),
      ...accessories.map(({ id }) => id)
    ]);
  }
}
