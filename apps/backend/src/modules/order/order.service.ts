import type { OrderRepository, PersistedOrder } from "@mystcrag/database";

export class OrderService {
  constructor(private readonly orders: OrderRepository) {}

  createOrderFromDesign(
    actorId: string,
    designId: string,
    revisionNumber: number,
    expectedTotalPriceMinor: number,
    expectedPricingVersion: string
  ): Promise<PersistedOrder> {
    return this.orders.createOrderFromDesign(
      actorId,
      designId,
      revisionNumber,
      expectedTotalPriceMinor,
      expectedPricingVersion
    );
  }

  getOrder(actorId: string, orderId: string): Promise<PersistedOrder> {
    return this.orders.getOrder(actorId, orderId);
  }
}
