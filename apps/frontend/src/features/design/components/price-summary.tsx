import type { PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";

import { formatMinorAmount } from "../model/format-minor-amount";

export function PriceSummary({ design }: { design: PublicDesignV1 }) {
  return (
    <section aria-labelledby="price-summary-heading">
      <h3 id="price-summary-heading">Price</h3>
      <output>
        {formatMinorAmount({
          amountMinor: design.pricing.totalPriceMinor,
          currency: design.currency,
          locale: design.locale
        })}
      </output>
      <small>Price version: {design.pricing.pricingVersion}</small>
    </section>
  );
}
