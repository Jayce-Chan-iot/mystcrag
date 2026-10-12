import { z } from "zod";

import {
  MinorAmountSchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema
} from "./component.schema";
import { CurrencySchema, type Currency } from "./metadata.schema";

/**
 * Public showroom read contract.
 *
 * These DTOs are the only representable shape of anonymous showroom reads:
 * manually approved copy, approved media, reviewed specifications, and the
 * manually approved per-market price. Internal cost, margin, stock, supplier,
 * license, draft, region-rule, and purchase-authority fields cannot be
 * represented, and no shape can carry another market's currency or a
 * converted amount.
 */

export const ShowroomMarketSchema = z.enum(["CN", "TW"]);

export const ShowroomLocaleSchema = z.enum(["zh-CN", "zh-TW", "en-US"]);

export type ShowroomMarket = z.infer<typeof ShowroomMarketSchema>;
export type ShowroomLocale = z.infer<typeof ShowroomLocaleSchema>;

/**
 * The single authority binding a showroom market to its manually approved
 * publication currency. A market is never inferred from the display locale.
 */
export const SHOWROOM_MARKET_CURRENCY = {
  CN: "CNY",
  TW: "TWD"
} as const satisfies Record<ShowroomMarket, Currency>;

const ShowroomSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Expected a lowercase kebab-case slug")
  .max(160);
const ShowroomTitleSchema = z.string().trim().min(1).max(120);
const ShowroomSummarySchema = z.string().trim().min(1).max(240);
const ShowroomLabelSchema = z.string().trim().min(1).max(160);
const ShowroomStorySchema = z.string().trim().min(1).max(2_000);
const ShowroomAltTextSchema = z.string().trim().min(1).max(300);
const ShowroomMediaUrlSchema = z.string().trim().min(1).max(2_048);

export const ShowroomMediaSchema = z.strictObject({
  url: ShowroomMediaUrlSchema,
  alt: ShowroomAltTextSchema,
  width: PositiveSafeIntegerSchema.optional(),
  height: PositiveSafeIntegerSchema.optional()
});

export const ShowroomSpecificationSchema = z.strictObject({
  label: ShowroomLabelSchema,
  value: ShowroomLabelSchema
});

export const ShowroomPriceSchema = z.strictObject({
  currency: CurrencySchema,
  amountMinor: MinorAmountSchema
});

export const ShowroomDesignerRefSchema = z.strictObject({
  slug: ShowroomSlugSchema,
  displayName: ShowroomLabelSchema
});

export const ShowroomPublicProductSchema = z.strictObject({
  slug: ShowroomSlugSchema,
  publicRevision: PositiveSafeIntegerSchema,
  title: ShowroomTitleSchema,
  summary: ShowroomSummarySchema,
  media: z.array(ShowroomMediaSchema).min(1).max(24),
  materials: z.array(ShowroomLabelSchema).min(1).max(64),
  specifications: z.array(ShowroomSpecificationSchema).min(1).max(64),
  price: ShowroomPriceSchema,
  designer: ShowroomDesignerRefSchema
});

export const ShowroomPublicDesignerSchema = z.strictObject({
  slug: ShowroomSlugSchema,
  publicRevision: PositiveSafeIntegerSchema,
  displayName: ShowroomLabelSchema,
  summary: ShowroomSummarySchema,
  story: ShowroomStorySchema,
  media: z.array(ShowroomMediaSchema).max(24)
});

export const ShowroomPublicCollectionSchema = z.strictObject({
  slug: ShowroomSlugSchema,
  publicRevision: PositiveSafeIntegerSchema,
  title: ShowroomTitleSchema,
  summary: ShowroomSummarySchema,
  media: z.array(ShowroomMediaSchema).max(24),
  designers: z.array(ShowroomDesignerRefSchema).max(24)
});

export const ShowroomPublicRequestSchema = z.strictObject({
  market: ShowroomMarketSchema,
  locale: ShowroomLocaleSchema
});

