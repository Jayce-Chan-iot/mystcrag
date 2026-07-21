import type { InventoryRepository } from "@mystcrag/database";

export class InventoryService {
  constructor(private readonly inventory: InventoryRepository) {}

  validateAvailability(requirements: ReadonlyMap<string, number>): Promise<void> {
    return this.inventory.validateAvailability(requirements);
  }
}
