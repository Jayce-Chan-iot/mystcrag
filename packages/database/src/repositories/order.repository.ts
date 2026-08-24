import type { DesignV1, OrderFulfillmentSnapshotV1, PricingV1, ProductionV1 } from "@mystcrag/design-contract";

import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import { bigintToMinor, minorToBigInt } from "../mappers/money.mapper.js";
import {
  parseDesignSnapshot,
  parseOrderFulfillmentSnapshot,
  parsePricingSnapshot,
  parseProductionSnapshot,
  toPrismaJson
} from "../mappers/snapshot.mapper.js";
import { recalculateWithCatalog } from "./pricing.repository.js";

export type PersistedOrder = {
  id: string;
  userId: string;
  status: "PENDING" | "AWAITING_RESTOCK" | "CONFIRMED" | "IN_PRODUCTION" | "SHIPPED" | "COMPLETED" | "CANCELLED";
  currency: "CNY" | "TWD";
  totalAmountMinor: number;
  designRevisionId: string;
  createdAt: Date;
  designSnapshot: DesignV1;
  pricingSnapshot: PricingV1;
  productionSnapshot: ProductionV1;
  fulfillmentSnapshot: OrderFulfillmentSnapshotV1;
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
      const fulfillmentLines: OrderFulfillmentSnapshotV1["lines"] = [];
      const inventoryRows: Array<{ productId: string; availableQuantity: number; reservedQuantity: number; reserveNow: number }> = [];
      for (const [productId, quantity] of quantitiesByProduct(pricedDesign)) {
        const inventory = await tx.inventorySnapshot.findFirst({
          where: { productId },
          orderBy: { capturedAt: "desc" }
        });
        const remaining = inventory
          ? Math.max(0, inventory.availableQuantity - inventory.reservedQuantity)
          : 0;
        if (pricedDesign.designMode !== "TAROT_GUIDED" && remaining < quantity) {
          throw new PersistenceError("INVENTORY_CHANGED", `Inventory changed for ${productId}`);
        }
        const reservedQuantity = Math.min(remaining, quantity);
        const backorderQuantity = quantity - reservedQuantity;
        fulfillmentLines.push({
          productId,
          requestedQuantity: quantity,
          reservedQuantity,
          backorderQuantity,
          status: backorderQuantity === 0 ? "IN_STOCK" : reservedQuantity === 0 ? "BACKORDERED" : "PARTIALLY_BACKORDERED",
          estimatedRestockDays: backorderQuantity > 0 ? 5 : 0
        });
        if (inventory && reservedQuantity > 0) {
          inventoryRows.push({
            productId,
            availableQuantity: inventory.availableQuantity,
            reservedQuantity: inventory.reservedQuantity,
            reserveNow: reservedQuantity
          });
        }
      }
      const requiresRestock = fulfillmentLines.some((line) => line.backorderQuantity > 0);
      const fulfillmentSnapshot: OrderFulfillmentSnapshotV1 = {
        status: requiresRestock ? "AWAITING_RESTOCK" : "IN_STOCK",
        estimatedRestockDays: requiresRestock ? 5 : 0,
        lines: fulfillmentLines
      };
      const row = await tx.order.create({
        data: {
          idempotencyKey,
          userId: actorId,
          status: requiresRestock ? "AWAITING_RESTOCK" : "PENDING",
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
              fulfillmentSnapshot: toPrismaJson(fulfillmentSnapshot),
              currency: pricedDesign.currency,
              pricingRuleVersion: pricedDesign.pricing.pricingVersion
            }
          }
        },
        include: { designSnapshot: true }
      });
      for (const inventory of inventoryRows) {
        await tx.inventorySnapshot.create({
          data: {
            productType: "MATERIAL",
            productId: inventory.productId,
            availableQuantity: inventory.availableQuantity,
            reservedQuantity: inventory.reservedQuantity + inventory.reserveNow,
            sourceVersion: `order:${row.id}`
          }
        });
      }
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

  async listOrders(actorId: string): Promise<PersistedOrder[]> {
    const rows = await this.prisma.order.findMany({
      where: { userId: actorId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { designSnapshot: true }
    });
    return rows.map((row) => this.mapOrder(row));
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
      fulfillmentSnapshot: unknown;
      pricingRuleVersion: string;
    };
  }): PersistedOrder {
    if (!row.designSnapshot) {
      throw new PersistenceError("DATA_INTEGRITY_ERROR", "Order snapshot is missing");
    }
    const designSnapshot = parseDesignSnapshot(row.designSnapshot.designSnapshot);
    const pricingSnapshot = parsePricingSnapshot(row.designSnapshot.pricingSnapshot);
    const productionSnapshot = parseProductionSnapshot(row.designSnapshot.productionSnapshot);
    const fulfillmentSnapshot = parseOrderFulfillmentSnapshot(row.designSnapshot.fulfillmentSnapshot);
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
      fulfillmentSnapshot,
      pricingRuleVersion: row.designSnapshot.pricingRuleVersion
    };
  }
}
