import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError } from "../errors/persistence-errors.js";

export class InventoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async validateAvailability(requirements: ReadonlyMap<string, number>): Promise<void> {
    for (const [productId, quantity] of requirements) {
      const latest = await this.prisma.inventorySnapshot.findFirst({
        where: { productId },
        orderBy: { capturedAt: "desc" }
      });
      if (!latest || latest.availableQuantity - latest.reservedQuantity < quantity) {
        throw new PersistenceError("INVENTORY_CHANGED", `Inventory changed for ${productId}`);
      }
    }
  }

  /** Latest available (minus reserved) quantity per product; missing rows mean 0. */
  async getAvailableQuantities(
    productIds: readonly string[]
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.inventorySnapshot.findMany({
      where: { productId: { in: [...productIds] } },
      orderBy: { capturedAt: "desc" }
    });
    const available = new Map<string, number>();
    for (const row of rows) {
      if (!available.has(row.productId)) {
        available.set(row.productId, Math.max(0, row.availableQuantity - row.reservedQuantity));
      }
    }
    return available;
  }
}
