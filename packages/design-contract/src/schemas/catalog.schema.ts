import { z } from "zod";

import { BeadShapeSchema } from "./bead.schema";
import { IdentifierSchema, MillimeterSchema, MinorAmountSchema } from "./component.schema";
import { CurrencySchema } from "./metadata.schema";

export const ListCatalogMaterialsQuerySchema = z.strictObject({
  currency: CurrencySchema.default("CNY")
});

export const CatalogMaterialProductSchema = z.strictObject({
  beadProductId: IdentifierSchema,
  sku: IdentifierSchema,
  displayName: z.string().trim().min(1).max(200),
  crystalId: IdentifierSchema,
  crystalNameCn: z.string().trim().min(1).max(120),
  crystalNameEn: z.string().trim().min(1).max(120),
  colorTags: z.array(IdentifierSchema).max(20),
  visualTags: z.array(IdentifierSchema).max(30),
  styleTags: z.array(IdentifierSchema).max(30),
  emotionTags: z.array(IdentifierSchema).max(30),
  cultureTags: z.array(IdentifierSchema).max(30),
  materialKey: IdentifierSchema,
  shape: BeadShapeSchema,
  diameterMm: MillimeterSchema.positive(),
  modelAssetKey: IdentifierSchema,
  textureAssetKey: IdentifierSchema,
  currency: CurrencySchema,
  unitPriceMinor: MinorAmountSchema
});

export const ListCatalogMaterialsResponseSchema = z.strictObject({
  materials: z.array(CatalogMaterialProductSchema)
});

export type CatalogMaterialProduct = z.infer<typeof CatalogMaterialProductSchema>;
export type ListCatalogMaterialsQuery = z.infer<typeof ListCatalogMaterialsQuerySchema>;
export type ListCatalogMaterialsResponse = z.infer<typeof ListCatalogMaterialsResponseSchema>;
