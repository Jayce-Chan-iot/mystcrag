import { z } from "zod";

import { AccessoryV1Schema } from "./accessory.schema";
import { BeadV1Schema } from "./bead.schema";
import { BraceletV1Schema } from "./bracelet.schema";
import {
  IdentifierSchema,
  MillimeterSchema,
  MinorAmountSchema,
  NonEmptyTextSchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema
} from "./component.schema";
import { CreatorDisplayModeSchema, VisibilitySchema } from "./community.schema";
import { CurrencySchema, IsoDateTimeSchema, LocaleSchema } from "./metadata.schema";
import { OrderDesignSnapshotV1Schema } from "./order-snapshot.schema";
import { OrderFulfillmentSnapshotV1Schema } from "./order-fulfillment.schema";
import { PublicDesignV1Schema } from "./public-design.schema";

export const ContractWarningSchema = z.strictObject({
  code: IdentifierSchema,
  message: NonEmptyTextSchema,
  fieldPath: z.string().trim().min(1).max(500).optional()
});

const RequestIdSchema = IdentifierSchema;
const PublicDesignResponseShape = {
  requestId: RequestIdSchema,
  design: PublicDesignV1Schema,
  warnings: z.array(ContractWarningSchema)
} as const;

export const GenerateDesignRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  locale: LocaleSchema,
  currency: CurrencySchema,
  wristCircumferenceMm: MillimeterSchema.positive(),
  targetInnerCircumferenceMm: MillimeterSchema.positive().optional(),
  emotionTags: z.array(IdentifierSchema).max(30),
  styleTags: z.array(IdentifierSchema).max(30),
  colorTags: z.array(IdentifierSchema).max(30),
  minBudgetMinor: MinorAmountSchema.optional(),
  maxBudgetMinor: MinorAmountSchema.optional(),
  excludedProductIds: z.array(IdentifierSchema).default([]),
  personalizationConsent: z.boolean().default(false)
}).superRefine((request, context) => {
  if (
    request.minBudgetMinor !== undefined &&
    request.maxBudgetMinor !== undefined &&
    request.minBudgetMinor > request.maxBudgetMinor
  ) {
    context.addIssue({
      code: "custom",
      message: "minBudgetMinor cannot exceed maxBudgetMinor",
      path: ["minBudgetMinor"]
    });
  }
});

export const GenerateDesignResponseSchema = z.strictObject(PublicDesignResponseShape);

export const ReplaceComponentOperationSchema = z.strictObject({
  operation: z.literal("REPLACE_COMPONENT"),
  componentId: IdentifierSchema,
  replacement: z.union([BeadV1Schema, AccessoryV1Schema])
});

export const MoveComponentOperationSchema = z.strictObject({
  operation: z.literal("MOVE_COMPONENT"),
  componentId: IdentifierSchema,
  targetPositionIndex: NonNegativeSafeIntegerSchema
});

export const AddComponentOperationSchema = z.strictObject({
  operation: z.literal("ADD_COMPONENT"),
  component: z.union([BeadV1Schema, AccessoryV1Schema])
});

export const RemoveComponentOperationSchema = z.strictObject({
  operation: z.literal("REMOVE_COMPONENT"),
  componentId: IdentifierSchema
});

export const UpdateBraceletOperationSchema = z.strictObject({
  operation: z.literal("UPDATE_BRACELET"),
  bracelet: BraceletV1Schema
});

export const UpdateDesignOperationSchema = z.discriminatedUnion("operation", [
  ReplaceComponentOperationSchema,
  MoveComponentOperationSchema,
  AddComponentOperationSchema,
  RemoveComponentOperationSchema,
  UpdateBraceletOperationSchema
]);

export const UpdateDesignRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  designId: IdentifierSchema,
  expectedRevision: PositiveSafeIntegerSchema,
  operations: z.array(UpdateDesignOperationSchema).min(1)
});

export const UpdateDesignResponseSchema = z.strictObject(PublicDesignResponseShape);

