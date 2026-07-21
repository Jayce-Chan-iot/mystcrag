import {
  PriceDesignRequestSchema,
  type PriceDesignRequest
} from "@mystcrag/design-contract";

export type ServerPricingIntent = {
  readonly requestId: string;
  readonly designId: string;
  readonly revision: number;
  readonly currency: PriceDesignRequest["currency"];
  readonly beadProductIds: readonly string[];
  readonly accessoryProductIds: readonly string[];
};

export function mapPriceRequestToServerIntent(input: unknown): ServerPricingIntent {
  const request = PriceDesignRequestSchema.parse(input);
  return {
    requestId: request.requestId,
    designId: request.design.designId,
    revision: request.design.revision,
    currency: request.currency,
    beadProductIds: request.design.beads.map((bead) => bead.beadProductId),
    accessoryProductIds: request.design.accessories.map(
      (accessory) => accessory.accessoryProductId
    )
  };
}
