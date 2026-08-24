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
  mineralName: string;
  colorTags: string[];
  visualTags: string[];
  styleTags: string[];
  emotionTags: string[];
  cultureTags: string[];
  shape: string;
  diameterMm: number;
  lengthAlongStringMm: number | null;
  holeDiameterMm: number | null;
  grade: string | null;
  visualProfile: unknown;
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
  lengthAlongStringMm: number | null;
  visualProfile: unknown;
  modelAssetKey: string | null;
  textureAssetKey: string | null;
};

export type CatalogProduct = CatalogMaterialProduct | CatalogAccessoryProduct;

export type AvailableCatalogMaterialProduct = CatalogMaterialProduct & {
  availableQuantity: number;
};

export type AvailableCatalogAccessoryProduct = CatalogAccessoryProduct & {
  availableQuantity: number;
};

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
        mineralName: row.crystal.mineralName,
        colorTags: [...row.crystal.colorTags],
        visualTags: [...row.crystal.visualTags],
        styleTags: [...row.crystal.styleTags],
        emotionTags: [...row.crystal.emotionTags],
        cultureTags: [...row.crystal.cultureTags],
        shape: row.shape,
        diameterMm: row.diameterMm,
        lengthAlongStringMm: row.lengthAlongStringMm,
        holeDiameterMm: row.holeDiameterMm,
        grade: row.grade,
        visualProfile: row.visualProfile === null ? null : structuredClone(row.visualProfile),
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
        lengthAlongStringMm: row.lengthAlongStringMm,
        visualProfile: row.visualProfile === null ? null : structuredClone(row.visualProfile),
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

  async listAvailableCatalogMaterialProducts(
    currency: "CNY" | "TWD"
  ): Promise<AvailableCatalogMaterialProduct[]> {
    const materials = await this.prisma.materialProduct.findMany({
      where: { currency, active: true },
      orderBy: { id: "asc" }
    });
    const productIds = materials.map(({ id }) => id);
    const remaining = await this.remainingQuantityByProductId(productIds, "MATERIAL");
    const catalog = await this.getCatalogProducts(productIds);
    return catalog.flatMap((product) => {
      if (product.productType !== "MATERIAL") return [];
      return [{ ...product, availableQuantity: remaining.get(product.id) ?? 0 }];
    });
  }

  async listAvailableCatalogAccessoryProducts(
    currency: "CNY" | "TWD"
  ): Promise<AvailableCatalogAccessoryProduct[]> {
    const accessories = await this.prisma.accessoryProduct.findMany({
      where: { currency, active: true },
      orderBy: { id: "asc" }
    });
    const productIds = accessories.map(({ id }) => id);
    const remaining = await this.remainingQuantityByProductId(productIds, "ACCESSORY");
    const catalog = await this.getCatalogProducts(productIds);
    return catalog.flatMap((product) => {
      if (product.productType !== "ACCESSORY") return [];
      return [{ ...product, availableQuantity: remaining.get(product.id) ?? 0 }];
    });
  }

  private async remainingQuantityByProductId(
    productIds: readonly string[],
    productType: "MATERIAL" | "ACCESSORY"
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const snapshots = await this.prisma.inventorySnapshot.findMany({
      where: { productType, productId: { in: [...productIds] } },
      orderBy: { capturedAt: "desc" }
    });
    const remainingByProductId = new Map<string, number>();
    for (const snapshot of snapshots) {
      if (remainingByProductId.has(snapshot.productId)) continue;
      remainingByProductId.set(
        snapshot.productId,
        Math.max(0, snapshot.availableQuantity - snapshot.reservedQuantity)
      );
    }
    return remainingByProductId;
  }
}
