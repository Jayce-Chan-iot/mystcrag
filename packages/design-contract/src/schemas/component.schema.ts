import { z } from "zod";

export const IdentifierSchema = z.string().trim().min(1).max(160);
export const NonEmptyTextSchema = z.string().trim().min(1).max(4_000);
export const SafeIntegerSchema = z.number().int().safe();
export const NonNegativeSafeIntegerSchema = SafeIntegerSchema.nonnegative();
export const PositiveSafeIntegerSchema = SafeIntegerSchema.positive();
export const PositionIndexSchema = NonNegativeSafeIntegerSchema;
export const MinorAmountSchema = NonNegativeSafeIntegerSchema;
export const SignedMinorAmountSchema = SafeIntegerSchema;
export const MillimeterSchema = z.number().finite().nonnegative();

export const ComponentIdSchema = IdentifierSchema;

export const ComponentReferenceSchema = z.strictObject({
  componentId: ComponentIdSchema
});

export type ComponentReference = z.infer<typeof ComponentReferenceSchema>;
