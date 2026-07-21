import { z } from "zod";

import { LEGACY_INITIAL_SCHEMA_VERSION } from "../constants/versions";
import {
  IdentifierSchema,
  MillimeterSchema,
  NonEmptyTextSchema,
  PositiveSafeIntegerSchema
} from "../schemas/component.schema";
import { CurrencySchema, IsoDateTimeSchema, LocaleSchema } from "../schemas/metadata.schema";

export const LegacyInitialBeadGroupSchema = z.strictObject({
  crystalId: IdentifierSchema,
  sizeMm: MillimeterSchema.positive(),
  count: PositiveSafeIntegerSchema.max(500)
});

export const LegacyInitialDesignSchema = z.strictObject({
  schemaVersion: z.literal(LEGACY_INITIAL_SCHEMA_VERSION),
  designId: IdentifierSchema,
  designName: z.string().trim().min(1).max(200),
  story: z.string().trim().max(4_000),
  style: NonEmptyTextSchema,
  beads: z.array(LegacyInitialBeadGroupSchema).min(1).max(100),
  wristCircumferenceMm: MillimeterSchema.positive(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  locale: LocaleSchema,
  currency: CurrencySchema
});

export type LegacyInitialDesign = z.infer<typeof LegacyInitialDesignSchema>;
