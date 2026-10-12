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
 * manually approved copy, approved media, reviewed specifications, the
 * manually approved per-market price, and a display-only availability state.
 * Internal cost, margin, stock, supplier, license, draft, region-rule, and
 * purchase-authority fields cannot be represented, and no shape can carry
 * another market's currency or a converted amount.
 *
 * Boundary: this contract validates shape, required fields, and the approved
 * market currency only; parsing a response is never publication approval.
 * Per-locale editorial review, authorization withdrawal, and
 * missing-translation fallback are decisions of the server-side publication
 * boundary, which excludes or rejects unapproved resources instead of
 * falling back. The dishonest shortcuts stay unrepresentable here: no shape
 * admits a fallback locale, editorial-review or withdrawal metadata, or copy
 * without a declared requested locale.
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
/**
 * Media address format policy (format only, never an authorization): a
 * site-relative path with a single leading slash or an absolute https:// URL
 * with a valid host. Dangerous schemes (javascript:, data:, file:, blob:,
 * vbscript:), plain http://, protocol-relative //, host-less https:// forms,
 * and paths without a leading slash cannot be represented. Whether a media
 * asset is approved, and its withdrawal, stay with the publication boundary.
 */
const ShowroomMediaUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .regex(
    /^(?:\/(?!\/)[^\s\\]+|https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?(?:[\/?#][^\s\\]*)?)$/,
    "Expected a site-relative path or an https URL with a valid host"
  );

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

/**
 * Display-only availability: the approved public status a product may show.
 * It is a presentation label only and can never carry a stock quantity, a
 * restock date, or a purchase permission.
 */
export const ShowroomAvailabilitySchema = z.enum([
  "AVAILABLE",
  "INQUIRY_ONLY",
  "OUT_OF_STOCK",
  "COMING_SOON"
]);

export const ShowroomPublicProductSchema = z.strictObject({
  slug: ShowroomSlugSchema,
  publicRevision: PositiveSafeIntegerSchema,
  title: ShowroomTitleSchema,
  summary: ShowroomSummarySchema,
  availability: ShowroomAvailabilitySchema,
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

/**
 * The strict detail request: exactly the market and the display locale. The
 * market is never inferred from the display language. List routes use the
 * bounded ShowroomListRequestSchema instead.
 */
export const ShowroomPublicRequestSchema = z.strictObject({
  market: ShowroomMarketSchema,
  locale: ShowroomLocaleSchema
});

export const ShowroomProductSortSchema = z.enum([
  "FEATURED",
  "NEWEST",
  "PRICE_ASC",
  "PRICE_DESC"
]);

/**
 * Bounded list request. Pagination, sorting, and slug filters are the only
 * client-selectable inputs beyond the required market and display locale;
 * out-of-range values and unknown fields are rejected instead of clamped.
 */
export const ShowroomListRequestSchema = z.strictObject({
  market: ShowroomMarketSchema,
  locale: ShowroomLocaleSchema,
  page: PositiveSafeIntegerSchema.default(1),
  pageSize: PositiveSafeIntegerSchema.max(96).default(24),
  sort: ShowroomProductSortSchema.default("FEATURED"),
  designer: ShowroomSlugSchema.optional(),
  category: ShowroomSlugSchema.optional()
});

export type ShowroomMedia = z.infer<typeof ShowroomMediaSchema>;
export type ShowroomSpecification = z.infer<typeof ShowroomSpecificationSchema>;
export type ShowroomPrice = z.infer<typeof ShowroomPriceSchema>;
export type ShowroomDesignerRef = z.infer<typeof ShowroomDesignerRefSchema>;
export type ShowroomPublicProduct = z.infer<typeof ShowroomPublicProductSchema>;
export type ShowroomPublicDesigner = z.infer<typeof ShowroomPublicDesignerSchema>;
export type ShowroomPublicCollection = z.infer<typeof ShowroomPublicCollectionSchema>;
export type ShowroomPublicRequest = z.infer<typeof ShowroomPublicRequestSchema>;
export type ShowroomAvailability = z.infer<typeof ShowroomAvailabilitySchema>;
export type ShowroomProductSort = z.infer<typeof ShowroomProductSortSchema>;
export type ShowroomListRequest = z.infer<typeof ShowroomListRequestSchema>;

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