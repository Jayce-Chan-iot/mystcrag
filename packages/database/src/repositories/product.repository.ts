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
}