export const PriceDesignRequestSchema = z
  .strictObject({
    requestId: RequestIdSchema,
    currency: CurrencySchema,
    design: PublicDesignV1Schema
  })
  .superRefine((request, context) => {
    if (request.currency !== request.design.currency) {
      context.addIssue({
        code: "custom",
        message: "Pricing currency must match the design currency",
        path: ["currency"]
      });
    }
  });

export const PriceDesignResponseSchema = z.strictObject(PublicDesignResponseShape);

export const SaveDesignRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  design: PublicDesignV1Schema
});

export const SaveDesignResponseSchema = z.strictObject({
  ...PublicDesignResponseShape,
  savedAt: IsoDateTimeSchema
});

export const DeleteDesignRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  designId: IdentifierSchema,
  expectedRevision: PositiveSafeIntegerSchema
});

export const DeleteDesignResponseSchema = z.strictObject({
  requestId: RequestIdSchema,
  designId: IdentifierSchema,
  deletedAt: IsoDateTimeSchema
});

export const CloneDesignRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  designId: IdentifierSchema,
  expectedRevision: PositiveSafeIntegerSchema
});

export const CloneDesignResponseSchema = z.strictObject({
  ...PublicDesignResponseShape,
  clonedAt: IsoDateTimeSchema
});

export const PublishDesignRequestSchema = z
  .strictObject({
    requestId: RequestIdSchema,
    design: PublicDesignV1Schema,
    visibility: VisibilitySchema,
    publishConsent: z.boolean(),
    allowRemix: z.boolean(),
    creatorDisplayMode: CreatorDisplayModeSchema
  })
  .superRefine((request, context) => {
    if (!request.publishConsent && request.visibility !== "PRIVATE") {
      context.addIssue({
        code: "custom",
        message: "PUBLIC or UNLISTED publication requires consent",
        path: ["publishConsent"]
      });
    }
    if (!request.publishConsent && request.allowRemix) {
      context.addIssue({
        code: "custom",
        message: "Remixing requires publication consent",
        path: ["allowRemix"]
      });
    }
    if (request.design.compliance.complianceStatus === "REJECTED") {
      context.addIssue({
        code: "custom",
        message: "REJECTED designs cannot be published",
        path: ["design", "compliance", "complianceStatus"]
      });
    }
  });

export const PublishDesignResponseSchema = z
  .strictObject({
    ...PublicDesignResponseShape,
    publicationId: IdentifierSchema,
    publishedAt: IsoDateTimeSchema
  })
  .superRefine((response, context) => {
    if (response.design.compliance.complianceStatus === "REJECTED") {
      context.addIssue({
        code: "custom",
        message: "REJECTED designs cannot appear in publication responses",
        path: ["design", "compliance", "complianceStatus"]
      });
    }
  });

export const CreateOrderFromDesignRequestSchema = z
  .strictObject({
    requestId: RequestIdSchema,
    design: PublicDesignV1Schema,
    expectedRevision: PositiveSafeIntegerSchema,
    expectedPricingVersion: IdentifierSchema,
    expectedTotalPriceMinor: MinorAmountSchema
  })
  .superRefine((request, context) => {
    if (request.design.compliance.complianceStatus === "REJECTED") {
      context.addIssue({
        code: "custom",
        message: "REJECTED designs cannot be ordered",
        path: ["design", "compliance", "complianceStatus"]
      });
    }
    if (request.expectedRevision !== request.design.revision) {
      context.addIssue({
        code: "custom",
        message: "Expected revision must match the design revision",
        path: ["expectedRevision"]
      });
    }
    if (request.expectedPricingVersion !== request.design.pricing.pricingVersion) {
      context.addIssue({
        code: "custom",
        message: "Expected pricing version must match the design",
        path: ["expectedPricingVersion"]
      });
    }
    if (request.expectedTotalPriceMinor !== request.design.pricing.totalPriceMinor) {
      context.addIssue({
        code: "custom",
        message: "Expected total price must match the design",
        path: ["expectedTotalPriceMinor"]
      });
    }
  });