export type ShowroomMedia = z.infer<typeof ShowroomMediaSchema>;
export type ShowroomSpecification = z.infer<typeof ShowroomSpecificationSchema>;
export type ShowroomPrice = z.infer<typeof ShowroomPriceSchema>;
export type ShowroomDesignerRef = z.infer<typeof ShowroomDesignerRefSchema>;
export type ShowroomPublicProduct = z.infer<typeof ShowroomPublicProductSchema>;
export type ShowroomPublicDesigner = z.infer<typeof ShowroomPublicDesignerSchema>;
export type ShowroomPublicCollection = z.infer<typeof ShowroomPublicCollectionSchema>;
export type ShowroomPublicRequest = z.infer<typeof ShowroomPublicRequestSchema>;

export type ShowroomPricedItem = {
  price: ShowroomPrice;
};

type ShowroomCurrencyIssue = {
  code: "custom";
  path: Array<string | number>;
  message: string;
};

const currencyMismatchIssue = (
  item: ShowroomPricedItem,
  market: ShowroomMarket,
  path: Array<string | number>
): ShowroomCurrencyIssue | undefined => {
  const approvedCurrency = SHOWROOM_MARKET_CURRENCY[market];
  if (item.price.currency === approvedCurrency) {
    return undefined;
  }
  return {
    code: "custom",
    path,
    message: `price currency must equal the ${market} market currency ${approvedCurrency}`
  };
};

export type ShowroomPage<Item> = {
  market: ShowroomMarket;
  locale: ShowroomLocale;
  items: Item[];
  page: number;
  pageSize: number;
  total: number;
};

/**
 * A list page of market-scoped items. Every embedded item must carry the
 * requested market's approved currency; an item priced for another market is
 * rejected instead of being converted or silently dropped.
 */
export const ShowroomPageSchema = <Item extends ShowroomPricedItem>(
  itemSchema: z.ZodType<Item, Item>
) => {
  return z
    .strictObject({
      market: ShowroomMarketSchema,
      locale: ShowroomLocaleSchema,
      items: z.array(itemSchema),
      page: PositiveSafeIntegerSchema,
      pageSize: PositiveSafeIntegerSchema.max(96),
      total: NonNegativeSafeIntegerSchema
    })
    .superRefine((page, context) => {
      page.items.forEach((item, index) => {
        const issue = currencyMismatchIssue(item, page.market, [
          "items",
          index,
          "price",
          "currency"
        ]);
        if (issue) {
          context.addIssue(issue);
        }
      });
    });
};

export const ShowroomProductPageSchema = ShowroomPageSchema(ShowroomPublicProductSchema);

export type ShowroomProductPage = ShowroomPage<ShowroomPublicProduct>;

export const ShowroomProductDetailSchema = z
  .strictObject({
    market: ShowroomMarketSchema,
    locale: ShowroomLocaleSchema,
    product: ShowroomPublicProductSchema
  })
  .superRefine((detail, context) => {
    const issue = currencyMismatchIssue(detail.product, detail.market, [
      "product",
      "price",
      "currency"
    ]);
    if (issue) {
      context.addIssue(issue);
    }
  });

export const ShowroomDesignerDetailSchema = z
  .strictObject({
    market: ShowroomMarketSchema,
    locale: ShowroomLocaleSchema,
    designer: ShowroomPublicDesignerSchema,
    products: z.array(ShowroomPublicProductSchema).max(96)
  })
  .superRefine((detail, context) => {
    detail.products.forEach((product, index) => {
      const issue = currencyMismatchIssue(product, detail.market, [
        "products",
        index,
        "price",
        "currency"
      ]);
      if (issue) {
        context.addIssue(issue);
      }
    });
  });

export const ShowroomCollectionDetailSchema = z
  .strictObject({
    market: ShowroomMarketSchema,
    locale: ShowroomLocaleSchema,
    collection: ShowroomPublicCollectionSchema,
    products: z.array(ShowroomPublicProductSchema).max(96)
  })
  .superRefine((detail, context) => {
    detail.products.forEach((product, index) => {
      const issue = currencyMismatchIssue(product, detail.market, [
        "products",
        index,
        "price",
        "currency"
      ]);
      if (issue) {
        context.addIssue(issue);
      }
    });
  });

export type ShowroomProductDetail = z.infer<typeof ShowroomProductDetailSchema>;
export type ShowroomDesignerDetail = z.infer<typeof ShowroomDesignerDetailSchema>;
export type ShowroomCollectionDetail = z.infer<typeof ShowroomCollectionDetailSchema>;