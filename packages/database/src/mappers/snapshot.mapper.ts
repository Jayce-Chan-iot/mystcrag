import {
  DesignV1Schema,
  PricingV1Schema,
  ProductionV1Schema,
  type DesignV1,
  type PricingV1,
  type ProductionV1
} from "@mystcrag/design-contract";
import type { Prisma } from "../../generated/client/client.js";

import { PersistenceError } from "../errors/persistence-errors.js";

function parseSnapshot<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  input: unknown,
  label: string
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", `${label} failed schema validation`);
  }
  return result.data;
}

export function parseDesignSnapshot(input: unknown): DesignV1 {
  return parseSnapshot(DesignV1Schema, input, "Design snapshot");
}

export function parsePricingSnapshot(input: unknown): PricingV1 {
  return parseSnapshot(PricingV1Schema, input, "Pricing snapshot");
}

export function parseProductionSnapshot(input: unknown): ProductionV1 {
  return parseSnapshot(ProductionV1Schema, input, "Production snapshot");
}

export function toPrismaJson(input: unknown): Prisma.InputJsonValue {
  return structuredClone(input) as Prisma.InputJsonValue;
}