export const CreateOrderFromDesignResponseSchema = z
  .strictObject({
    ...PublicDesignResponseShape,
    orderId: IdentifierSchema,
    orderStatus: z.enum(["PENDING", "CONFIRMED", "AWAITING_RESTOCK"]),
    snapshot: OrderDesignSnapshotV1Schema,
    createdAt: IsoDateTimeSchema
  })
  .superRefine((response, context) => {
    if (
      response.snapshot.design.designId !== response.design.designId ||
      response.snapshot.design.revision !== response.design.revision
    ) {
      context.addIssue({
        code: "custom",
        message: "Order snapshot must match the response design",
        path: ["snapshot", "design"]
      });
    }
  });

export const DesignPersistenceStatusSchema = z.enum([
  "DRAFT",
  "GENERATED",
  "SAVED",
  "ARCHIVED"
]);

export const ListMyDesignsResponseSchema = z.strictObject({
  designs: z
    .array(
      z.strictObject({
        design: PublicDesignV1Schema,
        status: DesignPersistenceStatusSchema,
        updatedAt: IsoDateTimeSchema
      })
    )
    .max(200)
});

export const OrderSummaryStatusSchema = z.enum([
  "PENDING",
  "AWAITING_RESTOCK",
  "CONFIRMED",
  "IN_PRODUCTION",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED"
]);

export const ListMyOrdersResponseSchema = z.strictObject({
  orders: z
    .array(
      z.strictObject({
        orderId: IdentifierSchema,
        status: OrderSummaryStatusSchema,
        currency: CurrencySchema,
        totalAmountMinor: MinorAmountSchema,
        createdAt: IsoDateTimeSchema,
        design: PublicDesignV1Schema,
        fulfillment: OrderFulfillmentSnapshotV1Schema
      })
    )
    .max(100)
});

export type ContractWarning = z.infer<typeof ContractWarningSchema>;
export type GenerateDesignRequest = z.infer<typeof GenerateDesignRequestSchema>;
export type GenerateDesignResponse = z.infer<typeof GenerateDesignResponseSchema>;
export type UpdateDesignOperation = z.infer<typeof UpdateDesignOperationSchema>;
export type UpdateDesignRequest = z.infer<typeof UpdateDesignRequestSchema>;
export type UpdateDesignResponse = z.infer<typeof UpdateDesignResponseSchema>;
export type PriceDesignRequest = z.infer<typeof PriceDesignRequestSchema>;
export type PriceDesignResponse = z.infer<typeof PriceDesignResponseSchema>;
export type SaveDesignRequest = z.infer<typeof SaveDesignRequestSchema>;
export type SaveDesignResponse = z.infer<typeof SaveDesignResponseSchema>;
export type DeleteDesignRequest = z.infer<typeof DeleteDesignRequestSchema>;
export type DeleteDesignResponse = z.infer<typeof DeleteDesignResponseSchema>;
export type CloneDesignRequest = z.infer<typeof CloneDesignRequestSchema>;
export type CloneDesignResponse = z.infer<typeof CloneDesignResponseSchema>;
export type PublishDesignRequest = z.infer<typeof PublishDesignRequestSchema>;
export type PublishDesignResponse = z.infer<typeof PublishDesignResponseSchema>;
export type CreateOrderFromDesignRequest = z.infer<typeof CreateOrderFromDesignRequestSchema>;
export type CreateOrderFromDesignResponse = z.infer<typeof CreateOrderFromDesignResponseSchema>;
export type DesignPersistenceStatus = z.infer<typeof DesignPersistenceStatusSchema>;
export type ListMyDesignsResponse = z.infer<typeof ListMyDesignsResponseSchema>;
export type OrderSummaryStatus = z.infer<typeof OrderSummaryStatusSchema>;
export type ListMyOrdersResponse = z.infer<typeof ListMyOrdersResponseSchema>;
