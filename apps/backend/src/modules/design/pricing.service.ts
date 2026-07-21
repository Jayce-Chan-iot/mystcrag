import type { PricingRepository } from "@mystcrag/database";
import type { DesignV1 } from "@mystcrag/design-contract";

export class PricingService {
  constructor(private readonly pricing: PricingRepository) {}

  recalculateDesignPrice(snapshot: DesignV1): Promise<DesignV1> {
    return this.pricing.recalculateDesignPrice(snapshot);
  }
}
