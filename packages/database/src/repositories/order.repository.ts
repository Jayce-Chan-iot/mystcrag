import type { DesignV1, PricingV1, ProductionV1 } from "@mystcrag/design-contract";

import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import { bigintToMinor, minorToBigInt } from "../mappers/money.mapper.js";
import {
  parseDesignSnapshot,
  parsePricingSnapshot,
  parseProductionSnapshot,
  toPrismaJson
} from "../mappers/snapshot.mapper.js";
import { recalculateWithCatalog } from "./pricing.repository.js";

export type PersistedOrder = {
  id: string;
  userId: string;
  status: "PENDING" | "CONFIRMED" | "IN_PRODUCTION" | "SHIPPED" | "COMPLETED" | "CANCELLED";
  currency: "CNY" | "TWD";
  totalAmountMinor: number;
  designRevisionId: string;
  createdAt: Date;
  designSnapshot: DesignV1;
  pricingSnapshot: PricingV1;
  productionSnapshot: ProductionV1;
  pricingRuleVersion: string;
};

function quantitiesByProduct(design: DesignV1): Map<string, number> {
  const requirements = new Map<string, number>();
  for (const item of design.production.billOfMaterials) {
    requirements.set(item.productId, (requirements.get(item.productId) ?? 0) + item.quantity);
  }
  return requirements;
}

export class OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createOrderFromDesign(
    actorId: string,
    designId: string,
    revisionNumber: number,
    expectedTotalPriceMinor: number,
    expectedPricingVersion: string
  ): Promise<PersistedOrder> {
    const idempotencyKey = `${actorId}:${designId}:${revisionNumber}`;
    return this.prisma.$transaction(async (tx) => {
      const revision = await tx.designRevision.findUnique({
        where: { designId_revisionNumber: { designId, revisionNumber } },
        include: { design: true }
      });
      if (!revision || revision.design.ownerId !== actorId || revision.design.deletedAt) {
        throw new PersistenceError("NOT_FOUND", "Design revision not found");
      }
      const existingOrder = await tx.order.findFirst({
        where: {
          userId: actorId,
          designRevisionId: revision.id
        },
        orderBy: { createdAt: "asc" },
        include: { designSnapshot: true }
      });
      if (existingOrder) return this.mapOrder(existingOrder);
      if (revision.design.currentRevision !== revisionNumber) {
        throw new PersistenceError("CONFLICT", "Design revision is no longer current");
      }
      const design = parseDesignSnapshot(revision.snapshot);
      if (
        design.compliance.complianceStatus === "REJECTED" ||
        (design.compliance.complianceStatus === "FLAGGED" &&
          design.compliance.reviewRequired)
      ) {
        throw new PersistenceError("COMPLIANCE_BLOCKED", "Design is not cleared for ordering");
      }
      const pricedDesign = await recalculateWithCatalog(tx, design);
      if (
        pricedDesign.pricing.pricingVersion !== expectedPricingVersion ||
        pricedDesign.pricing.totalPriceMinor !== expectedTotalPriceMinor
      ) {
        throw new PersistenceError("PRICE_CHANGED", "Server price differs from the expected price");
      }
      for (const [productId, quantity] of quantitiesByProduct(pricedDesign)) {
        const inventory = await tx.inventorySnapshot.findFirst({
          where: { productId },
          orderBy: { capturedAt: "desc" }
        });
        if (!inventory || inventory.availableQuantity - inventory.reservedQuantity < quantity) {
          throw new PersistenceError("INVENTORY_CHANGED", `Inventory changed for ${productId}`);
        }
      }
      const row = await tx.order.upsert({
        where: { idempotencyKey },
        create: {
          idempotencyKey,
          userId: actorId,
          currency: pricedDesign.currency,
          totalAmountMinor: minorToBigInt(
            pricedDesign.pricing.totalPriceMinor,
            "totalAmountMinor"
          ),
          designRevisionId: revision.id,
          designSnapshot: {
            create: {
              schemaVersion: pricedDesign.schemaVersion,
              designSnapshot: toPrismaJson(pricedDesign),
              pricingSnapshot: toPrismaJson(pricedDesign.pricing),
              productionSnapshot: toPrismaJson(pricedDesign.production),
              currency: pricedDesign.currency,
              pricingRuleVersion: pricedDesign.pricing.pricingVersion
            }
          }
        },
        update: {},
        include: { designSnapshot: true }
      });
      return this.mapOrder(row);
    }).catch(async (error: unknown) => {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
      if (code === "P2002") {
        const existingOrder = await this.prisma.order.findUnique({
          where: { idempotencyKey },
          include: { designSnapshot: true }
        });
        if (existingOrder) return this.mapOrder(existingOrder);
      }
      return rethrowPersistenceError(error);
    });
  }

  async getOrder(actorId: string, orderId: string): Promise<PersistedOrder> {
    const row = await this.prisma.order.findFirst({
      where: { id: orderId, userId: actorId },
      include: { designSnapshot: true }
    });
    if (!row) throw new PersistenceError("NOT_FOUND", "Order not found");
    return this.mapOrder(row);
  }

  private mapOrder(row: {
    id: string;
    userId: string;
    status: PersistedOrder["status"];
    currency: PersistedOrder["currency"];
    totalAmountMinor: bigint;
    designRevisionId: string;
    createdAt: Date;
    designSnapshot: null | {
      designSnapshot: unknown;
      pricingSnapshot: unknown;
      productionSnapshot: unknown;
      pricingRuleVersion: string;
    };
  }): PersistedOrder {
    if (!row.designSnapshot) {
      throw new PersistenceError("DATA_INTEGRITY_ERROR", "Order snapshot is missing");
    }
    const designSnapshot = parseDesignSnapshot(row.designSnapshot.designSnapshot);
    const pricingSnapshot = parsePricingSnapshot(row.designSnapshot.pricingSnapshot);
    const productionSnapshot = parseProductionSnapshot(row.designSnapshot.productionSnapshot);
    const totalAmountMinor = bigintToMinor(row.totalAmountMinor, "totalAmountMinor");
    if (
      totalAmountMinor !== pricingSnapshot.totalPriceMinor ||
      row.currency !== designSnapshot.currency
    ) {
      throw new PersistenceError("DATA_INTEGRITY_ERROR", "Order row and snapshot differ");
    }
    return {
      id: row.id,
      userId: row.userId,
      status: row.status,
      currency: row.currency,
      totalAmountMinor,
      designRevisionId: row.designRevisionId,
      createdAt: row.createdAt,
      designSnapshot,
      pricingSnapshot,
      productionSnapshot,
      pricingRuleVersion: row.designSnapshot.pricingRuleVersion
    };
  }
}
