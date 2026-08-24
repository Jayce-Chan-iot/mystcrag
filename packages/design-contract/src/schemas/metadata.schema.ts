import { z } from "zod";

import { SUPPORTED_CURRENCIES } from "../constants/currencies";
import { DESIGN_SCHEMA_VERSION } from "../constants/versions";
import { IdentifierSchema, PositiveSafeIntegerSchema } from "./component.schema";

export const DesignModeSchema = z.enum([
  "AI_GENERATED",
  "DIY_CREATED",
  "AI_ASSISTED",
  "TEMPLATE_REMIX",
  "TAROT_GUIDED"
]);

export const CurrencySchema = z.enum(SUPPORTED_CURRENCIES);
export const LocaleSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "Expected a BCP 47 locale");
export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const DesignMetadataSchema = z.strictObject({
  schemaVersion: z.literal(DESIGN_SCHEMA_VERSION),
  designId: IdentifierSchema,
  designName: z.string().trim().min(1).max(200),
  designMode: DesignModeSchema,
  revision: PositiveSafeIntegerSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  locale: LocaleSchema,
  currency: CurrencySchema
});

export type DesignMode = z.infer<typeof DesignModeSchema>;
export type DesignMetadata = z.infer<typeof DesignMetadataSchema>;
export type Currency = z.infer<typeof CurrencySchema>;
export type Locale = z.infer<typeof LocaleSchema>;
