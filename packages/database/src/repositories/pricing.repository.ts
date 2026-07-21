import { DesignV1Schema, type DesignV1 } from "@mystcrag/design-contract";

import type { Prisma, PrismaClient } from "../../generated/client/client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import { bigintToMinor } from "../mappers/money.mapper.js";

type QueryClient = PrismaClient | Prisma.TransactionClient;

export async function recalculateWithCatalog(
  client: QueryClient,
  input: unknown
): Promise<DesignV1> {
  const parsed = DesignV1Schema.safeParse(input);
  if (!parsed.success) {
    throw new PersistenceError("VALIDATION_ERROR", "Design snapshot is invalid", parsed.error);
  }
  const design = parsed.data;
  const rule = await client.pricingRule.findFirst({
    where: { currency: design.currency, active: true },
    orderBy: { createdAt: "desc" }
  });
  if (!rule) throw new PersistenceError("NOT_FOUND", "Active pricing rule not found");

  const materialIds = [...new Set(design.beads.map((bead) => bead.beadProductId))];
  const accessoryIds = [
    ...new Set(design.accessories.map((accessory) => accessory.accessoryProductId))
  ];
  const [materials, accessories] = await Promise.all([
    client.materialProduct.findMany({ where: { id: { in: materialIds }, active: true } }),
    client.accessoryProduct.findMany({ where: { id: { in: accessoryIds }, active: true } })
  ]);
  const materialPrices = new Map(
    materials.map((row) => [row.id, { currency: row.currency, price: row.unitPriceMinor }])
  );
  const accessoryPrices = new Map(
    accessories.map((row) => [row.id, { currency: row.currency, price: row.unitPriceMinor }])
  );
  const pricedBeads = design.beads.map((bead) => {
    const product = materialPrices.get(bead.beadProductId);
    if (!product || product.currency !== design.currency) {
      throw new PersistenceError("INVENTORY_CHANGED", `Unavailable product ${bead.beadProductId}`);
    }
    return { ...bead, unitPriceMinor: bigintToMinor(product.price, "unitPriceMinor") };
  });
  const pricedAccessories = design.accessories.map((accessory) => {
    const product = accessoryPrices.get(accessory.accessoryProductId);
    if (!product || product.currency !== design.currency) {
      throw new PersistenceError(
        "INVENTORY_CHANGED",
        `Unavailable product ${accessory.accessoryProductId}`
      );
    }
    return { ...accessory, unitPriceMinor: bigintToMinor(product.price, "unitPriceMinor") };
  });
  const materialSubtotalMinor = pricedBeads.reduce(
    (total, bead) => total + bead.unitPriceMinor,
    0
  );
  const accessorySubtotalMinor = pricedAccessories.reduce(
    (total, accessory) => total + accessory.unitPriceMinor,
    0
  );
  const pricing = {
    ...design.pricing,
    materialSubtotalMinor,
    accessorySubtotalMinor,
    pricingVersion: rule.version,
    priceCalculatedAt: new Date().toISOString(),
    totalPriceMinor:
      materialSubtotalMinor +
      accessorySubtotalMinor +
      design.pricing.laborFeeMinor +
      design.pricing.designFeeMinor +
      design.pricing.packagingFeeMinor +
      design.pricing.platformFeeEstimateMinor +
      design.pricing.logisticsFeeEstimateMinor -
      design.pricing.discountMinor +
      design.pricing.adjustments.reduce((sum, item) => sum + item.amountMinor, 0)
  };
  return DesignV1Schema.parse({
    ...design,
    beads: pricedBeads,
    accessories: pricedAccessories,
    pricing,
    provenance: { ...design.provenance, pricingRuleVersion: rule.version }
  });
}

export class PricingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  recalculateDesignPrice(input: unknown): Promise<DesignV1> {
    return recalculateWithCatalog(this.prisma, input);
  }
}
