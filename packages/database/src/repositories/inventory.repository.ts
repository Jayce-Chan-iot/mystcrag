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
}
